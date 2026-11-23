"""Parsers de extractos bancarios."""
from app.imports.parsers.kutxabank_pdf import parse_pdf
from app.imports.parsers.kutxabank_xls import parse_csv, parse_excel
from app.imports.parsers.utils import ParsedTransaction, ParseResult, ParserError


def parse_file(ext: str, content: bytes) -> ParseResult:
    if ext == ".pdf":
        return parse_pdf(content)
    if ext in (".xls", ".xlsx"):
        return parse_excel(content, ext)
    if ext == ".csv":
        return parse_csv(content)
    raise ParserError(f"Formato no soportado: {ext}")


__all__ = ["parse_file", "ParseResult", "ParsedTransaction", "ParserError"]
