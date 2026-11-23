import os
from typing import Any

os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("AUTO_CREATE_TABLES", "false")

import anyio.to_thread  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402,F401
from app.core.database import Base, get_db, make_engine  # noqa: E402
from app.main import app  # noqa: E402


def _drive(coro):
    """Ejecuta una corrutina ASGI en memoria sin abrir sockets del SO (compatible con sandboxes)."""
    try:
        val = None
        while True:
            val = coro.send(val)
    except StopIteration as stop:
        return stop.value


class SyncASGIClient:
    """Cliente síncrono ligero sobre httpx.ASGITransport compatible con la interfaz de TestClient."""

    def __init__(self, asgi_app: Any, base_url: str = "http://testserver"):
        self._client = httpx.AsyncClient(transport=httpx.ASGITransport(app=asgi_app), base_url=base_url)

    @property
    def cookies(self):
        return self._client.cookies

    def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        return _drive(self._client.request(method, url, **kwargs))

    def get(self, url: str, **kwargs) -> httpx.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> httpx.Response:
        return self.request("POST", url, **kwargs)

    def patch(self, url: str, **kwargs) -> httpx.Response:
        return self.request("PATCH", url, **kwargs)

    def delete(self, url: str, **kwargs) -> httpx.Response:
        return self.request("DELETE", url, **kwargs)


@pytest.fixture()
def db_session():
    engine = make_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    yield Session
    engine.dispose()


@pytest.fixture()
def client(db_session, monkeypatch):
    async def _inline_run_sync(func, *args, abandon_on_cancel=False, limiter=None):
        return func(*args)

    monkeypatch.setattr(anyio.to_thread, "run_sync", _inline_run_sync)
    db = db_session()
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield SyncASGIClient(app)
    finally:
        app.dependency_overrides.clear()
        db.close()


def register(client: SyncASGIClient, email: str, name: str = "Test") -> dict:
    r = client.post("/api/auth/register", json={"email": email, "full_name": name, "password": "Secreto123"})
    assert r.status_code == 201, r.text
    return r.json()


def auth(token: str, ws: int | None = None) -> dict:
    h = {"Authorization": f"Bearer {token}"}
    if ws is not None:
        h["X-Workspace-Id"] = str(ws)
    return h
