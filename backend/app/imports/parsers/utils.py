"""Utilidades comunes a todos los parsers."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

TWO = Decimal("0.01")
DATE_FORMATS = (
    "%d/%m/%Y",
    "%Y/%m/%d",
    "%Y-%m-%d",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%Y.%m.%d",
    "%d/%m/%y",
    "%d-%m-%y",
)


class ParserError(ValueError):
    """Error de formato al leer un extracto."""


@dataclass
class ParsedTransaction:
    operation_date: date
    value_date: date | None
    concept: str
    amount: Decimal
    balance: Decimal | None = None


@dataclass
class ParseResult:
    transactions: list[ParsedTransaction] = field(default_factory=list)
    detected_format: str = "unknown"
    language: str | None = None  # es | eu
    account_number: str | None = None
    period_start: date | None = None
    period_end: date | None = None
    warnings: list[str] = field(default_factory=list)


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def normalize_concept(s: str) -> str:
    """Mayúsculas, sin tildes y espacios colapsados (base para reglas y hash)."""
    return re.sub(r"\s+", " ", strip_accents(str(s)).upper()).strip()


def normalize_header(s: object) -> str:
    return re.sub(r"\s+", " ", strip_accents(str(s)).lower()).strip()


def parse_eu_amount(value: object) -> Decimal:
    """Convierte importes europeos ('1.200,00 €', '-1.327,49 €', '- 45,10') o numéricos a Decimal."""
    if value is None:
        raise ParserError("Importe vacío")
    if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
        if isinstance(value, float) and value != value:  # NaN
            raise ParserError("Importe vacío")
        return Decimal(str(value)).quantize(TWO)
    s = str(value).replace("€", "").replace("EUR", "").replace("\xa0", "").replace(" ", "").strip()
    negative = False
    if s.startswith("(") and s.endswith(")"):
        negative, s = True, s[1:-1]
    if s.endswith("-"):
        negative, s = True, s[:-1]
    if s.startswith("+"):
        s = s[1:]
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")  # 1.200,00
        else:
            s = s.replace(",", "")  # 1,200.00
    elif "," in s:
        s = s.replace(",", ".")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    if not s:
        raise ParserError(f"Importe no válido: {value!r}")
    try:
        d = Decimal(s)
    except InvalidOperation as exc:
        raise ParserError(f"Importe no válido: {value!r}") from exc
    return (-d if negative else d).quantize(TWO)


def parse_date(value: object) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip().split(" ")[0].split("T")[0]
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ParserError(f"Fecha no válida: {value!r}")
