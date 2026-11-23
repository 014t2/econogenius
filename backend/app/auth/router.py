from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models import User, Workspace, WorkspaceMember
from app.workspaces.router import WorkspaceOut, create_workspace, list_user_workspaces

router = APIRouter(prefix="/auth", tags=["auth"])
REFRESH_COOKIE = "fc_refresh"
COOKIE_PATH = "/api/auth"


class RegisterIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def strong(cls, v: str) -> str:
        if not any(c.isdigit() for c in v) or not any(c.isalpha() for c in v):
            raise ValueError("La contraseña debe contener letras y números")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class MeOut(BaseModel):
    id: int
    email: str
    full_name: str
    workspaces: list[WorkspaceOut]


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: MeOut


def _me(db: Session, user: User) -> MeOut:
    return MeOut(id=user.id, email=user.email, full_name=user.full_name, workspaces=list_user_workspaces(db, user))


def _issue(response: Response, db: Session, user: User) -> TokenOut:
    response.set_cookie(
        REFRESH_COOKIE,
        create_refresh_token(user.id),
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path=COOKIE_PATH,
    )
    return TokenOut(
        access_token=create_access_token(user.id),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=_me(db, user),
    )


@router.post("/register", response_model=TokenOut, status_code=201)
def register(data: RegisterIn, response: Response, db: Session = Depends(get_db)):
    email = data.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe una cuenta con ese email")
    user = User(email=email, full_name=data.full_name.strip(), hashed_password=hash_password(data.password))
    db.add(user)
    db.flush()
    create_workspace(db, "Personal", user, is_personal=True)
    db.commit()
    return _issue(response, db, user)


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if user is None or not user.is_active or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email o contraseña incorrectos")
    return _issue(response, db, user)


@router.post("/refresh", response_model=TokenOut)
def refresh(response: Response, fc_refresh: str | None = Cookie(default=None), db: Session = Depends(get_db)):
    if not fc_refresh:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión expirada")
    try:
        user_id = decode_token(fc_refresh, "refresh")
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión expirada")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión expirada")
    return _issue(response, db, user)  # rotación del refresh token


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(REFRESH_COOKIE, path=COOKIE_PATH, httponly=True, secure=settings.COOKIE_SECURE, samesite="lax")


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _me(db, user)


@router.delete("/me", status_code=204)
def delete_me(response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Elimina irreversiblemente la cuenta del usuario y sus espacios donde es propietario (RGPD)."""
    owned_ws_ids = db.scalars(
        select(WorkspaceMember.workspace_id).where(
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.role == "owner",
        )
    ).all()
    for ws_id in owned_ws_ids:
        ws = db.get(Workspace, ws_id)
        if ws is not None:
            db.delete(ws)
    db.delete(user)
    db.commit()
    response.delete_cookie(
        REFRESH_COOKIE,
        path=COOKIE_PATH,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
    )
