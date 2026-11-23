from collections import defaultdict
import re
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_in_workspace, get_workspace
from app.imports.reconciliation import CARD_SETTLEMENT_RE
from app.models import Account, Transaction, Workspace, resolve_account_owner

router = APIRouter(prefix="/accounts", tags=["accounts"])
AccountType = Literal["checking", "credit_card", "joint", "savings"]
ZERO = Decimal("0")


def recalculate_account_balance(db: Session, account: Account) -> Decimal:
    """Recalcula y persiste ``account.current_balance`` y ``account.balance_date`` a partir de
    las transacciones reales de la cuenta en la base de datos.
    """
    txs = db.scalars(
        select(Transaction)
        .where(Transaction.account_id == account.id)
        .order_by(Transaction.operation_date.asc(), Transaction.id.asc())
    ).all()

    if not txs:
        account.current_balance = account.initial_balance or ZERO
        account.balance_date = None
        return account.current_balance

    with_balance = [t for t in txs if t.balance is not None]
    if with_balance:
        latest_date = max(t.operation_date for t in with_balance)
        same_day = [t for t in with_balance if t.operation_date == latest_date]
        if len(same_day) == 1:
            latest_tx = same_day[0]
        else:
            if (same_day[-2].balance + same_day[-1].amount) == same_day[-1].balance:
                latest_tx = same_day[-1]
            elif (same_day[1].balance + same_day[0].amount) == same_day[0].balance:
                latest_tx = same_day[0]
            else:
                by_id = sorted(with_balance, key=lambda x: x.id)
                descending_batch = by_id[0].operation_date > by_id[-1].operation_date
                latest_tx = same_day[0] if descending_batch else same_day[-1]

        extra_delta = sum(
            (
                t.amount
                for t in txs
                if t.balance is None
                and not (
                    t.is_internal_transfer
                    and t.amount > 0
                    and CARD_SETTLEMENT_RE.search(t.normalized_concept or "")
                )
            ),
            ZERO,
        )
        account.current_balance = (latest_tx.balance or ZERO) + extra_delta
        account.balance_date = max(t.operation_date for t in txs)
        return account.current_balance

    if account.type == "credit_card":
        delta = sum((t.amount for t in txs if not t.is_internal_transfer), ZERO)
    else:
        delta = sum(
            (
                t.amount
                for t in txs
                if not (
                    t.is_internal_transfer
                    and t.amount > 0
                    and CARD_SETTLEMENT_RE.search(t.normalized_concept or "")
                )
            ),
            ZERO,
        )
    account.current_balance = (account.initial_balance or ZERO) + delta
    account.balance_date = max(t.operation_date for t in txs)
    return account.current_balance


def _clean_number(v: str | None) -> str | None:
    if v is None:
        return None
    v = re.sub(r"[\s\-]", "", v).upper()
    return v or None


class LinkedCardOut(BaseModel):
    account_id: int
    name: str
    current_balance: float


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    owner_name: str | None = Field(default=None, max_length=80)
    type: AccountType = "checking"
    bank: str = "Kutxabank"
    iban: str | None = Field(default=None, max_length=42)
    card_number: str | None = Field(default=None, max_length=25)
    linked_account_id: int | None = None
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    initial_balance: Decimal = Decimal("0")
    current_balance: Decimal | None = None
    color: str | None = None

    _n1 = field_validator("iban", "card_number")(lambda cls, v: _clean_number(v))


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    owner_name: str | None = Field(default=None, max_length=80)
    type: AccountType | None = None
    bank: str | None = Field(default=None, min_length=1, max_length=60)
    iban: str | None = None
    card_number: str | None = None
    linked_account_id: int | None = None
    initial_balance: Decimal | None = None
    current_balance: Decimal | None = None
    color: str | None = None
    is_active: bool | None = None

    _n1 = field_validator("iban", "card_number")(lambda cls, v: _clean_number(v))


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    owner_name: str | None = None
    type: str
    bank: str
    iban: str | None
    card_number: str | None
    linked_account_id: int | None = None
    linked_account_name: str | None = None
    currency: str
    initial_balance: float
    base_balance: float = 0.0
    current_balance: float
    linked_cards_balance: float = 0.0
    effective_balance: float = 0.0
    linked_cards: list[LinkedCardOut] = Field(default_factory=list)
    balance_date: date | None
    color: str | None
    is_active: bool


def _validate_linked_account(db: Session, ws_id: int, linked_id: int | None, self_id: int | None = None) -> int | None:
    if linked_id is None:
        return None
    if self_id is not None and linked_id == self_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Una cuenta no puede vincularse a sí misma")
    target = get_in_workspace(db, Account, linked_id, ws_id, "Cuenta bancaria vinculada")
    if target.type == "credit_card":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La tarjeta debe vincularse a una cuenta bancaria, no a otra tarjeta")
    return target.id


def _serialize_accounts(db: Session, ws_id: int, target_id: int | None = None) -> list[AccountOut]:
    all_accs = db.scalars(
        select(Account).where(Account.workspace_id == ws_id).order_by(Account.type, Account.name)
    ).all()
    dirty = False
    for a in all_accs:
        has_txs = db.scalar(select(Transaction.id).where(Transaction.account_id == a.id).limit(1)) is not None
        if has_txs or (not has_txs and a.current_balance != (a.initial_balance or ZERO)):
            prev_bal = a.current_balance
            recalculate_account_balance(db, a)
            if a.current_balance != prev_bal:
                dirty = True
    if dirty:
        db.commit()

    by_id = {a.id: a for a in all_accs}
    cards_by_parent: dict[int, list[Account]] = defaultdict(list)
    for a in all_accs:
        if a.linked_account_id and a.linked_account_id in by_id:
            cards_by_parent[a.linked_account_id].append(a)

    out: list[AccountOut] = []
    for a in all_accs:
        if target_id is not None and a.id != target_id:
            continue
        base_bal = a.current_balance or ZERO
        linked_cards = cards_by_parent.get(a.id, [])
        cards_bal = sum(((c.current_balance or ZERO) for c in linked_cards), ZERO)
        effective_bal = base_bal + cards_bal
        parent = by_id.get(a.linked_account_id) if a.linked_account_id else None
        out.append(
            AccountOut(
                id=a.id,
                name=a.name,
                owner_name=a.owner_name,
                type=a.type,
                bank=a.bank,
                iban=a.iban,
                card_number=a.card_number,
                linked_account_id=a.linked_account_id if parent else None,
                linked_account_name=parent.name if parent else None,
                currency=a.currency,
                initial_balance=float(a.initial_balance or ZERO),
                base_balance=float(base_bal),
                current_balance=float(effective_bal),
                linked_cards_balance=float(cards_bal),
                effective_balance=float(effective_bal),
                linked_cards=[
                    LinkedCardOut(
                        account_id=c.id,
                        name=c.name,
                        current_balance=float(c.current_balance or ZERO),
                    )
                    for c in linked_cards
                ],
                balance_date=a.balance_date,
                color=a.color,
                is_active=a.is_active,
            )
        )
    return out


@router.get("", response_model=list[AccountOut])
def list_accounts(ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    return _serialize_accounts(db, ws.id)


@router.post("", response_model=AccountOut, status_code=201)
def create_account(data: AccountIn, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    payload = data.model_dump(exclude={"current_balance"})
    payload["linked_account_id"] = _validate_linked_account(db, ws.id, data.linked_account_id)
    starting_balance = data.current_balance if data.current_balance is not None else data.initial_balance
    payload["initial_balance"] = starting_balance
    acc = Account(
        workspace_id=ws.id,
        current_balance=starting_balance,
        balance_date=None,
        **payload,
    )
    if not acc.owner_name and acc.type != "joint":
        acc.owner_name = resolve_account_owner(acc)
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return _serialize_accounts(db, ws.id, acc.id)[0]


@router.patch("/{account_id}", response_model=AccountOut)
def update_account(account_id: int, data: AccountPatch, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    acc = get_in_workspace(db, Account, account_id, ws.id, "Cuenta")
    updates = data.model_dump(exclude_unset=True)
    if "linked_account_id" in updates:
        updates["linked_account_id"] = _validate_linked_account(db, ws.id, updates["linked_account_id"], acc.id)
    for k, v in updates.items():
        setattr(acc, k, v)
    if "current_balance" in updates and updates["current_balance"] is not None:
        acc.initial_balance = updates["current_balance"]
        acc.current_balance = updates["current_balance"]
        acc.balance_date = date.today()
    db.commit()
    db.refresh(acc)
    return _serialize_accounts(db, ws.id, acc.id)[0]


@router.delete("/{account_id}", status_code=204)
def delete_account(account_id: int, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    acc = get_in_workspace(db, Account, account_id, ws.id, "Cuenta")
    db.delete(acc)  # ON DELETE CASCADE elimina sus movimientos e importaciones
    db.commit()
