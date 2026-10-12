from pathlib import Path

import pytest

from app.documents import clean_extracted_text, extract_document_text
from app.errors import HttpError


def test_extract_text_file():
    text = extract_document_text("notes.txt", b"Buy milk\nPack bags")
    assert "Buy milk" in text
    assert "Pack bags" in text


def test_extract_rejects_unknown_type():
    with pytest.raises(HttpError) as exc:
        extract_document_text("photo.png", b"not-a-real-image")
    assert exc.value.status == 400


def test_extract_rejects_empty():
    with pytest.raises(HttpError) as exc:
        extract_document_text("empty.txt", b"")
    assert exc.value.status == 400


def test_clean_collapses_pdf_glued_tokens():
    messy = "Write guess.pyguess.pyguess.py using ifififif and TIME_LIMIT = 60606060"
    cleaned = clean_extracted_text(messy)
    assert "guess.py" in cleaned
    assert "guess.pyguess.py" not in cleaned
    assert "if " in cleaned or cleaned.endswith("if") or " using if " in f" {cleaned} "
    assert "60" in cleaned


def test_extract_assignment_pdf():
    path = Path(
        "/Users/Julian.Marchington/.cursor/projects/Users-Julian-Marchington-Repos-flowstate-flowstate/"
        "attachments/84339c48-200f-446c-83b9-add1488f6ab1/Numbers_Game_Assignment.pdf"
    )
    if not path.exists():
        pytest.skip("assignment pdf not attached")
    text = extract_document_text(path.name, path.read_bytes())
    assert "Classic mode" in text
    assert "Time challenge" in text or "Time Challenge" in text
    assert "guess.py" in text
    assert "genspark.fermion.app" not in text.lower()


def test_build_prompt_includes_document():
    from datetime import date

    from app.generate import build_prompt

    prompt = build_prompt(
        "Plan from brief",
        "quick",
        today=date(2026, 10, 12),
        document_text="Flight leaves Monday morning.",
    )
    assert "BEGIN DOCUMENT" in prompt
    assert "Flight leaves Monday morning." in prompt
    assert "Do NOT collapse" in prompt
    assert "5 to 8" in prompt
