"""Conciliación anti-doble contabilidad (lógica pura, testeable sin BD).

1. Liquidación de tarjeta: ``TARJ.CRDTO nnnn`` / ``KRED. TXAR. nnnn`` en cuenta corriente
   <-> ``PAGO RECIBO nnnn`` en la tarjeta  => Transferencia Interna > Liquidación Tarjeta de Crédito.
2. Traspasos: importes opuestos entre cuentas del mismo espacio en ±3 días, o palabras clave
   configurables (``OP.NET``, ``NET ER.``...) => Transferencia Interna > Traspaso ...
3. Alerta de cajero: ``PAGO CAJERO`` con mismo importe y fecha en tarjeta y cuenta corriente.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from app.rules.engine import compile_pattern

CARD_SETTLEMENT_RE = re.compile(
    r"(TARJ\.?\s?CRDTO|KRED\.?\s?TXAR\.?|PAGO RECIBO|ORDAINAGIRIA ORDAINTZEA|LIQUIDACION TARJETA|LIQ\.?\s?TARJETA|"
    r"RECIBO TARJETA|CARGO TARJETA CREDITO|EXTRACTO TARJETA)\s*(\d{4,19})?"
)
ATM_RE = re.compile(
    r"PAGO CAJERO|KUTXAZ\.?\s?ORD|KUTXAZAIN|ESKUDIRU|REINTEGRO|DIRU-?ATERATZEA|RETIRADA CAJERO|"
    r"CAJERO AUTOMATICO|DISPOSICION CAJERO|DISPOSICION EFECTIVO|ATM WITHDRAWAL"
)

CAT_CARD = "Liquidación Tarjeta de Crédito"
CAT_JOINT = "Traspaso Cuenta Común"
CAT_BETWEEN = "Traspaso entre Cuentas"


@dataclass
class RecRow:
    ref: str  # "new:<idx>" | "db:<id>"
    account_id: int
    account_type: str
    account_name: str
    operation_date: date
    amount: Decimal
    normalized_concept: str
    is_new: bool = True
    is_internal_transfer: bool = False
    transfer_category: str | None = None
    transfer_reason: str | None = None
    pair_ref: str | None = None
    alerts: list[str] = field(default_factory=list)


def _transfer_category(a: RecRow, b: RecRow | None = None) -> str:
    types = {a.account_type} | ({b.account_type} if b else set())
    if "credit_card" in types and b is not None:
        return CAT_CARD
    if "joint" in types:
        return CAT_JOINT
    return CAT_BETWEEN


def _mark(row: RecRow, category: str, reason: str, pair: RecRow | None = None) -> None:
    row.is_internal_transfer = True
    row.transfer_category = category
    row.transfer_reason = row.transfer_reason or reason
    if pair is not None:
        row.pair_ref = pair.ref


def _find_pair(row: RecRow, pool: list[RecRow], max_days: int, extra=None) -> RecRow | None:
    best: tuple[int, RecRow] | None = None
    for c in pool:
        if c is row or c.account_id == row.account_id or c.pair_ref is not None:
            continue
        if c.amount != -row.amount:
            continue
        diff = abs((c.operation_date - row.operation_date).days)
        if diff > max_days or (extra and not extra(c)):
            continue
        if best is None or diff < best[0]:
            best = (diff, c)
    return best[1] if best else None


def reconcile(
    new_rows: list[RecRow],
    existing_rows: list[RecRow],
    transfer_keywords: list[str],
    window_days: int = 3,
    card_window_days: int = 7,
) -> list[RecRow]:
    """Marca ``new_rows`` (y sus parejas existentes) in-place. Devuelve las filas existentes modificadas."""
    pool = new_rows + existing_rows
    touched: dict[str, RecRow] = {}
    keyword_rx = [(kw, compile_pattern(kw)) for kw in transfer_keywords if kw.strip()]

    def link(a: RecRow, b: RecRow, category: str, reason_a: str, reason_b: str):
        _mark(a, category, reason_a, b)
        _mark(b, category, reason_b, a)
        if not b.is_new:
            touched[b.ref] = b

    # 1) Liquidación de tarjeta de crédito
    for row in new_rows:
        m = CARD_SETTLEMENT_RE.search(row.normalized_concept)
        if not m:
            continue
        card_no = m.group(2)
        _mark(row, CAT_CARD, f"Liquidación de tarjeta{' ' + card_no[-4:].rjust(8, '•') if card_no else ''}")
        pair = _find_pair(
            row, pool, card_window_days,
            extra=lambda c: c.account_type == "credit_card" or row.account_type == "credit_card"
            or bool(CARD_SETTLEMENT_RE.search(c.normalized_concept)),
        )
        if pair:
            link(row, pair, CAT_CARD, row.transfer_reason, f"Pago de la tarjeta desde «{row.account_name}»")

    # 2a) Palabras clave configurables
    for row in new_rows:
        if row.is_internal_transfer:
            continue
        for kw, rx in keyword_rx:
            if rx.search(row.normalized_concept):
                _mark(row, _transfer_category(row), f"Palabra clave «{kw}»")
                break

    # 2b) Importes opuestos entre cuentas del espacio (±window_days)
    for row in new_rows:
        if row.pair_ref is not None or ATM_RE.search(row.normalized_concept):
            continue
        pair = _find_pair(row, pool, window_days, extra=lambda c: not ATM_RE.search(c.normalized_concept))
        if pair:
            cat = row.transfer_category if row.is_internal_transfer and row.transfer_category != CAT_BETWEEN else _transfer_category(row, pair)
            if cat == CAT_CARD and not (row.account_type == "credit_card" or pair.account_type == "credit_card"):
                cat = _transfer_category(row)
            link(
                row, pair, cat,
                f"Importe opuesto en «{pair.account_name}» ({pair.operation_date:%d/%m/%Y})",
                f"Importe opuesto en «{row.account_name}» ({row.operation_date:%d/%m/%Y})",
            )

    # 3) Alerta de retirada en cajero duplicada (tarjeta + cuenta corriente)
    for row in new_rows:
        if not ATM_RE.search(row.normalized_concept):
            continue
        for c in pool:
            if c is row or c.account_id == row.account_id:
                continue
            if "credit_card" not in (row.account_type, c.account_type):
                continue
            if c.amount == row.amount and c.operation_date == row.operation_date and ATM_RE.search(c.normalized_concept):
                row.alerts.append(
                    f"Posible retirada en cajero duplicada: mismo importe y fecha en «{c.account_name}». "
                    "Revisa para no contabilizar dos veces el efectivo."
                )
                break

    return list(touched.values())
