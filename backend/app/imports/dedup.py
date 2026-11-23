"""Deduplicación robusta de movimientos."""
import hashlib
from datetime import date
from decimal import Decimal

TWO = Decimal("0.01")


def compute_transaction_hash(
    account_id: int,
    operation_date: date,
    value_date: date | None,
    amount: Decimal,
    normalized_concept: str,
    occurrence: int = 0,
) -> str:
    """SHA-256(account_id + operation_date + value_date + amount + normalized_concept).

    ``occurrence`` distingue movimientos legítimamente idénticos dentro de un mismo extracto
    (p. ej. dos cafés iguales el mismo día): el 2º recibe '#1', el 3º '#2'... Como el orden
    se conserva entre extractos solapados, la deduplicación sigue funcionando.
    """
    parts = [
        str(account_id),
        operation_date.isoformat(),
        value_date.isoformat() if value_date else "",
        f"{Decimal(amount).quantize(TWO)}",
        normalized_concept,
    ]
    if occurrence:
        parts.append(f"#{occurrence}")
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
