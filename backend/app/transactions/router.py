import csv
from datetime import date
from decimal import Decimal
import io
import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.accounts.router import recalculate_account_balance
from app.core.database import get_db
from app.core.deps import get_in_workspace, get_workspace
from app.imports.dedup import compute_transaction_hash
from app.imports.parsers.utils import normalize_concept
from app.imports.reconciliation import CARD_SETTLEMENT_RE
from app.models import Account, Category, Rule, Transaction, Workspace, resolve_account_owner
from app.rules.engine import Categorizer, extract_merchant
from app.rules.router import apply_rules, load_rule_specs

router = APIRouter(prefix="/transactions", tags=["transactions"])


class TransactionOut(BaseModel):
    id: int
    account_id: int
    account_name: str
    account_owner: str
    operation_date: date
    value_date: date | None
    concept: str
    amount: float
    balance: float | None
    category_id: int | None
    category_name: str | None
    category_group: str | None
    is_internal_transfer: bool
    transfer_pair_id: int | None
    is_owed_by_joint: bool = False
    joint_settled: bool = False
    notes: str | None
    merchant_hint: str


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int
    page: int
    size: int


class TransactionCreate(BaseModel):
    account_id: int
    operation_date: date
    value_date: date | None = None
    concept: str = Field(min_length=1, max_length=500)
    amount: Decimal
    category_id: int | None = None
    is_internal_transfer: bool = False
    is_owed_by_joint: bool = False
    notes: str | None = Field(default=None, max_length=1000)


class TransactionPatch(BaseModel):
    category_id: int | None = None
    is_internal_transfer: bool | None = None
    is_owed_by_joint: bool | None = None
    joint_settled: bool | None = None
    notes: str | None = Field(default=None, max_length=1000)
    create_rule: bool = False
    rule_pattern: str | None = Field(default=None, min_length=2, max_length=160)


class SettleJointIn(BaseModel):
    owner: str | None = None
    account_id: int | None = None
    transaction_ids: list[int] | None = None


class BulkDeleteIn(BaseModel):
    transaction_ids: list[int] | None = None
    delete_all: bool = False
    q: str | None = None
    account_id: int | None = None
    category_id: int | None = None
    uncategorized: bool = False
    transfers: str = "all"
    owed_by_joint: str = "all"
    date_from: date | None = None
    date_to: date | None = None


class PatchResult(BaseModel):
    transaction: TransactionOut
    rule_id: int | None = None
    recategorized: int = 0


def _out(t: Transaction, computed_balance: Decimal | None = None) -> TransactionOut:
    bal = t.balance if t.balance is not None else computed_balance
    return TransactionOut(
        id=t.id,
        account_id=t.account_id,
        account_name=t.account.name,
        account_owner=resolve_account_owner(t.account),
        operation_date=t.operation_date,
        value_date=t.value_date,
        concept=t.concept,
        amount=t.amount,
        balance=float(bal) if bal is not None else None,
        category_id=t.category_id,
        category_name=t.category.name if t.category else None,
        category_group=t.category.group if t.category else None,
        is_internal_transfer=t.is_internal_transfer,
        transfer_pair_id=t.transfer_pair_id,
        is_owed_by_joint=bool(t.is_owed_by_joint),
        joint_settled=bool(t.joint_settled),
        notes=t.notes,
        merchant_hint=extract_merchant(t.concept),
    )


def _compute_running_balances(db: Session, acc_ids: set[int]) -> dict[int, Decimal]:
    """Calcula el saldo acumulado de las transacciones que no traen columna Saldo en el extracto."""
    computed: dict[int, Decimal] = {}
    for acc_id in acc_ids:
        acc = db.get(Account, acc_id)
        if acc is None:
            continue
        all_txs = db.scalars(
            select(Transaction)
            .where(Transaction.account_id == acc_id)
            .order_by(Transaction.operation_date.asc(), Transaction.id.asc())
        ).all()
        running = acc.initial_balance or Decimal("0")
        for tx in all_txs:
            if tx.balance is not None:
                running = tx.balance
                computed[tx.id] = running
            else:
                is_card_settlement = (
                    acc.type == "credit_card" and tx.is_internal_transfer
                ) or (
                    tx.is_internal_transfer
                    and tx.amount > 0
                    and bool(CARD_SETTLEMENT_RE.search(tx.normalized_concept or ""))
                )
                if not is_card_settlement:
                    running += tx.amount
                computed[tx.id] = running
    return computed


@router.get("", response_model=TransactionPage)
def list_transactions(
    q: str | None = None,
    account_id: int | None = None,
    category_id: int | None = None,
    uncategorized: bool = False,
    transfers: str = Query("all", pattern="^(all|only|exclude)$"),
    owed_by_joint: str = Query("all", pattern="^(all|pending|settled|any)$"),
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    ws: Workspace = Depends(get_workspace),
    db: Session = Depends(get_db),
):
    conds = [Transaction.workspace_id == ws.id]
    if q:
        nq = f"%{normalize_concept(q)}%"
        conds.append(or_(Transaction.normalized_concept.like(nq), Transaction.notes.ilike(f"%{q}%")))
    if account_id:
        conds.append(Transaction.account_id == account_id)
    if uncategorized:
        conds.append(Transaction.category_id.is_(None))
    elif category_id:
        conds.append(Transaction.category_id == category_id)
    if transfers == "only":
        conds.append(Transaction.is_internal_transfer.is_(True))
    elif transfers == "exclude":
        conds.append(Transaction.is_internal_transfer.is_(False))
    if owed_by_joint == "pending":
        conds.append(Transaction.is_owed_by_joint.is_(True))
        conds.append(Transaction.joint_settled.is_(False))
    elif owed_by_joint == "settled":
        conds.append(Transaction.is_owed_by_joint.is_(True))
        conds.append(Transaction.joint_settled.is_(True))
    elif owed_by_joint == "any":
        conds.append(Transaction.is_owed_by_joint.is_(True))
    if date_from:
        conds.append(Transaction.operation_date >= date_from)
    if date_to:
        conds.append(Transaction.operation_date <= date_to)

    total = db.scalar(select(func.count()).select_from(Transaction).where(*conds)) or 0
    items = db.scalars(
        select(Transaction).options(joinedload(Transaction.account), joinedload(Transaction.category))
        .where(*conds).order_by(Transaction.operation_date.desc(), Transaction.id.desc())
        .offset((page - 1) * size).limit(size)
    ).all()
    missing_bal_accs = {t.account_id for t in items if t.balance is None}
    running_map = _compute_running_balances(db, missing_bal_accs) if missing_bal_accs else {}
    return TransactionPage(items=[_out(t, running_map.get(t.id)) for t in items], total=total, page=page, size=size)


@router.get("/export-csv")
def export_transactions_csv(
    q: str | None = None,
    account_id: int | None = None,
    category_id: int | None = None,
    uncategorized: bool = False,
    transfers: str = Query("all", pattern="^(all|only|exclude)$"),
    owed_by_joint: str = Query("all", pattern="^(all|pending|settled|any)$"),
    date_from: date | None = None,
    date_to: date | None = None,
    ws: Workspace = Depends(get_workspace),
    db: Session = Depends(get_db),
):
    """Exporta las transacciones filtradas a un fichero CSV compatible directamente con Microsoft Excel (UTF-8 BOM)."""
    conds = [Transaction.workspace_id == ws.id]
    if q:
        nq = f"%{normalize_concept(q)}%"
        conds.append(or_(Transaction.normalized_concept.like(nq), Transaction.notes.ilike(f"%{q}%")))
    if account_id:
        conds.append(Transaction.account_id == account_id)
    if uncategorized:
        conds.append(Transaction.category_id.is_(None))
    elif category_id:
        conds.append(Transaction.category_id == category_id)
    if transfers == "only":
        conds.append(Transaction.is_internal_transfer.is_(True))
    elif transfers == "exclude":
        conds.append(Transaction.is_internal_transfer.is_(False))
    if owed_by_joint == "pending":
        conds.append(Transaction.is_owed_by_joint.is_(True))
        conds.append(Transaction.joint_settled.is_(False))
    elif owed_by_joint == "settled":
        conds.append(Transaction.is_owed_by_joint.is_(True))
        conds.append(Transaction.joint_settled.is_(True))
    elif owed_by_joint == "any":
        conds.append(Transaction.is_owed_by_joint.is_(True))
    if date_from:
        conds.append(Transaction.operation_date >= date_from)
    if date_to:
        conds.append(Transaction.operation_date <= date_to)

    items = db.scalars(
        select(Transaction)
        .options(joinedload(Transaction.account), joinedload(Transaction.category))
        .where(*conds)
        .order_by(Transaction.operation_date.desc(), Transaction.id.desc())
    ).all()
    missing_bal_accs = {t.account_id for t in items if t.balance is None}
    running_map = _compute_running_balances(db, missing_bal_accs) if missing_bal_accs else {}

    buf = io.StringIO()
    buf.write("\ufeff")  # BOM UTF-8 para que Excel abra acentos y símbolos directamente
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(
        [
            "Fecha",
            "Fecha Valor",
            "Cuenta",
            "Entidad",
            "Titular",
            "Concepto",
            "Categoría",
            "Grupo 50/30/20",
            "Traspaso Interno",
            "Deuda Cuenta Común",
            "Estado Reembolso",
            "Importe (EUR)",
            "Saldo (EUR)",
            "Notas",
        ]
    )
    for t in items:
        bal = t.balance if t.balance is not None else running_map.get(t.id)
        writer.writerow(
            [
                t.operation_date.isoformat(),
                t.value_date.isoformat() if t.value_date else "",
                t.account.name,
                t.account.bank,
                resolve_account_owner(t.account),
                t.concept,
                t.category.name if t.category else "Sin categoría",
                t.category.group if t.category else "",
                "Sí" if t.is_internal_transfer else "No",
                "Sí" if t.is_owed_by_joint else "No",
                "Saldado" if (t.is_owed_by_joint and t.joint_settled) else ("Pendiente" if t.is_owed_by_joint else ""),
                f"{float(t.amount):.2f}".replace(".", ","),
                f"{float(bal):.2f}".replace(".", ",") if bal is not None else "",
                t.notes or "",
            ]
        )

    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="econogenius_transacciones.csv"'},
    )


@router.post("", response_model=TransactionOut, status_code=201)
def create_transaction(
    data: TransactionCreate,
    ws: Workspace = Depends(get_workspace),
    db: Session = Depends(get_db),
):
    account = get_in_workspace(db, Account, data.account_id, ws.id, "Cuenta")
    norm = normalize_concept(data.concept)
    category_id = data.category_id
    is_transfer = data.is_internal_transfer
    if category_id is not None:
        cat = get_in_workspace(db, Category, category_id, ws.id, "Categoría")
        if cat.group == "transfer":
            is_transfer = True
    else:
        cz = Categorizer(load_rule_specs(db, ws.id))
        rule = cz.match(norm, data.amount)
        if rule:
            category_id = rule.category_id

    tx_hash = compute_transaction_hash(
        account.id, data.operation_date, data.value_date, data.amount, f"{norm}|{uuid.uuid4().hex[:8]}"
    )
    tx = Transaction(
        workspace_id=ws.id,
        account_id=account.id,
        operation_date=data.operation_date,
        value_date=data.value_date or data.operation_date,
        concept=data.concept.strip(),
        normalized_concept=norm,
        amount=data.amount,
        balance=None,
        category_id=category_id,
        is_internal_transfer=is_transfer,
        is_owed_by_joint=bool(data.is_owed_by_joint) and account.type != "joint",
        joint_settled=False,
        notes=data.notes,
        transaction_hash=tx_hash,
    )
    db.add(tx)
    db.flush()
    recalculate_account_balance(db, account)
    db.commit()
    db.refresh(tx)
    return _out(tx, account.current_balance)


@router.patch("/{tx_id}", response_model=PatchResult)
def update_transaction(tx_id: int, data: TransactionPatch, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    tx = get_in_workspace(db, Transaction, tx_id, ws.id, "Movimiento")
    values = data.model_dump(exclude_unset=True)
    rule_id, recategorized = None, 0

    if "category_id" in values:
        cat = get_in_workspace(db, Category, values["category_id"], ws.id, "Categoría") if values["category_id"] else None
        tx.category_id = cat.id if cat else None
        if cat is not None and "is_internal_transfer" not in values:
            tx.is_internal_transfer = cat.group == "transfer"
    if "is_internal_transfer" in values and values["is_internal_transfer"] is not None:
        tx.is_internal_transfer = values["is_internal_transfer"]
        if tx.is_internal_transfer and (tx.category is None or tx.category.group != "transfer"):
            tx.category_id = db.scalar(
                select(Category.id).where(Category.workspace_id == ws.id, Category.name == "Traspaso entre Cuentas")
            )
    if "is_owed_by_joint" in values and values["is_owed_by_joint"] is not None:
        tx.is_owed_by_joint = bool(values["is_owed_by_joint"])
        if not tx.is_owed_by_joint:
            tx.joint_settled = False
    if "joint_settled" in values and values["joint_settled"] is not None:
        tx.joint_settled = bool(values["joint_settled"])
    if "notes" in values:
        tx.notes = values["notes"]

    if data.create_rule and (tx.category_id or tx.is_owed_by_joint):
        pattern = normalize_concept(data.rule_pattern or extract_merchant(tx.concept))
        cat = db.get(Category, tx.category_id) if tx.category_id else None
        kind = "transfer" if cat and cat.group == "transfer" else "category"
        rule = db.scalar(select(Rule).where(Rule.workspace_id == ws.id, Rule.pattern == pattern, Rule.kind == kind))
        if rule is None:
            rule = Rule(
                workspace_id=ws.id,
                pattern=pattern,
                kind=kind,
                category_id=tx.category_id,
                is_owed_by_joint=bool(tx.is_owed_by_joint),
                priority=50,
            )
            db.add(rule)
        else:
            if tx.category_id:
                rule.category_id = tx.category_id
            if "is_owed_by_joint" in values:
                rule.is_owed_by_joint = bool(tx.is_owed_by_joint)
        db.flush()
        rule_id = rule.id
        if kind == "category" and tx.category_id:
            recategorized = apply_rules(db, ws.id, overwrite=False)

    db.flush()
    recalculate_account_balance(db, tx.account)
    db.commit()
    db.refresh(tx)
    return PatchResult(transaction=_out(tx), rule_id=rule_id, recategorized=recategorized)


@router.post("/settle-joint")
def settle_joint_debts(data: SettleJointIn, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    """Marca como liquidadas/transferidas las deudas de la Cuenta Común hacia un titular o cuenta."""
    stmt = (
        select(Transaction)
        .options(joinedload(Transaction.account))
        .where(
            Transaction.workspace_id == ws.id,
            Transaction.is_owed_by_joint.is_(True),
            Transaction.joint_settled.is_(False),
        )
    )
    if data.account_id:
        stmt = stmt.where(Transaction.account_id == data.account_id)
    if data.transaction_ids:
        stmt = stmt.where(Transaction.id.in_(data.transaction_ids))

    txs = db.scalars(stmt).all()
    settled_count = 0
    settled_amount = Decimal("0")
    for t in txs:
        if data.owner and resolve_account_owner(t.account).lower() != data.owner.strip().lower():
            continue
        t.joint_settled = True
        settled_count += 1
        settled_amount += abs(t.amount)
    db.commit()
    return {"settled_count": settled_count, "settled_amount": float(settled_amount)}


@router.post("/bulk-delete")
def bulk_delete_transactions(data: BulkDeleteIn, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    """Elimina múltiples transacciones seleccionadas individualmente o todas las que coinciden con el filtro."""
    conds = [Transaction.workspace_id == ws.id]
    if not data.delete_all:
        if not data.transaction_ids:
            return {"deleted": 0}
        conds.append(Transaction.id.in_(data.transaction_ids))
    else:
        if data.q:
            nq = f"%{normalize_concept(data.q)}%"
            conds.append(or_(Transaction.normalized_concept.like(nq), Transaction.notes.ilike(f"%{data.q}%")))
        if data.account_id:
            conds.append(Transaction.account_id == data.account_id)
        if data.uncategorized:
            conds.append(Transaction.category_id.is_(None))
        elif data.category_id:
            conds.append(Transaction.category_id == data.category_id)
        if data.transfers == "only":
            conds.append(Transaction.is_internal_transfer.is_(True))
        elif data.transfers == "exclude":
            conds.append(Transaction.is_internal_transfer.is_(False))
        if data.owed_by_joint == "pending":
            conds.append(Transaction.is_owed_by_joint.is_(True))
            conds.append(Transaction.joint_settled.is_(False))
        elif data.owed_by_joint == "settled":
            conds.append(Transaction.is_owed_by_joint.is_(True))
            conds.append(Transaction.joint_settled.is_(True))
        if data.date_from:
            conds.append(Transaction.operation_date >= data.date_from)
        if data.date_to:
            conds.append(Transaction.operation_date <= data.date_to)

    to_delete = db.scalars(select(Transaction).where(*conds)).all()
    deleted_count = len(to_delete)
    affected_acc_ids = {tx.account_id for tx in to_delete}
    for tx in to_delete:
        db.delete(tx)
    db.flush()
    for acc_id in affected_acc_ids:
        acc_obj = db.get(Account, acc_id)
        if acc_obj is not None:
            recalculate_account_balance(db, acc_obj)
    db.commit()
    return {"deleted": deleted_count}


@router.delete("/{tx_id}", status_code=204)
def delete_transaction(tx_id: int, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    tx = get_in_workspace(db, Transaction, tx_id, ws.id, "Movimiento")
    acc_obj = db.get(Account, tx.account_id)
    db.delete(tx)
    db.flush()
    if acc_obj is not None:
        recalculate_account_balance(db, acc_obj)
    db.commit()
