import pytest

from backend.letter_generation import clean_letter, validate_letter
from backend.resume_pdf import extract_experience_block


def test_clean_letter_removes_think_blocks():
    raw = "<think>secret</think>\n\nПривет! Я сделал X.\n</redacted_thinking>\n"
    cleaned = clean_letter(raw)
    assert "<think" not in cleaned.lower()
    assert "redacted" not in cleaned.lower()
    assert "Привет" in cleaned


def test_validate_letter_rejects_red_flags():
    ok, reason = validate_letter("Я командный игрок и стрессоустойчив.", vacancy_description="Python FastAPI")
    assert ok is False
    assert "шаблон" in reason.lower() or "фраз" in reason.lower()


def test_validate_letter_requires_vacancy_overlap():
    ok, reason = validate_letter(
        "Built a queue processing service and reduced latency from 8s to 400ms in production. "
        "Can share details in a short reply and provide relevant examples of similar tasks.",
        vacancy_description="Need developer for python fastapi postgresql docker redis celery",
    )
    assert ok is False
    assert "слов" in reason.lower()


def test_extract_experience_block_prefers_experience_section():
    text = """
## Желаемая должность
Backend developer

## Опыт работы
Компания A — делал API
Компания B — оптимизировал БД

## Образование
Университет
""".strip()
    out = extract_experience_block(text)
    assert out.lower().startswith("## опыт работы")
    assert "Компания A" in out
    assert "Образование" not in out

