from datetime import date, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.accounts.router import recalculate_account_balance
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, get_in_workspace, get_workspace
from app.imports.import_service import ImportService
from app.models import Account, ImportBatch, User, Workspace

router = APIRouter(prefix="/imports", tags=["imports"])


class PreviewRow(BaseModel):
    index: int
    operation_date: date
    value_date: date | None
    concept: str
    amount: float
    balance: float | None
    is_duplicate: bool
    category_id: int | None
    is_internal_transfer: bool
    is_owed_by_joint: bool = False
    transfer_reason: str | None
    pair_description: str | None = None
    alerts: list[str]
    merchant_hint: str


class PreviewOut(BaseModel):
    batch_id: int
    account_id: int
    filename: str
    detected_format: str
    language: str | None
    account_number: str | None
    period_start: date | None
    period_end: date | None
    warnings: list[str]
    stats: dict[str, int]
    rows: list[PreviewRow]


class Decision(BaseModel):
    index: int
    include: bool = True
    category_id: int | None = None
    is_internal_transfer: bool = False
    is_owed_by_joint: bool = False


class ConfirmIn(BaseModel):
    decisions: list[Decision] = []


class BatchOut(BaseModel):
    id: int
    account_id: int
    account_name: str
    filename: str
    detected_format: str
    status: str
    period_start: date | None
    period_end: date | None
    total_rows: int
    imported_rows: int
    duplicate_rows: int
    created_at: datetime | None


def _preview_out(b: ImportBatch) -> PreviewOut:
    rows = b.payload.get("rows", [])
    return PreviewOut(
        batch_id=b.id, account_id=b.account_id, filename=b.filename, detected_format=b.detected_format,
        language=b.language, account_number=b.account_number, period_start=b.period_start, period_end=b.period_end,
        warnings=b.payload.get("warnings", []),
        stats={
            "total": len(rows),
            "new": sum(1 for r in rows if not r["is_duplicate"]),
            "duplicates": sum(1 for r in rows if r["is_duplicate"]),
            "transfers": sum(1 for r in rows if r["is_internal_transfer"] and not r["is_duplicate"]),
            "categorized": sum(1 for r in rows if r["category_id"] and not r["is_duplicate"]),
            "alerts": sum(1 for r in rows if r["alerts"]),
        },
        rows=[PreviewRow(**r) for r in rows],
    )


@router.post("/preview", response_model=PreviewOut)
async def preview(
    account_id: int = Form(...),
    file: UploadFile = File(...),
    ws: Workspace = Depends(get_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(413, f"Tamaño máximo {settings.MAX_UPLOAD_MB} MB")
    batch = ImportService(db, ws, user).preview(account_id, file.filename, file.content_type, content)
    return _preview_out(batch)


@router.post("/{batch_id}/confirm")
def confirm(
    batch_id: int,
    data: ConfirmIn,
    ws: Workspace = Depends(get_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return ImportService(db, ws, user).confirm(batch_id, [d.model_dump() for d in data.decisions])


@router.get("", response_model=list[BatchOut])
def history(ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    batches = db.scalars(
        select(ImportBatch).where(ImportBatch.workspace_id == ws.id, ImportBatch.status == "confirmed")
        .order_by(ImportBatch.created_at.desc()).limit(50)
    ).all()
    return [
        BatchOut(
            id=b.id, account_id=b.account_id, account_name=b.account.name, filename=b.filename,
            detected_format=b.detected_format, status=b.status, period_start=b.period_start, period_end=b.period_end,
            total_rows=b.total_rows, imported_rows=b.imported_rows, duplicate_rows=b.duplicate_rows, created_at=b.created_at,
        )
        for b in batches
    ]


@router.delete("/{batch_id}", status_code=204)
def undo(batch_id: int, ws: Workspace = Depends(get_workspace), db: Session = Depends(get_db)):
    """Deshace una importación (borra sus movimientos por ON DELETE CASCADE) y recalcula el saldo real."""
    batch = get_in_workspace(db, ImportBatch, batch_id, ws.id, "Importación")
    acc_id = batch.account_id
    db.delete(batch)
    db.flush()
    acc = db.get(Account, acc_id)
    if acc is not None:
        recalculate_account_balance(db, acc)
    db.commit()
