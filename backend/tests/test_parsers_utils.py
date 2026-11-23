from datetime import date
from decimal import Decimal

import pytest

from app.imports.dedup import compute_transaction_hash
from app.imports.parsers.utils import ParserError, normalize_concept, parse_date, parse_eu_amount


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1.200,00 €", "1200.00"),
        ("-1.327,49 €", "-1327.49"),
        ("-1.200,00", "-1200.00"),
        ("- 45,10 €", "-45.10"),
        ("509,51", "509.51"),
        ("12.345.678,90", "12345678.90"),
        (-689.58, "-689.58"),
        (509.51, "509.51"),
        ("-689.58", "-689.58"),
        ("45,10-", "-45.10"),
    ],
)
def test_parse_eu_amount(raw, expected):
    assert parse_eu_amount(raw) == Decimal(expected)


def test_parse_eu_amount_invalid():
    with pytest.raises(ParserError):
        parse_eu_amount("abc")


@pytest.mark.parametrize(
    "raw,expected",
    [("15/09/2026", date(2026, 9, 15)), ("2026/09/15", date(2026, 9, 15)), ("2026-09-15 00:00:00", date(2026, 9, 15))],
)
def test_parse_date(raw, expected):
    assert parse_date(raw) == expected


def test_normalize_concept():
    assert normalize_concept("  Compra en  Lidl   Oiartzun ") == "COMPRA EN LIDL OIARTZUN"
    assert normalize_concept("Liquidación  intereses") == "LIQUIDACION INTERESES"


def test_hash_is_stable_and_sensitive():
    a = compute_transaction_hash(1, date(2026, 9, 1), date(2026, 9, 1), Decimal("-10.5"), "COMPRA EN LIDL")
    b = compute_transaction_hash(1, date(2026, 9, 1), date(2026, 9, 1), Decimal("-10.50"), "COMPRA EN LIDL")
    c = compute_transaction_hash(2, date(2026, 9, 1), date(2026, 9, 1), Decimal("-10.50"), "COMPRA EN LIDL")
    d = compute_transaction_hash(1, date(2026, 9, 1), date(2026, 9, 1), Decimal("-10.50"), "COMPRA EN LIDL", 1)
    assert a == b and len(a) == 64
    assert a != c and a != d
