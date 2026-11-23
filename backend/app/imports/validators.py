"""Validación estricta de ficheros subidos."""
from pathlib import Path

from fastapi import HTTPException, status

from app.core.config import settings

ALLOWED: dict[str, set[str]] = {
    ".pdf": {"application/pdf"},
    ".xls": {"application/vnd.ms-excel", "application/msexcel", "application/x-msexcel", "application/xls"},
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    ".csv": {"text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"},
}
GENERIC_MIME = {"application/octet-stream", ""}


def _magic_ok(ext: str, content: bytes) -> bool:
    head = content[:8]
    if ext == ".pdf":
        return head.startswith(b"%PDF")
    if ext == ".xls":
        # OLE2 (BIFF) o HTML exportado con extensión .xls
        return head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") or content.lstrip()[:1] == b"<"
    if ext == ".xlsx":
        return head.startswith(b"PK\x03\x04")
    if ext == ".csv":
        return b"\x00" not in content[:4096]
    return False


def validate_upload(filename: str | None, content_type: str | None, content: bytes) -> str:
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Formato no permitido. Usa PDF, XLS, XLSX o CSV.")
    if len(content) == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El fichero está vacío")
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Tamaño máximo {settings.MAX_UPLOAD_MB} MB")
    mime = (content_type or "").split(";")[0].strip().lower()
    if mime not in ALLOWED[ext] and mime not in GENERIC_MIME:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"Tipo MIME no válido para {ext}: {mime}")
    if not _magic_ok(ext, content):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "El contenido del fichero no coincide con su extensión")
    return ext
