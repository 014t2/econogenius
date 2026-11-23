from typing import TypeVar

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token
from app.models import User, Workspace, WorkspaceMember

bearer = HTTPBearer(auto_error=False)
T = TypeVar("T")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    exc = HTTPException(status.HTTP_401_UNAUTHORIZED, "No autenticado", headers={"WWW-Authenticate": "Bearer"})
    if credentials is None:
        raise exc
    try:
        user_id = decode_token(credentials.credentials, "access")
    except ValueError:
        raise exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise exc
    return user


def get_workspace(
    x_workspace_id: int | None = Header(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Workspace:
    """Resuelve el espacio activo (cabecera X-Workspace-Id) verificando la pertenencia del usuario.

    Sin cabecera se usa el espacio personal del usuario. Todos los datos de negocio se filtran
    por ``workspace_id`` => aislamiento estricto entre usuarios / familias.
    """
    stmt = select(Workspace).join(WorkspaceMember).where(WorkspaceMember.user_id == user.id)
    if x_workspace_id is not None:
        stmt = stmt.where(Workspace.id == x_workspace_id)
    else:
        stmt = stmt.where(Workspace.is_personal.is_(True))
    ws = db.scalars(stmt).first()
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Espacio de trabajo no encontrado")
    return ws


def get_in_workspace(db: Session, model: type[T], obj_id: int, workspace_id: int, label: str = "Recurso") -> T:
    obj = db.get(model, obj_id)
    if obj is None or getattr(obj, "workspace_id", None) != workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{label} no encontrado")
    return obj
