"""Motor de categorización basado en reglas (puro, sin dependencias de BD)."""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal

from app.imports.parsers.utils import normalize_concept


@dataclass
class RuleSpec:
    id: int | None
    pattern: str
    category_id: int | None
    kind: str = "category"
    match_type: str = "contains"
    direction: str = "any"
    priority: int = 0
    is_owed_by_joint: bool = False


def compile_pattern(pattern: str, match_type: str = "contains") -> re.Pattern[str]:
    if match_type == "regex":
        return re.compile(pattern, re.IGNORECASE)
    p = normalize_concept(pattern)
    # Límite de "palabra" para evitar falsos positivos (MUGI no casa con MUGICA)
    return re.compile(r"(?<![A-Z0-9])" + re.escape(p) + r"(?![A-Z0-9])")


class Categorizer:
    def __init__(self, rules: list[RuleSpec]):
        active = sorted(rules, key=lambda r: (-r.priority, -len(r.pattern)))
        self._rules: list[tuple[RuleSpec, re.Pattern[str]]] = []
        for r in active:
            try:
                self._rules.append((r, compile_pattern(r.pattern, r.match_type)))
            except re.error:
                continue

    def match(self, normalized: str, amount: Decimal | float | None = None, kind: str = "category") -> RuleSpec | None:
        for rule, rx in self._rules:
            if rule.kind != kind:
                continue
            if amount is not None and rule.direction != "any":
                if rule.direction == "in" and amount <= 0:
                    continue
                if rule.direction == "out" and amount >= 0:
                    continue
            if rx.search(normalized):
                return rule
        return None


_PREFIXES = (
    "COMPRA EN ", "COMPRA ", "PAGO EN ", "PAGO ", "EROSKETA ", "ORDAINKETA ", "RECIBO ",
    "ERREZIBOA ", "ADEUDO ", "TRANSFERENCIA ", "TRANSF. ", "BIZUM ",
)


def extract_merchant(concept: str) -> str:
    """Sugiere el patrón de comercio para crear reglas: 'COMPRA EN LIDL OIARTZUN, CON LA TARJETA...' -> 'LIDL'."""
    s = normalize_concept(concept)
    for p in _PREFIXES:
        if s.startswith(p):
            s = s[len(p):]
            break
    s = re.split(r",| CON LA TARJETA| TXARTELA| \d{4,}| \d{2}/\d{2}", s)[0].strip()
    words = s.split()
    if not words:
        return normalize_concept(concept)[:40]
    return " ".join(words[:2]) if len(words[0]) < 4 and len(words) > 1 else words[0]
