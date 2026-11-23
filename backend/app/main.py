from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.accounts.router import router as accounts_router
from app.analytics.router import router as analytics_router
from app.auth.router import router as auth_router
from app.categories.router import router as categories_router
from app.core.config import settings
from app.core.database import Base, engine
from app.imports.router import router as imports_router
from app.rules.router import router as rules_router
from app.transactions.router import router as transactions_router
from app.workspaces.router import router as workspaces_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.AUTO_CREATE_TABLES:
        from sqlalchemy import inspect, text
        import app.models  # noqa: F401

        Base.metadata.create_all(bind=engine)
        insp = inspect(engine)
        migrations = [
            ("workspaces", "target_needs", "INTEGER NOT NULL DEFAULT 50"),
            ("workspaces", "target_wants", "INTEGER NOT NULL DEFAULT 30"),
            ("workspaces", "target_savings", "INTEGER NOT NULL DEFAULT 20"),
            ("accounts", "owner_name", "VARCHAR(80)"),
            ("accounts", "linked_account_id", "INTEGER"),
            ("categories", "monthly_budget", "NUMERIC(14, 2)"),
            ("rules", "is_owed_by_joint", "BOOLEAN NOT NULL DEFAULT 0"),
            ("transactions", "is_owed_by_joint", "BOOLEAN NOT NULL DEFAULT 0"),
            ("transactions", "joint_settled", "BOOLEAN NOT NULL DEFAULT 0"),
        ]
        with engine.begin() as conn:
            for table_name, col_name, col_type in migrations:
                if insp.has_table(table_name):
                    existing_cols = {c["name"] for c in insp.get_columns(table_name)}
                    if col_name not in existing_cols:
                        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}"))
    yield


app = FastAPI(title="€conogenius API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Workspace-Id"],
)


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                existing = {k.lower() for k, _ in headers}
                for k, v in (
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"strict-origin-when-cross-origin"),
                ):
                    if k not in existing:
                        headers.append((k, v))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


app.add_middleware(SecurityHeadersMiddleware)


for r in (auth_router, workspaces_router, accounts_router, categories_router, rules_router,
          imports_router, transactions_router, analytics_router):
    app.include_router(r, prefix="/api")


@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok", "app": settings.APP_NAME}
