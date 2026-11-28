from datetime import date
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.accounts.router import recalculate_account_balance
from app.categories.seed import seed_workspace
from app.core.database import get_db
from app.core.deps import get_current_user, get_in_workspace, get_workspace
from app.imports.dedup import compute_transaction_hash
from app.imports.parsers.utils import normalize_concept
from app.models import Account, Category, Rule, SavingsGoal, Transaction, User, Workspace, WorkspaceMember
from app.rules.router import apply_rules

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


class WorkspaceOut(BaseModel):
    id: int
    name: str
    is_personal: bool
    role: str
    target_needs: int = 50
    target_wants: int = 30
    target_savings: int = 20


class WorkspaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class WorkspacePatch(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class MemberIn(BaseModel):
    email: EmailStr


class MemberOut(BaseModel):
    user_id: int
    email: str
    full_name: str
    role: str


class OnboardingMemberIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    bank: str = Field(default="Kutxabank", max_length=60)
    initial_balance: Decimal = Decimal("0")
    has_card: bool = True


class OnboardingIn(BaseModel):
    mode: Literal["individual", "couple", "family"] = "couple"
    members: list[OnboardingMemberIn] = Field(default_factory=list)
    create_joint_account: bool = True
    joint_account_name: str = "Cuenta Común"
    joint_bank: str = "Kutxabank"
    joint_initial_balance: Decimal = Decimal("0")
    target_needs: int = Field(default=50, ge=0, le=100)
    target_wants: int = Field(default=30, ge=0, le=100)
    target_savings: int = Field(default=20, ge=0, le=100)


class SavingsGoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    target_amount: Decimal = Field(gt=Decimal("0"))
    current_amount: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    target_date: date | None = None
    icon: str | None = "piggy-bank"
    color: str | None = "#10B981"


class SavingsGoalPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    target_amount: Decimal | None = None
    current_amount: Decimal | None = None
    add_amount: Decimal | None = None
    target_date: date | None = None
    icon: str | None = None
    color: str | None = None


class SavingsGoalOut(BaseModel):
    id: int
    name: str
    target_amount: float
    current_amount: float
    remaining_amount: float
    progress_pct: float
    target_date: date | None
    months_left: int | None
    monthly_needed: float | None
    icon: str | None
    color: str | None


def serialize_savings_goal(g: SavingsGoal) -> SavingsGoalOut:
    target = float(g.target_amount or Decimal("0"))
    current = float(g.current_amount or Decimal("0"))
    remaining = max(0.0, round(target - current, 2))
    pct = round(min(100.0, (current / target * 100.0) if target > 0 else 0.0), 1)
    months_left: int | None = None
    monthly_needed: float | None = None
    if g.target_date:
        today = date.today()
        diff_months = (g.target_date.year - today.year) * 12 + (g.target_date.month - today.month)
        months_left = max(1, diff_months) if g.target_date >= today else 1
        monthly_needed = round(remaining / months_left, 2) if remaining > 0 else 0.0
    return SavingsGoalOut(
        id=g.id,
        name=g.name,
        target_amount=target,
        current_amount=current,
        remaining_amount=remaining,
        progress_pct=pct,
        target_date=g.target_date,
        months_left=months_left,
        monthly_needed=monthly_needed,
        icon=g.icon,
        color=g.color,
    )


def create_workspace(db: Session, name: str, owner: User, is_personal: bool) -> Workspace:
    ws = Workspace(name=name, is_personal=is_personal, target_needs=50, target_wants=30, target_savings=20)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="owner"))
    seed_workspace(db, ws.id)
    return ws


def list_user_workspaces(db: Session, user: User) -> list[WorkspaceOut]:
    rows = db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember)
        .where(WorkspaceMember.user_id == user.id)
        .order_by(Workspace.is_personal.desc(), Workspace.name)
    ).all()
    return [
        WorkspaceOut(
            id=w.id,
            name=w.name,
            is_personal=w.is_personal,
            role=r,
            target_needs=w.target_needs or 50,
            target_wants=w.target_wants or 30,
            target_savings=w.target_savings or 20,
        )
        for w, r in rows
    ]


def _membership(db: Session, ws_id: int, user: User) -> WorkspaceMember:
    m = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws_id, WorkspaceMember.user_id == user.id))
    if m is None:
        raise HTTPException(404, "Espacio de trabajo no encontrado")
    return m


@router.get("", response_model=list[WorkspaceOut])
def list_workspaces(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list_user_workspaces(db, user)


@router.post("", response_model=WorkspaceOut, status_code=201)
def create_shared_workspace(data: WorkspaceIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ws = create_workspace(db, data.name, user, is_personal=False)
    db.commit()
    return WorkspaceOut(id=ws.id, name=ws.name, is_personal=False, role="owner")


@router.patch("/{ws_id}", response_model=WorkspaceOut)
def rename_workspace(
    ws_id: int,
    data: WorkspacePatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = _membership(db, ws_id, user)
    if m.role != "owner":
        raise HTTPException(403, "Solo el propietario puede renombrar el espacio")
    ws = db.get(Workspace, ws_id)
    if ws is None:
        raise HTTPException(404, "Espacio de trabajo no encontrado")
    ws.name = data.name.strip()
    db.commit()
    db.refresh(ws)
    return WorkspaceOut(
        id=ws.id,
        name=ws.name,
        is_personal=ws.is_personal,
        role=m.role,
        target_needs=ws.target_needs or 50,
        target_wants=ws.target_wants or 30,
        target_savings=ws.target_savings or 20,
    )


@router.delete("/{ws_id}", status_code=204)
def delete_workspace(
    ws_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Elimina un espacio de trabajo y todos sus datos asociados (cuentas, movimientos, reglas, metas)."""
    m = _membership(db, ws_id, user)
    if m.role != "owner":
        raise HTTPException(403, "Solo el propietario puede eliminar el espacio")
    user_workspaces = list_user_workspaces(db, user)
    if len(user_workspaces) <= 1:
        raise HTTPException(
            400,
            "Debes conservar al menos un espacio activo. Si deseas borrar todo, usa la opción de eliminar tu cuenta en RGPD.",
        )
    ws = db.get(Workspace, ws_id)
    if ws is None:
        raise HTTPException(404, "Espacio de trabajo no encontrado")
    db.delete(ws)
    db.commit()


@router.get("/{ws_id}/members", response_model=list[MemberOut])
def list_members(ws_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _membership(db, ws_id, user)
    rows = db.execute(
        select(User, WorkspaceMember.role).join(WorkspaceMember).where(WorkspaceMember.workspace_id == ws_id)
    ).all()
    return [MemberOut(user_id=u.id, email=u.email, full_name=u.full_name, role=r) for u, r in rows]


@router.post("/{ws_id}/members", response_model=MemberOut, status_code=201)
def add_member(ws_id: int, data: MemberIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = _membership(db, ws_id, user)
    if m.role != "owner":
        raise HTTPException(403, "Solo el propietario puede invitar miembros")
    if m.workspace.is_personal:
        raise HTTPException(400, "El espacio personal es privado. Crea un espacio compartido para invitar a otros.")
    invitee = db.scalar(select(User).where(User.email == data.email.lower()))
    if invitee is None:
        raise HTTPException(404, "No existe ningún usuario registrado con ese email")
    exists = db.scalar(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws_id, WorkspaceMember.user_id == invitee.id)
    )
    if exists:
        raise HTTPException(409, "El usuario ya es miembro")
    db.add(WorkspaceMember(workspace_id=ws_id, user_id=invitee.id, role="member"))
    db.commit()
    return MemberOut(user_id=invitee.id, email=invitee.email, full_name=invitee.full_name, role="member")


@router.delete("/{ws_id}/members/{user_id}", status_code=204)
def remove_member(ws_id: int, user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = _membership(db, ws_id, user)
    if m.role != "owner" and user_id != user.id:
        raise HTTPException(403, "Solo el propietario puede eliminar miembros")
    target = db.scalar(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws_id, WorkspaceMember.user_id == user_id)
    )
    if target is None:
        raise HTTPException(404, "Miembro no encontrado")
    if target.role == "owner":
        raise HTTPException(400, "No se puede eliminar al propietario")
    db.delete(target)
    db.commit()


@router.post("/onboarding")
def run_onboarding_wizard(
    data: OnboardingIn,
    ws: Workspace = Depends(get_workspace),
    db: Session = Depends(get_db),
):
    """Asistente de bienvenida personalizable (Individual / En pareja / Familia):
    configura regla de ahorro, crea cuentas de titulares, tarjetas vinculadas, cuenta común y reglas de traspaso.
    """
    ws.target_needs = data.target_needs
    ws.target_wants = data.target_wants
    ws.target_savings = data.target_savings

    existing_accs = {
        a.name.lower(): a
        for a in db.scalars(select(Account).where(Account.workspace_id == ws.id)).all()
    }
    transfer_cat = db.scalar(
        select(Category).where(Category.workspace_id == ws.id, Category.name == "Traspaso entre Cuentas")
    )
    existing_rules = {
        (r.pattern.upper(), r.kind)
        for r in db.scalars(select(Rule).where(Rule.workspace_id == ws.id)).all()
    }

    created_accounts: list[str] = []
    created_rules: list[str] = []

    for m in data.members:
        clean_name = m.name.strip()
        if not clean_name:
            continue
        acc_key = clean_name.lower()
        if acc_key not in existing_accs:
            personal_acc = Account(
                workspace_id=ws.id,
                name=clean_name,
                owner_name=clean_name,
                type="checking",
                bank=m.bank.strip() or "Kutxabank",
                initial_balance=m.initial_balance,
                current_balance=m.initial_balance,
            )
            db.add(personal_acc)
            db.flush()
            existing_accs[acc_key] = personal_acc
            created_accounts.append(personal_acc.name)
        else:
            personal_acc = existing_accs[acc_key]

        if m.has_card:
            card_name = f"Tarjeta {clean_name}"
            card_key = card_name.lower()
            if card_key not in existing_accs:
                card_acc = Account(
                    workspace_id=ws.id,
                    name=card_name,
                    owner_name=clean_name,
                    type="credit_card",
                    bank=m.bank.strip() or "Kutxabank",
                    linked_account_id=personal_acc.id,
                    initial_balance=Decimal("0"),
                    current_balance=Decimal("0"),
                )
                db.add(card_acc)
                db.flush()
                existing_accs[card_key] = card_acc
                created_accounts.append(card_acc.name)

        for kw in (f"TRANSF. {clean_name.upper()}", f"ETXEA {clean_name.upper()}"):
            if (kw, "transfer") not in existing_rules:
                db.add(
                    Rule(
                        workspace_id=ws.id,
                        kind="transfer",
                        pattern=kw,
                        category_id=transfer_cat.id if transfer_cat else None,
                        priority=25,
                    )
                )
                existing_rules.add((kw, "transfer"))
                created_rules.append(kw)

    if data.create_joint_account and data.mode in ("couple", "family"):
        j_name = data.joint_account_name.strip() or "Cuenta Común"
        if j_name.lower() not in existing_accs:
            j_acc = Account(
                workspace_id=ws.id,
                name=j_name,
                owner_name=None,
                type="joint",
                bank=data.joint_bank.strip() or "Kutxabank",
                initial_balance=data.joint_initial_balance,
                current_balance=data.joint_initial_balance,
            )
            db.add(j_acc)
            db.flush()
            created_accounts.append(j_acc.name)

    db.commit()
    return {
        "created_accounts": created_accounts,
        "created_rules": created_rules,
        "targets": {
            "needs": ws.target_needs,
            "wants": ws.target_wants,
            "savings": ws.target_savings,
        },
    }


@router.get("/savings-goals", response_model=list[SavingsGoalOut])
def list_savings_goals(ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    goals = db.scalars(
        select(SavingsGoal).where(SavingsGoal.workspace_id == ws.id).order_by(SavingsGoal.id.asc())
    ).all()
    return [serialize_savings_goal(g) for g in goals]


@router.post("/savings-goals", response_model=SavingsGoalOut, status_code=201)
def create_savings_goal(data: SavingsGoalIn, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    goal = SavingsGoal(workspace_id=ws.id, **data.model_dump())
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return serialize_savings_goal(goal)


@router.patch("/savings-goals/{goal_id}", response_model=SavingsGoalOut)
def update_savings_goal(
    goal_id: int,
    data: SavingsGoalPatch,
    ws: Workspace = Depends(get_workspace),
    db: Session = Depends(get_db),
):
    goal = get_in_workspace(db, SavingsGoal, goal_id, ws.id, "Objetivo de ahorro")
    updates = data.model_dump(exclude_unset=True)
    add_amt = updates.pop("add_amount", None)
    for k, v in updates.items():
        setattr(goal, k, v)
    if add_amt is not None:
        goal.current_amount = max(Decimal("0"), (goal.current_amount or Decimal("0")) + Decimal(str(add_amt)))
    db.commit()
    db.refresh(goal)
    return serialize_savings_goal(goal)


@router.delete("/savings-goals/{goal_id}", status_code=204)
def delete_savings_goal(goal_id: int, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    goal = get_in_workspace(db, SavingsGoal, goal_id, ws.id, "Objetivo de ahorro")
    db.delete(goal)
    db.commit()


@router.get("/current/backup")
def export_workspace_backup(ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    """Exporta una copia de seguridad completa en JSON del espacio activo (portabilidad total)."""
    accounts = db.scalars(select(Account).where(Account.workspace_id == ws.id).order_by(Account.id)).all()
    categories = db.scalars(select(Category).where(Category.workspace_id == ws.id).order_by(Category.id)).all()
    rules = db.scalars(select(Rule).where(Rule.workspace_id == ws.id).order_by(Rule.id)).all()
    goals = db.scalars(select(SavingsGoal).where(SavingsGoal.workspace_id == ws.id).order_by(SavingsGoal.id)).all()
    transactions = db.scalars(
        select(Transaction).where(Transaction.workspace_id == ws.id).order_by(Transaction.operation_date.asc(), Transaction.id.asc())
    ).all()

    acc_by_id = {a.id: a.name for a in accounts}
    cat_by_id = {c.id: c.name for c in categories}

    return {
        "version": "1.0",
        "exported_at": date.today().isoformat(),
        "workspace": {
            "name": ws.name,
            "base_currency": ws.base_currency,
            "target_needs": ws.target_needs or 50,
            "target_wants": ws.target_wants or 30,
            "target_savings": ws.target_savings or 20,
        },
        "accounts": [
            {
                "name": a.name,
                "owner_name": a.owner_name,
                "type": a.type,
                "bank": a.bank,
                "iban": a.iban,
                "card_number": a.card_number,
                "linked_account_name": acc_by_id.get(a.linked_account_id) if a.linked_account_id else None,
                "currency": a.currency,
                "initial_balance": float(a.initial_balance or 0),
                "current_balance": float(a.current_balance or 0),
            }
            for a in accounts
        ],
        "categories": [
            {
                "name": c.name,
                "group": c.group,
                "icon": c.icon,
                "monthly_budget": float(c.monthly_budget) if c.monthly_budget is not None else None,
                "is_system": c.is_system,
            }
            for c in categories
        ],
        "rules": [
            {
                "kind": r.kind,
                "pattern": r.pattern,
                "match_type": r.match_type,
                "direction": r.direction,
                "category_name": cat_by_id.get(r.category_id) if r.category_id else None,
                "is_owed_by_joint": bool(r.is_owed_by_joint),
                "priority": r.priority,
            }
            for r in rules
        ],
        "savings_goals": [
            {
                "name": g.name,
                "target_amount": float(g.target_amount or 0),
                "current_amount": float(g.current_amount or 0),
                "target_date": g.target_date.isoformat() if g.target_date else None,
                "icon": g.icon,
                "color": g.color,
            }
            for g in goals
        ],
        "transactions": [
            {
                "account_name": acc_by_id.get(t.account_id, ""),
                "operation_date": t.operation_date.isoformat(),
                "value_date": t.value_date.isoformat() if t.value_date else None,
                "concept": t.concept,
                "amount": float(t.amount),
                "balance": float(t.balance) if t.balance is not None else None,
                "category_name": cat_by_id.get(t.category_id) if t.category_id else None,
                "is_internal_transfer": bool(t.is_internal_transfer),
                "is_owed_by_joint": bool(t.is_owed_by_joint),
                "joint_settled": bool(t.joint_settled),
                "notes": t.notes,
                "transaction_hash": t.transaction_hash,
            }
            for t in transactions
        ],
    }


@router.post("/current/restore")
def restore_workspace_backup(
    payload: dict[str, Any],
    ws: Workspace = Depends(get_workspace),
    db: Session = Depends(get_db),
):
    """Restaura un backup JSON en 1 clic sin duplicar cuentas, categorías, reglas ni transacciones."""
    ws_meta = payload.get("workspace") or {}
    if isinstance(ws_meta.get("target_needs"), int):
        ws.target_needs = ws_meta["target_needs"]
    if isinstance(ws_meta.get("target_wants"), int):
        ws.target_wants = ws_meta["target_wants"]
    if isinstance(ws_meta.get("target_savings"), int):
        ws.target_savings = ws_meta["target_savings"]

    cat_map = {c.name.lower(): c for c in db.scalars(select(Category).where(Category.workspace_id == ws.id)).all()}
    for c_in in payload.get("categories") or []:
        c_name = (c_in.get("name") or "").strip()
        if not c_name:
            continue
        existing_c = cat_map.get(c_name.lower())
        if existing_c is None:
            existing_c = Category(
                workspace_id=ws.id,
                name=c_name,
                group=c_in.get("group") or "needs",
                icon=c_in.get("icon"),
                monthly_budget=Decimal(str(c_in["monthly_budget"])) if c_in.get("monthly_budget") is not None else None,
                is_system=bool(c_in.get("is_system", False)),
            )
            db.add(existing_c)
            db.flush()
            cat_map[c_name.lower()] = existing_c
        elif c_in.get("monthly_budget") is not None:
            existing_c.monthly_budget = Decimal(str(c_in["monthly_budget"]))

    acc_map = {a.name.lower(): a for a in db.scalars(select(Account).where(Account.workspace_id == ws.id)).all()}
    pending_links: list[tuple[Account, str]] = []
    restored_accounts = 0
    for a_in in payload.get("accounts") or []:
        a_name = (a_in.get("name") or "").strip()
        if not a_name:
            continue
        acc = acc_map.get(a_name.lower())
        if acc is None:
            acc = Account(
                workspace_id=ws.id,
                name=a_name,
                owner_name=a_in.get("owner_name"),
                type=a_in.get("type") or "checking",
                bank=a_in.get("bank") or "Kutxabank",
                iban=a_in.get("iban"),
                card_number=a_in.get("card_number"),
                currency=a_in.get("currency") or "EUR",
                initial_balance=Decimal(str(a_in.get("initial_balance", 0))),
                current_balance=Decimal(str(a_in.get("current_balance", 0))),
            )
            db.add(acc)
            db.flush()
            acc_map[a_name.lower()] = acc
            restored_accounts += 1
        if a_in.get("linked_account_name"):
            pending_links.append((acc, str(a_in["linked_account_name"]).lower()))

    for child_acc, parent_name_lower in pending_links:
        parent_acc = acc_map.get(parent_name_lower)
        if parent_acc and parent_acc.id != child_acc.id:
            child_acc.linked_account_id = parent_acc.id

    existing_rules = {
        (r.pattern.upper(), r.kind)
        for r in db.scalars(select(Rule).where(Rule.workspace_id == ws.id)).all()
    }
    for r_in in payload.get("rules") or []:
        pat = (r_in.get("pattern") or "").strip().upper()
        kind = r_in.get("kind") or "category"
        if not pat or (pat, kind) in existing_rules:
            continue
        cat_obj = cat_map.get(str(r_in.get("category_name") or "").lower())
        db.add(
            Rule(
                workspace_id=ws.id,
                kind=kind,
                pattern=pat,
                match_type=r_in.get("match_type") or "contains",
                direction=r_in.get("direction") or "any",
                category_id=cat_obj.id if cat_obj else None,
                is_owed_by_joint=bool(r_in.get("is_owed_by_joint", False)),
                priority=int(r_in.get("priority", 10)),
            )
        )
        existing_rules.add((pat, kind))

    existing_goals = {
        g.name.lower() for g in db.scalars(select(SavingsGoal).where(SavingsGoal.workspace_id == ws.id)).all()
    }
    for g_in in payload.get("savings_goals") or []:
        g_name = (g_in.get("name") or "").strip()
        if not g_name or g_name.lower() in existing_goals:
            continue
        db.add(
            SavingsGoal(
                workspace_id=ws.id,
                name=g_name,
                target_amount=Decimal(str(g_in.get("target_amount", 0))),
                current_amount=Decimal(str(g_in.get("current_amount", 0))),
                target_date=date.fromisoformat(g_in["target_date"]) if g_in.get("target_date") else None,
                icon=g_in.get("icon") or "piggy-bank",
                color=g_in.get("color") or "#10B981",
            )
        )
        existing_goals.add(g_name.lower())

    restored_txs = 0
    for t_in in payload.get("transactions") or []:
        acc_obj = acc_map.get(str(t_in.get("account_name") or "").lower())
        if acc_obj is None:
            continue
        op_date = date.fromisoformat(t_in["operation_date"])
        val_date = date.fromisoformat(t_in["value_date"]) if t_in.get("value_date") else None
        amt = Decimal(str(t_in.get("amount", 0)))
        bal = Decimal(str(t_in["balance"])) if t_in.get("balance") is not None else None
        concept = str(t_in.get("concept") or "")
        norm = normalize_concept(concept)
        tx_hash = t_in.get("transaction_hash") or compute_transaction_hash(acc_obj.id, op_date, val_date, amt, norm)
        exists_tx = db.scalar(
            select(Transaction.id).where(Transaction.account_id == acc_obj.id, Transaction.transaction_hash == tx_hash)
        )
        if exists_tx:
            continue
        cat_obj = cat_map.get(str(t_in.get("category_name") or "").lower())
        db.add(
            Transaction(
                workspace_id=ws.id,
                account_id=acc_obj.id,
                operation_date=op_date,
                value_date=val_date,
                concept=concept,
                normalized_concept=norm,
                amount=amt,
                balance=bal,
                category_id=cat_obj.id if cat_obj else None,
                is_internal_transfer=bool(t_in.get("is_internal_transfer", False)),
                is_owed_by_joint=bool(t_in.get("is_owed_by_joint", False)),
                joint_settled=bool(t_in.get("joint_settled", False)),
                notes=t_in.get("notes"),
                transaction_hash=tx_hash,
            )
        )
        restored_txs += 1

    db.flush()
    apply_rules(db, ws.id, overwrite=False)
    for acc_obj in acc_map.values():
        recalculate_account_balance(db, acc_obj)
    db.commit()
    return {"restored_accounts": restored_accounts, "restored_transactions": restored_txs}
