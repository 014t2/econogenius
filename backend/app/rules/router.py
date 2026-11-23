from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_in_workspace, get_workspace
from app.models import Category, Rule, Transaction, Workspace
from app.rules.engine import Categorizer, RuleSpec, compile_pattern

router = APIRouter(prefix="/rules", tags=["rules"])


class RuleIn(BaseModel):
    pattern: str = Field(min_length=2, max_length=160)
    kind: Literal["category", "transfer"] = "category"
    match_type: Literal["contains", "regex"] = "contains"
    direction: Literal["any", "in", "out"] = "any"
    category_id: int | None = None
    is_owed_by_joint: bool = False
    priority: int = 0


class RulePatch(BaseModel):
    pattern: str | None = Field(default=None, min_length=2, max_length=160)
    match_type: Literal["contains", "regex"] | None = None
    direction: Literal["any", "in", "out"] | None = None
    category_id: int | None = None
    is_owed_by_joint: bool | None = None
    priority: int | None = None
    is_active: bool | None = None


class RuleOut(BaseModel):
    id: int
    pattern: str
    kind: str
    match_type: str
    direction: str
    category_id: int | None
    category_name: str | None
    is_owed_by_joint: bool
    priority: int
    is_active: bool


def _out(r: Rule) -> RuleOut:
    return RuleOut(
        id=r.id, pattern=r.pattern, kind=r.kind, match_type=r.match_type, direction=r.direction,
        category_id=r.category_id, category_name=r.category.name if r.category else None,
        is_owed_by_joint=bool(r.is_owed_by_joint), priority=r.priority, is_active=r.is_active,
    )


def load_rule_specs(db: Session, workspace_id: int) -> list[RuleSpec]:
    rules = db.scalars(select(Rule).where(Rule.workspace_id == workspace_id, Rule.is_active.is_(True))).all()
    return [
        RuleSpec(id=r.id, pattern=r.pattern, category_id=r.category_id, kind=r.kind,
                 match_type=r.match_type, direction=r.direction, priority=r.priority,
                 is_owed_by_joint=bool(r.is_owed_by_joint))
        for r in rules
    ]


def apply_rules(db: Session, workspace_id: int, overwrite: bool = False) -> int:
    """Re-categoriza movimientos (por defecto solo los que no tienen categoría y no son traspaso)."""
    cz = Categorizer(load_rule_specs(db, workspace_id))
    stmt = select(Transaction).where(Transaction.workspace_id == workspace_id, Transaction.is_internal_transfer.is_(False))
    if not overwrite:
        stmt = stmt.where(Transaction.category_id.is_(None))
    count = 0
    for tx in db.scalars(stmt):
        rule = cz.match(tx.normalized_concept, tx.amount)
        if rule and rule.category_id and rule.category_id != tx.category_id:
            tx.category_id = rule.category_id
            count += 1
    return count


def _validate(db: Session, ws_id: int, category_id: int | None, pattern: str | None, match_type: str | None):
    if category_id is not None:
        get_in_workspace(db, Category, category_id, ws_id, "Categoría")
    if pattern and match_type == "regex":
        try:
            compile_pattern(pattern, "regex")
        except Exception:
            raise HTTPException(422, "Expresión regular no válida")


@router.get("", response_model=list[RuleOut])
def list_rules(ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    rules = db.scalars(select(Rule).where(Rule.workspace_id == ws.id).order_by(Rule.kind, Rule.pattern)).all()
    return [_out(r) for r in rules]


@router.post("", response_model=RuleOut, status_code=201)
def create_rule(data: RuleIn, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    _validate(db, ws.id, data.category_id, data.pattern, data.match_type)
    if data.kind == "category" and data.category_id is None:
        raise HTTPException(422, "Las reglas de categoría requieren category_id")
    rule = Rule(workspace_id=ws.id, **data.model_dump())
    if data.kind == "transfer" and rule.category_id is None:
        rule.category_id = db.scalar(
            select(Category.id).where(Category.workspace_id == ws.id, Category.name == "Traspaso entre Cuentas")
        )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _out(rule)


@router.patch("/{rule_id}", response_model=RuleOut)
def update_rule(rule_id: int, data: RulePatch, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    rule = get_in_workspace(db, Rule, rule_id, ws.id, "Regla")
    values = data.model_dump(exclude_unset=True)
    _validate(db, ws.id, values.get("category_id"), values.get("pattern"), values.get("match_type", rule.match_type))
    for k, v in values.items():
        setattr(rule, k, v)
    db.commit()
    db.refresh(rule)
    return _out(rule)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(rule_id: int, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    db.delete(get_in_workspace(db, Rule, rule_id, ws.id, "Regla"))
    db.commit()


@router.post("/apply")
def apply(overwrite: bool = False, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    n = apply_rules(db, ws.id, overwrite)
    db.commit()
    return {"updated": n}
