"""Parser universal de extractos PDF bancarios (Kutxabank ES/EU, BBVA, Santander, CaixaBank, ING, Revolut, N26, etc.).

Estrategia: ``pdfplumber`` extrae el texto de cada página respetando el orden visual y se
procesa línea a línea soportando los 3 esquemas habituales de tablas bancarias en PDF:

1. ``Fecha | Concepto | Fecha valor | Importe [| Saldo]`` (ej. Kutxabank ES/EU, Laboral Kutxa)
2. ``Fecha op. | Fecha valor | Concepto | Importe [| Saldo]`` (ej. BBVA, Santander, CaixaBank, Sabadell)
3. ``Fecha | Concepto | Importe [| Saldo]`` (ej. Revolut, N26, ING, Openbank, extractos de tarjeta)

Las líneas siguientes sin fecha son continuación del concepto (conceptos multilínea como
``NORA TRASP. KB`` + ``GA RENDIMIENTO E``). Los símbolos ``€`` sueltos (que caen a otra línea) se ignoran.
"""
from __future__ import annotations

import io
import re

from app.imports.parsers.utils import ParsedTransaction, ParseResult, ParserError, parse_date, parse_eu_amount

DATE = r"(\d{2}[/\-\.]\d{2}[/\-\.]\d{2,4}|\d{4}[/\-\.]\d{2}[/\-\.]\d{2})"
AMOUNT = r"([+\-]?\s?(?:\d{1,3}(?:[\.,]\d{3})+|\d+)[\.,]\d{2})\s*(?:€|EUR|\$|£)?"

# Patrón 1: Fecha + Concepto + Fecha valor + Importe [+ Saldo]
ROW_DATE_CONCEPT_DATE_RE = re.compile(rf"^{DATE}\s+(?:(.*?)\s+)?{DATE}\s+{AMOUNT}(?:\s+{AMOUNT})?\s*$")
# Patrón 2: Fecha + Fecha valor + Concepto + Importe [+ Saldo]
ROW_TWO_DATES_FIRST_RE = re.compile(rf"^{DATE}\s+{DATE}\s+(.+?)\s+{AMOUNT}(?:\s+{AMOUNT})?\s*$")
# Patrón 3: Fecha + Concepto + Importe [+ Saldo] (una sola columna de fecha)
ROW_SINGLE_DATE_RE = re.compile(rf"^{DATE}\s+(.+?)\s+{AMOUNT}(?:\s+{AMOUNT})?\s*$")

HEADER_ES = re.compile(
    r"(fecha\s+concepto\s+fecha\s+valor\s+importe|f\.\s*operaci[oó]n|fecha\s+operaci[oó]n.*importe|fecha.*concepto.*importe|fecha.*descripci[oó]n.*importe)",
    re.I,
)
HEADER_EU = re.compile(r"data\s+azalpena\s+balio[\s-]*data\s+zenbatekoa", re.I)
ACCOUNT_RE = re.compile(
    r"(?:N[uú]mero|Zenbakia|IBAN|Cuenta|Kontua|Account)\s*:?\s*([A-Z]{0,2}\d[\d \-]{6,40}\d)",
    re.I,
)
PERIOD_ES = re.compile(rf"(?:Per[ií]odo\s+desde|Desde)\s*:?\s*{DATE}\s+(?:hasta|al)\s*:?\s*{DATE}", re.I)
PERIOD_EU = re.compile(rf"Aldia\s+noiztik\s*:?\s*{DATE}\s+noiz\s+arte\s*:?\s*{DATE}", re.I)
IGNORE_RE = re.compile(
    r"^(p[aá]gina\s+\d+|orrialdea|\d+\s*/\s*\d+$|\d+\s+(de|/)\s+\d+$|saldo\s+(inicial|final|anterior)|"
    r"hasierako\s+saldoa|amaierako\s+saldoa|total|guztira)",
    re.I,
)
EURO_TOKEN = re.compile(r"(^|\s)(?:€|EUR)(?=\s|$)")
MAX_CONTINUATION_LEN = 70


def _match_transaction_row(line: str):
    """Intenta emparejar una línea con cualquiera de los 3 formatos bancarios de PDF."""
    if m := ROW_DATE_CONCEPT_DATE_RE.match(line):
        op, concept, val, amount, balance = m.groups()
        return op, val, concept or "", amount, balance
    if m := ROW_TWO_DATES_FIRST_RE.match(line):
        op, val, concept, amount, balance = m.groups()
        return op, val, concept, amount, balance
    if m := ROW_SINGLE_DATE_RE.match(line):
        op, concept, amount, balance = m.groups()
        return op, None, concept, amount, balance
    return None


def parse_pdf_lines(lines: list[str]) -> ParseResult:
    result = ParseResult()
    language: str | None = None
    current: ParsedTransaction | None = None
    pending_concept_parts: list[str] = []

    def flush():
        nonlocal current
        if current is not None:
            current.concept = re.sub(r"\s+", " ", current.concept).strip()
            if not current.concept:
                current.concept = "(sin concepto)"
            result.transactions.append(current)
            current = None

    for raw in lines:
        line = EURO_TOKEN.sub(" ", raw.replace("\xa0", " ")).strip()
        if not line:
            continue

        if HEADER_EU.search(line):
            language = language or "eu"
            flush()
            continue
        if HEADER_ES.search(line):
            language = language or "es"
            flush()
            continue
        if m := ACCOUNT_RE.search(line):
            result.account_number = result.account_number or re.sub(r"[\s\-]", "", m.group(1))
            continue
        if m := (PERIOD_ES.search(line) or PERIOD_EU.search(line)):
            result.period_start, result.period_end = parse_date(m.group(1)), parse_date(m.group(2))
            continue

        matched = _match_transaction_row(line)
        if matched:
            flush()
            op, val, concept, amount, balance = matched
            current = ParsedTransaction(
                operation_date=parse_date(op),
                value_date=parse_date(val) if val else None,
                concept=" ".join(pending_concept_parts + [concept or ""]),
                amount=parse_eu_amount(amount),
                balance=parse_eu_amount(balance) if balance else None,
            )
            pending_concept_parts = []
            if language is None:
                language = "eu" if re.match(r"\d{4}/", op) else "es"
            continue

        if IGNORE_RE.match(line):
            flush()
            continue
        # Continuación de concepto multilínea (no empieza por fecha de nueva fila)
        if current is not None and len(line) <= MAX_CONTINUATION_LEN and not re.match(DATE, line):
            current.concept += " " + line
        elif current is not None:
            flush()

    flush()
    result.language = language
    result.detected_format = f"kutxabank_pdf_{language or 'es'}"
    if result.period_start is None and result.transactions:
        dates = [t.operation_date for t in result.transactions]
        result.period_start, result.period_end = min(dates), max(dates)
    return result


def parse_pdf(content: bytes) -> ParseResult:
    import pdfplumber

    lines: list[str] = []
    try:
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                text = page.extract_text(x_tolerance=1.5, y_tolerance=3) or ""
                lines.extend(text.splitlines())
    except Exception as exc:  # pdfminer lanza excepciones variadas
        raise ParserError("No se ha podido leer el PDF (¿está protegido o dañado?)") from exc
    result = parse_pdf_lines(lines)
    if not result.transactions:
        raise ParserError("No se han encontrado movimientos válidos en el PDF bancario.")
    return result
