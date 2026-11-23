"""Esquema inicial de FinControl

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-15
"""
import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

MONEY = sa.Numeric(14, 2)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(120), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "workspaces",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("is_personal", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("base_currency", sa.String(3), nullable=False, server_default="EUR"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "workspace_members",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("workspace_id", sa.Integer, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_member"),
    )
    op.create_index("ix_workspace_members_workspace_id", "workspace_members", ["workspace_id"])
    op.create_index("ix_workspace_members_user_id", "workspace_members", ["user_id"])

    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("workspace_id", sa.Integer, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("type", sa.String(20), nullable=False, server_default="checking"),
        sa.Column("bank", sa.String(60), nullable=False, server_default="Kutxabank"),
        sa.Column("iban", sa.String(42)),
        sa.Column("card_number", sa.String(25)),
        sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
        sa.Column("initial_balance", MONEY, nullable=False, server_default="0"),
        sa.Column("current_balance", MONEY, nullable=False, server_default="0"),
        sa.Column("balance_date", sa.Date),
        sa.Column("color", sa.String(9)),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_accounts_workspace_id", "accounts", ["workspace_id"])

    op.create_table(
        "categories",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("workspace_id", sa.Integer, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("group", sa.String(20), nullable=False),
        sa.Column("icon", sa.String(40)),
        sa.Column("is_system", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("workspace_id", "name", name="uq_category_name"),
    )
    op.create_index("ix_categories_workspace_id", "categories", ["workspace_id"])

    op.create_table(
        "rules",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("workspace_id", sa.Integer, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False, server_default="category"),
        sa.Column("pattern", sa.String(160), nullable=False),
        sa.Column("match_type", sa.String(10), nullable=False, server_default="contains"),
        sa.Column("direction", sa.String(5), nullable=False, server_default="any"),
        sa.Column("category_id", sa.Integer, sa.ForeignKey("categories.id", ondelete="SET NULL")),
        sa.Column("priority", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_rules_workspace_id", "rules", ["workspace_id"])

    op.create_table(
        "import_batches",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("workspace_id", sa.Integer, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.Integer, sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("file_type", sa.String(10), nullable=False),
        sa.Column("detected_format", sa.String(40), nullable=False),
        sa.Column("language", sa.String(5)),
        sa.Column("account_number", sa.String(60)),
        sa.Column("period_start", sa.Date),
        sa.Column("period_end", sa.Date),
        sa.Column("status", sa.String(20), nullable=False, server_default="preview"),
        sa.Column("payload", sa.JSON, nullable=False),
        sa.Column("total_rows", sa.Integer, nullable=False, server_default="0"),
        sa.Column("imported_rows", sa.Integer, nullable=False, server_default="0"),
        sa.Column("duplicate_rows", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_import_batches_workspace_id", "import_batches", ["workspace_id"])
    op.create_index("ix_import_batches_account_id", "import_batches", ["account_id"])

    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("workspace_id", sa.Integer, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.Integer, sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("import_batch_id", sa.Integer, sa.ForeignKey("import_batches.id", ondelete="CASCADE")),
        sa.Column("operation_date", sa.Date, nullable=False),
        sa.Column("value_date", sa.Date),
        sa.Column("concept", sa.Text, nullable=False),
        sa.Column("normalized_concept", sa.Text, nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("balance", MONEY),
        sa.Column("category_id", sa.Integer, sa.ForeignKey("categories.id", ondelete="SET NULL")),
        sa.Column("is_internal_transfer", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("transfer_pair_id", sa.Integer),
        sa.Column("notes", sa.Text),
        sa.Column("transaction_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("account_id", "transaction_hash", name="uq_tx_hash"),
    )
    op.create_index("ix_tx_ws_date", "transactions", ["workspace_id", "operation_date"])
    op.create_index("ix_transactions_workspace_id", "transactions", ["workspace_id"])
    op.create_index("ix_transactions_account_id", "transactions", ["account_id"])
    op.create_index("ix_transactions_import_batch_id", "transactions", ["import_batch_id"])
    op.create_index("ix_transactions_category_id", "transactions", ["category_id"])


def downgrade() -> None:
    for t in ("transactions", "import_batches", "rules", "categories", "accounts", "workspace_members",
              "workspaces", "users"):
        op.drop_table(t)
