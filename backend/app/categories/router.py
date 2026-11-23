from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_in_workspace, get_workspace
from app.models import Category, Workspace

router = APIRouter(prefix="/categories", tags=["categories"])
Group = Literal["needs", "wants", "savings", "income", "transfer"]


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    group: Group
    icon: str | None = None
    monthly_budget: Decimal | None = None


class CategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    group: Group | None = None
    icon: str | None = None
    monthly_budget: Decimal | None = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    group: str
    icon: str | None
    monthly_budget: float | None = None
    is_system: bool


@router.get("", response_model=list[CategoryOut])
def list_categories(ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    return db.scalars(select(Category).where(Category.workspace_id == ws.id).order_by(Category.group, Category.name)).all()


@router.post("", response_model=CategoryOut, status_code=201)
def create_category(data: CategoryIn, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    cat = Category(workspace_id=ws.id, **data.model_dump())
    db.add(cat)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Ya existe una categoría con ese nombre")
    return cat


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int, data: CategoryPatch, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)
):
    cat = get_in_workspace(db, Category, category_id, ws.id, "Categoría")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(cat, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Ya existe una categoría con ese nombre")
    return cat


@router.delete("/{category_id}", status_code=204)
def delete_category(category_id: int, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    cat = get_in_workspace(db, Category, category_id, ws.id, "Categoría")
    if cat.is_system:
        raise HTTPException(400, "Las categorías del sistema no se pueden eliminar (puedes renombrarlas)")
    db.delete(cat)
    db.commit()
