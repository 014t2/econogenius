"""Parser tabular universal: XLS (xlrd), XLSX (openpyxl) y CSV de cualquier entidad bancaria
(Kutxabank, BBVA, Santander, CaixaBank, ING, Sabadell, Bankinter, Revolut, N26, Laboral Kutxa, etc.).

Localiza dinámicamente la fila de cabecera (ignorando títulos superiores y metadatos) y mapea
columnas por alias ES / EU / EN, soportando tanto columna única de ``importe`` como columnas
separadas ``cargo`` / ``abono`` (debe / haber) y conceptos compuestos (``concepto`` + ``más datos``).
"""
from __future__ import annotations

import io
from decimal import Decimal

import pandas as pd

from app.imports.parsers.utils import (
    ParsedTransaction,
    ParseResult,
    ParserError,
    normalize_header,
    parse_date,
    parse_eu_amount,
)

HEADER_ALIASES: dict[str, set[str]] = {
    "operation_date": {
        "fecha",
        "data",
        "fecha operacion",
        "fecha de operacion",
        "eragiketa data",
        "f. operacion",
        "f.operacion",
        "fecha contable",
        "fecha movimiento",
        "date",
        "started date",
        "completed date",
        "booking date",
        "transaction date",
    },
    "concept": {
        "concepto",
        "azalpena",
        "descripcion",
        "kontzeptua",
        "movimiento",
        "concepto / movimiento",
        "descripcion del movimiento",
        "detalle",
        "asunto",
        "comercio",
        "beneficiario",
        "description",
        "reference",
        "payee",
        "merchant",
    },
    "extra_concept": {
        "mas datos",
        "observaciones",
        "informacion adicional",
        "notas",
        "notes",
        "referencia",
    },
    "value_date": {
        "fecha valor",
        "balio-data",
        "balio data",
        "fecha de valor",
        "f. valor",
        "f.valor",
        "value date",
    },
    "amount": {
        "importe",
        "zenbatekoa",
        "importe de la operacion",
        "eragiketaren zenbatekoa",
        "importe (eur)",
        "importe (€)",
        "importe eur",
        "cantidad",
        "valor",
        "amount",
        "amount (eur)",
        "total",
    },
    "debit": {
        "cargo",
        "cargos",
        "debe",
        "debito",
        "salida",
        "gasto",
        "debit",
        "paid out",
    },
    "credit": {
        "abono",
        "abonos",
        "haber",
        "credito",
        "entrada",
        "ingreso",
        "credit",
        "paid in",
    },
    "balance": {
        "saldo",
        "saldoa",
        "saldo disponible",
        "saldo contable",
        "saldo posterior",
        "saldo (eur)",
        "balance",
    },
}
MAX_HEADER_SCAN = 60


def _match_header(cells: list[object]) -> dict[str, int] | None:
    mapping: dict[str, int] = {}
    for idx, cell in enumerate(cells):
        if cell is None or (isinstance(cell, float) and pd.isna(cell)):
            continue
        h = normalize_header(cell)
        for key, aliases in HEADER_ALIASES.items():
            if key in mapping:
                continue
            if h in aliases or (
                key == "amount"
                and (h.startswith("importe") or h.startswith("zenbateko") or h.startswith("amount"))
            ):
                mapping[key] = idx
                break
    has_date_and_concept = {"operation_date", "concept"} <= mapping.keys()
    has_amount = "amount" in mapping or "debit" in mapping or "credit" in mapping
    return mapping if (has_date_and_concept and has_amount) else None


def _is_empty(v: object) -> bool:
    return v is None or (isinstance(v, float) and pd.isna(v)) or (isinstance(v, str) and not v.strip())


def _extract_row_amount(cells: list[object], mapping: dict[str, int]) -> Decimal | None:
    if "amount" in mapping and not _is_empty(cells[mapping["amount"]]):
        return parse_eu_amount(cells[mapping["amount"]])
    if "debit" in mapping or "credit" in mapping:
        debit_val = Decimal("0")
        credit_val = Decimal("0")
        has_any = False
        if "debit" in mapping and not _is_empty(cells[mapping["debit"]]):
            debit_val = abs(parse_eu_amount(cells[mapping["debit"]]))
            has_any = True
        if "credit" in mapping and not _is_empty(cells[mapping["credit"]]):
            credit_val = abs(parse_eu_amount(cells[mapping["credit"]]))
            has_any = True
        if has_any:
            return credit_val - debit_val
    return None


def parse_dataframe(df: pd.DataFrame, source: str = "xls") -> ParseResult:
    header_row, mapping = None, None
    for i in range(min(len(df), MAX_HEADER_SCAN)):
        mapping = _match_header(df.iloc[i].tolist())
        if mapping:
            header_row = i
            break
    if header_row is None or mapping is None:
        raise ParserError("No se ha encontrado la cabecera (fecha | concepto | importe) en el fichero")

    headers = [normalize_header(c) for c in df.iloc[header_row].tolist()]
    language = "eu" if any(h in ("data", "azalpena", "zenbatekoa") for h in headers) else "es"
    is_card = "balance" not in mapping
    result = ParseResult(language=language, detected_format=f"kutxabank_{source}_{'card' if is_card else 'account'}")

    for _, row in df.iloc[header_row + 1:].iterrows():
        cells = row.tolist()
        raw_date = cells[mapping["operation_date"]]
        if _is_empty(raw_date):
            continue
        try:
            op_date = parse_date(raw_date)
            amount = _extract_row_amount(cells, mapping)
        except ParserError:
            continue  # filas de totales / pies
        if amount is None:
            continue
        value_date = None
        if "value_date" in mapping and not _is_empty(cells[mapping["value_date"]]):
            try:
                value_date = parse_date(cells[mapping["value_date"]])
            except ParserError:
                value_date = None
        balance = None
        if "balance" in mapping and not _is_empty(cells[mapping["balance"]]):
            try:
                balance = parse_eu_amount(cells[mapping["balance"]])
            except ParserError:
                balance = None
        concept_parts: list[str] = []
        concept_raw = cells[mapping["concept"]]
        if not _is_empty(concept_raw):
            concept_parts.append(" ".join(str(concept_raw).split()))
        if "extra_concept" in mapping and not _is_empty(cells[mapping["extra_concept"]]):
            extra_str = " ".join(str(cells[mapping["extra_concept"]]).split())
            if extra_str and extra_str not in concept_parts:
                concept_parts.append(extra_str)
        concept = " · ".join(concept_parts) if concept_parts else "(sin concepto)"
        result.transactions.append(ParsedTransaction(op_date, value_date, concept, amount, balance))

    if not result.transactions:
        raise ParserError("La cabecera se ha encontrado pero no hay movimientos válidos")
    dates = [t.operation_date for t in result.transactions]
    result.period_start, result.period_end = min(dates), max(dates)
    return result


def parse_excel(content: bytes, ext: str) -> ParseResult:
    if ext == ".xls" and content.lstrip()[:1] == b"<":
        # Algunos bancos exportan HTML con extensión .xls
        try:
            tables = pd.read_html(io.BytesIO(content), header=None)
        except Exception as exc:
            raise ParserError("No se ha podido leer el fichero .xls (HTML)") from exc
        for t in tables:
            try:
                return parse_dataframe(t.astype(object), "xls")
            except ParserError:
                continue
        raise ParserError("No se han encontrado movimientos en el fichero")

    engine = "xlrd" if ext == ".xls" else "openpyxl"
    try:
        book = pd.ExcelFile(io.BytesIO(content), engine=engine)
    except Exception as exc:
        raise ParserError(f"No se ha podido abrir el Excel ({ext})") from exc
    sheets = sorted(book.sheet_names, key=lambda s: s.strip().lower() != "listado")  # 'Listado' primero
    last_error: ParserError | None = None
    for sheet in sheets:
        df = book.parse(sheet, header=None, dtype=object)
        try:
            return parse_dataframe(df, ext.lstrip("."))
        except ParserError as exc:
            last_error = exc
    raise last_error or ParserError("Excel vacío")


def parse_csv(content: bytes) -> ParseResult:
    for enc in ("utf-8-sig", "latin-1"):
        try:
            text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    try:
        df = pd.read_csv(io.StringIO(text), sep=None, engine="python", header=None, dtype=str)
    except Exception as exc:
        raise ParserError("No se ha podido leer el CSV") from exc
    return parse_dataframe(df.astype(object), "csv")
