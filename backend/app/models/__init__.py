"""Modelos SQLAlchemy 2.0.

Esquema multi-tenant:
    User ──< WorkspaceMember >── Workspace ──< Account ──< Transaction
                                    │──< Category      │
                                    │──< Rule          └──< ImportBatch
Cada usuario tiene un Workspace personal (privado). Puede crear Workspaces compartidos
(p. ej. "Familia") e invitar a otros usuarios. Todos los datos financieros cuelgan de
``workspace_id`` y se filtran siempre por él.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

ACCOUNT_TYPES = ("checking", "credit_card", "joint", "savings")
CATEGORY_GROUPS = ("needs", "wants", "savings", "income", "transfer")
RULE_KINDS = ("category", "transfer")
MATCH_TYPES = ("contains", "regex")
DIRECTIONS = ("any", "in", "out")
MONEY = Numeric(14, 2)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    hashed_password: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    memberships: Mapped[list[WorkspaceMember]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    is_personal: Mapped[bool] = mapped_column(Boolean, default=False)
    base_currency: Mapped[str] = mapped_column(String(3), default="EUR")
    target_needs: Mapped[int] = mapped_column(Integer, default=50)
    target_wants: Mapped[int] = mapped_column(Integer, default=30)
    target_savings: Mapped[int] = mapped_column(Integer, default=20)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    members: Mapped[list[WorkspaceMember]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_member"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), default="member")  # owner | member

    workspace: Mapped[Workspace] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    owner_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    type: Mapped[str] = mapped_column(String(20), default="checking")
    bank: Mapped[str] = mapped_column(String(60), default="Kutxabank")
    iban: Mapped[str | None] = mapped_column(String(42), nullable=True)
    card_number: Mapped[str | None] = mapped_column(String(25), nullable=True)
    linked_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    initial_balance: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    current_balance: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    balance_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def resolve_account_owner(account: Account) -> str:
    """Agrupa las cuentas personales y tarjetas por titular (p. ej. 'Olatz' y 'Tarjeta Olatz' -> 'Olatz')."""
    if account.owner_name and account.owner_name.strip():
        return account.owner_name.strip()
    raw = account.name.strip()
    for prefix in ("tarjeta de credito ", "tarjeta de ", "tarjeta ", "cuenta de ", "cuenta nomina ", "cuenta "):
        if raw.lower().startswith(prefix):
            trimmed = raw[len(prefix):].strip()
            if trimmed and trimmed.lower() not in ("comun", "común", "conjunta"):
                return trimmed
    return raw


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_category_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    group: Mapped[str] = mapped_column(String(20))  # needs | wants | savings | income | transfer
    icon: Mapped[str | None] = mapped_column(String(40), nullable=True)
    monthly_budget: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)


class SavingsGoal(Base):
    __tablename__ = "savings_goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    target_amount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    current_amount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(40), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Rule(Base):
    __tablename__ = "rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="category")  # category | transfer (palabra clave)
    pattern: Mapped[str] = mapped_column(String(160))
    match_type: Mapped[str] = mapped_column(String(10), default="contains")
    direction: Mapped[str] = mapped_column(String(5), default="any")  # any | in | out
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    is_owed_by_joint: Mapped[bool] = mapped_column(Boolean, default=False)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    category: Mapped[Category | None] = relationship()


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    filename: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(10))
    detected_format: Mapped[str] = mapped_column(String(40))
    language: Mapped[str | None] = mapped_column(String(5), nullable=True)
    account_number: Mapped[str | None] = mapped_column(String(60), nullable=True)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="preview")  # preview | confirmed
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    imported_rows: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_rows: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    account: Mapped[Account] = relationship()


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint("account_id", "transaction_hash", name="uq_tx_hash"),
        Index("ix_tx_ws_date", "workspace_id", "operation_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    import_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_batches.id", ondelete="CASCADE"), nullable=True, index=True
    )
    operation_date: Mapped[date] = mapped_column(Date)
    value_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    concept: Mapped[str] = mapped_column(Text)
    normalized_concept: Mapped[str] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    balance: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_internal_transfer: Mapped[bool] = mapped_column(Boolean, default=False)
    transfer_pair_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_owed_by_joint: Mapped[bool] = mapped_column(Boolean, default=False)
    joint_settled: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    transaction_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    account: Mapped[Account] = relationship()
    category: Mapped[Category | None] = relationship()
