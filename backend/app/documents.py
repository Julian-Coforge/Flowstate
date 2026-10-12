from __future__ import annotations

import io
import re

from app.errors import HttpError

MAX_DOC_BYTES = 2 * 1024 * 1024
MAX_DOC_CHARS = 24_000
ALLOWED_SUFFIXES = (".txt", ".md", ".markdown", ".csv", ".pdf", ".docx")

# PDF/HTML exports often glue the same token 3+ times: guess.pyguess.pyguess.py, ifififif, NoneNoneNone
# Require length >= 2 so normal doubles like "http" / "Classic" are left alone.
_REPEATED_TOKEN = re.compile(r"((?:[A-Za-z_][\w.-]{1,47}|[0-9]{2,8}))\1{2,}")
_URL = re.compile(r"https?://\S+")
_PAGE_HEADER = re.compile(r"(?i)\bpage\s+\d+\s+of\s+\d+\b")
_GENSPARK = re.compile(r"(?i)genspark")
_PRINT_STAMP = re.compile(r"(?i)^\d{1,2}/\d{1,2}/\d{2,4},?\s+\d{1,2}:\d{2}\s*(am|pm)?\s*$")


def extract_document_text(filename: str, data: bytes) -> str:
    if not data:
        raise HttpError("That file is empty", 400)
    if len(data) > MAX_DOC_BYTES:
        raise HttpError("Keep documents under 2 MB", 400)

    name = (filename or "").lower().strip()
    if not any(name.endswith(suffix) for suffix in ALLOWED_SUFFIXES):
        raise HttpError("Use a .txt, .md, .pdf, or .docx file", 400)

    if name.endswith((".txt", ".md", ".markdown", ".csv")):
        text = data.decode("utf-8", errors="replace")
    elif name.endswith(".pdf"):
        text = _from_pdf(data)
    else:
        text = _from_docx(data)

    cleaned = clean_extracted_text(text)
    if not cleaned:
        raise HttpError("Could not read any text from that document", 400)
    if len(cleaned) > MAX_DOC_CHARS:
        cleaned = cleaned[:MAX_DOC_CHARS] + "…"
    return cleaned


def clean_extracted_text(text: str) -> str:
    text = text.replace("\u202f", " ").replace("\xa0", " ")
    text = _REPEATED_TOKEN.sub(r"\1", text)
    text = _URL.sub("", text)
    text = _PAGE_HEADER.sub("", text)
    text = _GENSPARK.sub("", text)
    lines: list[str] = []
    for raw in text.splitlines():
        line = " ".join(raw.split()).strip(" -|\t")
        if not line:
            if lines and lines[-1] != "":
                lines.append("")
            continue
        if _PRINT_STAMP.match(line):
            continue
        if line.lower() in {"submit your assignment", "submit", "article", "assignment", "total"}:
            continue
        if line.lower().startswith("fill in the text fields"):
            continue
        lines.append(line)
    out: list[str] = []
    for line in lines:
        if line == "" and (not out or out[-1] == ""):
            continue
        out.append(line)
    return "\n".join(out).strip()


def _from_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise HttpError("PDF support is not installed on this server", 500) from exc

    try:
        reader = PdfReader(io.BytesIO(data))
        chunks = []
        for page in reader.pages:
            chunks.append(page.extract_text() or "")
        return "\n".join(chunks)
    except Exception as exc:
        raise HttpError("Could not read that PDF", 400) from exc


def _from_docx(data: bytes) -> str:
    try:
        from docx import Document
    except ImportError as exc:
        raise HttpError("Word document support is not installed on this server", 500) from exc

    try:
        document = Document(io.BytesIO(data))
        return "\n".join(paragraph.text for paragraph in document.paragraphs)
    except Exception as exc:
        raise HttpError("Could not read that Word document", 400) from exc
