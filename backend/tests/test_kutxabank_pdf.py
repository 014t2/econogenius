from datetime import date
from decimal import Decimal

from app.imports.parsers.kutxabank_pdf import parse_pdf_lines

# Texto tal y como lo devuelve pdfplumber.extract_text() en un extracto real en Español
ES_LINES = """
Kutxabank
Número: 2095 0000 00 1234567890
Período desde: 01/09/2026 hasta: 30/09/2026
Fecha Concepto Fecha valor Importe Saldo
30/09/2026 OP.NET Etxea Olatz 30/09/2026 1.200,00 € 3.527,49 €
29/09/2026 KRED. TXAR. 4921074004230143 29/09/2026 -402,99 € 2.327,49 €
28/09/2026 COMPRA EN LIDL OIARTZUN, CON LA TARJETA : 28/09/2026 -45,10 € 2.730,48 €
4921XXXXXXXX5506 EL 2026-09-27
27/09/2026 CUOTA PTMO. 0012345 27/09/2026 -1.327,49 2.775,58
€ €
25/09/2026 NOMINA EMPRESA SL 25/09/2026 2.150,00 € 4.103,07 €
Página 1 de 2
""".strip().splitlines()

# Extracto en Euskera con concepto multilínea
EU_LINES = """
Zenbakia: 2095 0000 00 9876543210
Aldia noiztik: 2026/09/01 noiz arte: 2026/09/30
Data Azalpena Balio-data Zenbatekoa Saldoa
2026/09/15 NORA TRASP. KB 2026/09/15 -1.200,00 € 5.000,00 €
GA RENDIMIENTO E
2026/09/10 NET ER. mailegu eta gastuak 2026/09/10 -1.200,00 € 6.200,00 €
2026/09/05 LIK.: INT. 2026/09/05 0,35 € 7.400,00 €
""".strip().splitlines()


def test_parse_spanish_pdf():
    r = parse_pdf_lines(ES_LINES)
    assert r.language == "es"
    assert r.detected_format == "kutxabank_pdf_es"
    assert r.account_number == "20950000001234567890"
    assert r.period_start == date(2026, 9, 1) and r.period_end == date(2026, 9, 30)
    assert len(r.transactions) == 5

    op_net = r.transactions[0]
    assert op_net.concept == "OP.NET Etxea Olatz"
    assert op_net.amount == Decimal("1200.00")
    assert op_net.balance == Decimal("3527.49")

    kred = r.transactions[1]
    assert kred.concept == "KRED. TXAR. 4921074004230143"
    assert kred.amount == Decimal("-402.99")

    lidl = r.transactions[2]
    assert lidl.concept.startswith("COMPRA EN LIDL OIARTZUN")
    assert "EL 2026-09-27" in lidl.concept  # continuación multilínea unida
    assert lidl.amount == Decimal("-45.10")

    cuota = r.transactions[3]  # el símbolo € cae a la línea siguiente
    assert cuota.amount == Decimal("-1327.49")
    assert cuota.concept == "CUOTA PTMO. 0012345"


def test_parse_basque_pdf_multiline():
    r = parse_pdf_lines(EU_LINES)
    assert r.language == "eu"
    assert r.detected_format == "kutxabank_pdf_eu"
    assert r.period_start == date(2026, 9, 1)
    assert len(r.transactions) == 3
    nora = r.transactions[0]
    assert nora.concept == "NORA TRASP. KB GA RENDIMIENTO E"
    assert nora.operation_date == date(2026, 9, 15)
    assert nora.amount == Decimal("-1200.00")
    assert r.transactions[2].amount == Decimal("0.35")


def test_row_without_header_detects_language_by_date():
    r = parse_pdf_lines(["2026/01/02 MUGI 2026/01/02 -1,50 € 100,00 €"])
    assert r.language == "eu" and r.transactions[0].amount == Decimal("-1.50")


def test_parse_multibank_pdf_two_dates_first_and_single_date():
    # Formato BBVA / Santander / CaixaBank (Fecha op | Fecha valor | Concepto | Importe | Saldo)
    bbva_lines = [
        "IBAN: ES91 2100 0418 4502 0005 1332",
        "F. Operación F. Valor Concepto Importe Saldo",
        "15-09-2026 15-09-2026 RECIBO IBERDROLA CLIENTES -82,40 € 1.450,00 €",
        "10-09-2026 10-09-2026 LIQUIDACION TARJETA CREDITO -310,00 € 1.532,40 €",
    ]
    r1 = parse_pdf_lines(bbva_lines)
    assert r1.account_number == "ES9121000418450200051332"
    assert len(r1.transactions) == 2
    assert r1.transactions[0].concept == "RECIBO IBERDROLA CLIENTES"
    assert r1.transactions[0].amount == Decimal("-82.40")

    # Formato Revolut / N26 / ING (una sola columna de fecha: Fecha | Descripción | Importe | Saldo)
    single_date_lines = [
        "2026-09-18 COMPRA EN MERCADONA -64,25 € 980,00 €",
        "2026-09-19 TRANSFERENCIA PROPIA DESDE BBVA 500,00 € 1.480,00 €",
    ]
    r2 = parse_pdf_lines(single_date_lines)
    assert len(r2.transactions) == 2
    assert r2.transactions[0].operation_date == date(2026, 9, 18)
    assert r2.transactions[0].value_date is None
    assert r2.transactions[0].amount == Decimal("-64.25")
