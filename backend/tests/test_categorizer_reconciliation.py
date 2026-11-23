from datetime import date
from decimal import Decimal

from app.categories.seed import RULES
from app.imports.parsers.utils import normalize_concept
from app.imports.reconciliation import CAT_BETWEEN, CAT_CARD, CAT_JOINT, RecRow, reconcile
from app.rules.engine import Categorizer, RuleSpec, extract_merchant

CAT_IDS = {name: i for i, name in enumerate(sorted({r[1] for r in RULES}), start=1)}
SPECS = [RuleSpec(id=i, pattern=p, category_id=CAT_IDS[c], direction=d, priority=pr) for i, (p, c, d, pr) in enumerate(RULES)]
CZ = Categorizer(SPECS)


def cat_of(concept: str, amount: str = "-10") -> str | None:
    rule = CZ.match(normalize_concept(concept), Decimal(amount))
    return next((n for n, i in CAT_IDS.items() if rule and i == rule.category_id), None)


def test_categorizer_real_examples():
    assert cat_of("COMPRA EN LIDL OIARTZUN, CON LA TARJETA : 4921XXXX") == "Alimentos"
    assert cat_of("IKEA BARAKALDO FOOD") == "Alimentos"
    assert cat_of("IKEA BARAKALDO HFB") == "Hogar"
    assert cat_of("KRED. TXAR. 4921074004230143") == "Liquidación Tarjeta de Crédito"
    assert cat_of("NORA TRASP. KB GA RENDIMIENTO E") == "Inversiones"
    assert cat_of("NOMINA EMPRESA SL", "2150") == "Sueldo"
    assert cat_of("BIZUM DE JON", "20") == "Otros Ingresos"
    assert cat_of("BIZUM A JON", "-20") == "Otros"
    assert cat_of("MUGICA ZAPATERIA") is None  # límite de palabra


def test_extract_merchant():
    assert extract_merchant("COMPRA EN LIDL OIARTZUN, CON LA TARJETA : 4921") == "LIDL"
    assert extract_merchant("COMPRA EN MERCADONA DONOSTIA") == "MERCADONA"


def row(ref, acc, typ, d, amount, concept, new=True):
    return RecRow(ref=ref, account_id=acc, account_type=typ, account_name=f"acc{acc}", operation_date=d,
                  amount=Decimal(amount), normalized_concept=normalize_concept(concept), is_new=new)


def test_card_settlement_pairs_with_card_account():
    checking = row("new:0", 1, "checking", date(2026, 9, 5), "-509.51", "TARJ.CRDTO 4921074023875506")
    card = row("db:10", 2, "credit_card", date(2026, 9, 5), "509.51", "PAGO RECIBO 4921074023875506", new=False)
    touched = reconcile([checking], [card], [])
    assert checking.is_internal_transfer and checking.transfer_category == CAT_CARD
    assert checking.pair_ref == "db:10"
    assert touched == [card] and card.transfer_category == CAT_CARD


def test_kred_txar_marked_even_without_pair():
    r = row("new:0", 1, "checking", date(2026, 9, 29), "-402.99", "KRED. TXAR. 4921074004230143")
    reconcile([r], [], [])
    assert r.is_internal_transfer and r.transfer_category == CAT_CARD and r.pair_ref is None


def test_opposite_amounts_within_3_days_joint_account():
    out = row("new:0", 1, "checking", date(2026, 9, 10), "-1200.00", "NET ER. mailegu eta gastuak")
    inc = row("db:5", 3, "joint", date(2026, 9, 11), "1200.00", "OP.NET mailegu eta gastuak - ios", new=False)
    reconcile([out], [inc], ["OP.NET", "NET ER."])
    assert out.is_internal_transfer and out.pair_ref == "db:5"
    assert out.transfer_category == CAT_JOINT


def test_opposite_amounts_outside_window_not_paired():
    a = row("new:0", 1, "checking", date(2026, 9, 1), "-277.76", "Gastos septiembre")
    b = row("db:5", 2, "checking", date(2026, 9, 10), "277.76", "Gastos septiembre", new=False)
    reconcile([a], [b], [])
    assert not a.is_internal_transfer


def test_keyword_op_net_etxea_olatz():
    r = row("new:0", 1, "checking", date(2026, 9, 30), "1200.00", "OP.NET Etxea Olatz")
    reconcile([r], [], ["OP.NET"])
    assert r.is_internal_transfer and r.transfer_category == CAT_BETWEEN
    assert "OP.NET" in r.transfer_reason


def test_atm_duplicate_alert():
    card = row("new:0", 2, "credit_card", date(2026, 9, 3), "-50.00", "PAGO CAJERO KUTXABANK")
    chk = row("db:7", 1, "checking", date(2026, 9, 3), "-50.00", "PAGO CAJERO 4921", new=False)
    reconcile([card], [chk], [])
    assert card.alerts and not card.is_internal_transfer


def test_lidl_purchase_not_transfer():
    r = row("new:0", 1, "checking", date(2026, 9, 28), "-45.10", "COMPRA EN LIDL OIARTZUN")
    reconcile([r], [], ["OP.NET", "NET ER."])
    assert not r.is_internal_transfer
