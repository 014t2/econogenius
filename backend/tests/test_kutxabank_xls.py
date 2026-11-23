import io
from datetime import date
from decimal import Decimal

import pandas as pd
import pytest

from app.imports.parsers.kutxabank_xls import parse_csv, parse_dataframe, parse_excel
from app.imports.parsers.utils import ParserError

CARD_ROWS = [
    ["Información de movimientos de tarjetas", None, None, None],
    ["Tarjeta: 4921 XXXX XXXX 5506", None, None, None],
    [None, None, None, None],
    ["fecha", "concepto", "fecha valor", "importe de la operación"],
    ["15/09/2026", "COMPRA EN LIDL OIARTZUN", "15/09/2026", -45.1],
    ["12/09/2026", "IKEA BARAKALDO FOOD", "12/09/2026", -689.58],
    ["05/09/2026", "PAGO RECIBO 4921074023875506", "05/09/2026", 509.51],
    ["Total", None, None, -225.17],
]


def test_parse_card_dataframe():
    r = parse_dataframe(pd.DataFrame(CARD_ROWS, dtype=object), "xls")
    assert r.detected_format == "kutxabank_xls_card"
    assert len(r.transactions) == 3
    t = r.transactions[1]
    assert t.concept == "IKEA BARAKALDO FOOD"
    assert t.amount == Decimal("-689.58")
    assert t.operation_date == date(2026, 9, 12)
    assert t.balance is None
    assert r.transactions[2].amount == Decimal("509.51")


def test_parse_xlsx_listado_sheet():
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        pd.DataFrame([["otra"]]).to_excel(w, sheet_name="Resumen", header=False, index=False)
        pd.DataFrame(CARD_ROWS).to_excel(w, sheet_name="Listado", header=False, index=False)
    r = parse_excel(buf.getvalue(), ".xlsx")
    assert len(r.transactions) == 3


def test_parse_csv_account_with_balance():
    csv = "Fecha;Concepto;Fecha valor;Importe;Saldo\n01/10/2026;COMPRA EN LIDL;01/10/2026;-12,30;1.000,00\n"
    r = parse_csv(csv.encode("utf-8"))
    assert r.detected_format == "kutxabank_csv_account"
    assert r.transactions[0].amount == Decimal("-12.30")
    assert r.transactions[0].balance == Decimal("1000.00")


def test_missing_header_raises():
    with pytest.raises(ParserError):
        parse_dataframe(pd.DataFrame([["a", "b"], ["c", "d"]], dtype=object))


def test_parse_multibank_cargo_abono_and_extra_concept():
    # Formato CaixaBank / Sabadell / Santander con Cargo y Abono separados + Observaciones
    csv_cargo_abono = (
        "F. Operación;Movimiento;Más datos;Cargo;Abono;Saldo disponible\n"
        "10/10/2026;PAGO CON TARJETA;MERCADONA DONOSTIA;-54,20;;1.200,00\n"
        "05/10/2026;ABONO NOMINA;EMPRESA TECH SL;;2.400,00;1.254,20\n"
    )
    r = parse_csv(csv_cargo_abono.encode("utf-8"))
    assert len(r.transactions) == 2
    assert r.transactions[0].concept == "PAGO CON TARJETA · MERCADONA DONOSTIA"
    assert r.transactions[0].amount == Decimal("-54.20")
    assert r.transactions[0].balance == Decimal("1200.00")
    assert r.transactions[1].concept == "ABONO NOMINA · EMPRESA TECH SL"
    assert r.transactions[1].amount == Decimal("2400.00")
