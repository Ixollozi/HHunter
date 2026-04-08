from __future__ import annotations

import re

from typing import Any

"""
Генерация письма через LLM.

По ТЗ: Groq (OpenAI-compatible), модели Qwen/Llama.
Оставляем имена функций для совместимости с существующим кодом.
"""

from .config import settings
from .groq_client import groq_chat_completion
from .logger import log_letter_generation
from .resume_pdf import polish_resume_text_for_llm, trim_resume_for_prompt


FORBIDDEN_PHRASES = """
ЗАПРЕЩЕНО использовать:
- "Я с большим интересом ознакомился с вакансией"
- "Меня привлекает возможность"
- Любые конструкции «меня заинтересовала/заинтересовало/заинтересовали вакансия…», «меня заинтересовала позиция…»
- Начинать письмо с «Ищу возможности…», «Ищу возможность…», «Хочу развиваться…», «Стремлюсь к развитию…», «В поиске возможностей…»
- Формулировки вроде «возможности для развития в разработке» в первом предложении — ввод сразу по роли и стеку, без «развития» как главной темы
- Отдельную первую строку только с названием компании и восклицательным знаком (как заголовок: «Компания!»)
- "Готов внести вклад в развитие компании"
- "Командный игрок", "стрессоустойчивый", "ответственный"
- "Буду рад стать частью вашей команды"
- Любые шаблонные вводные фразы и обрывы на полуслове (все предложения должны быть законченными)
- Слово "синергия" и подобный корпоратив
"""


def vacancy_dict_for_extension(title: str, description: str, company_name: str) -> dict[str, Any]:
    """Минимальный dict вакансии для build_prompt из данных расширения (DOM)."""
    return {
        "name": title,
        "description": description,
        "employer": {"name": company_name or ""},
        "key_skills": [],
    }


def build_prompt(vacancy: dict[str, Any], resume_text: str) -> str:
    description = (vacancy.get("description") or "")[:2800]
    employer = vacancy.get("employer") or {}
    key_skills = vacancy.get("key_skills") or []
    if key_skills and isinstance(key_skills[0], dict):
        key_skills = [x.get("name") for x in key_skills if isinstance(x, dict) and x.get("name")]
    skills_line = ", ".join(str(x) for x in key_skills if x) or "—"
    resume_block = trim_resume_for_prompt(polish_resume_text_for_llm(resume_text or ""))
    return f"""
Ты — человек, пишущий сопроводительное письмо на русском языке.
Не ИИ, не ассистент. Живой специалист.

ВАКАНСИЯ:
Название: {vacancy.get('name', '')}
Компания: {employer.get('name', '')}
Описание (реальное с hh.ru, опирайся на формулировки и стек из текста): {description}
Ключевые навыки из карточки: {skills_line}

МОЁ РЕЗЮМЕ (факты о кандидате для письма; ниже может быть текст из PDF или вставленный вручную — заголовки ##/** добавлены системой для удобства):
Нужны для письма: желаемая роль, опыт (роли, компании, сроки), стек и инструменты, 1–2 сильных проекта/достижения, образование при необходимости. Опирайся только на этот блок, не выдумывай опыт.

{resume_block}

ЗАДАЧА:
Напиши сопроводительное письмо.

ПРАВИЛА:
1. Длина: 4–6 предложений, НЕ БОЛЬШЕ; каждое предложение полностью закончено точкой (не обрывай слово в конце)
2. Первое предложение — конкретика: срок/роль/стек из резюме, связанный с названием вакансии или задачей из описания; БЕЗ «ищу возможности», БЕЗ «развитие в разработке» как старт
3. Не выделяй название компании отдельной строкой с «!» — встрой имя компании в текст естественно
4. Свяжи 1–2 своих навыка с тем, что явно в описании или в ключевых навыках (технологии — из вакансии)
5. Тон: деловой, уверенный; без «воды» про «развитие» и «возможности» в первых двух предложениях
6. Никаких списков и подзаголовков — сплошной текст
7. Не упоминай что ты "идеальный кандидат"
8. Последнее предложение — конкретное предложение созвона/встречи
9. Обращение к компании по имени (не "ваша компания")

{FORBIDDEN_PHRASES}

ПРИМЕР ХОРОШЕГО ПИСЬМА (обрати внимание: сразу факты опыта, не «ищу»):
"Пять лет в backend на Python, последние два года — платежи и лимиты в fintech.
В описании позиции упомянуты очереди и микросервисы — в прошлом проекте выводил обработку до порядка 50k операций в секунду на FastAPI и PostgreSQL.
Стек из вакансии пересекается с тем, чем занимаюсь сейчас.
Готов обсудить детали в удобное для команды Acme время."

Напиши только текст письма, без кавычек и пояснений.
""".strip()


def generate_cover_letter(
    vacancy: dict[str, Any],
    resume_text: str,
    api_key: str,
    *,
    model: str | None = None,
    attempt: int = 0,
    user_id: int | None = None,
) -> str:
    prompt = build_prompt(vacancy, resume_text)
    res = groq_chat_completion(
        api_key=api_key,
        model=model or settings.groq_default_model,
        system_prompt=(
            "Ты помогаешь соискателю написать сопроводительное письмо на русском языке под конкретную вакансию.\n"
            "Правила:\n"
            "- Только русский язык\n"
            "- Только текст письма, без темы и заголовков\n"
            "- Никогда не показывай рассуждения, план, анализ или скрытые мысли. Не используй теги <think>.\n"
            "- Не начинать с «Ищу возможности…» / «Хочу развиваться…» и подобных вводных\n"
            "- Упоминать конкретные детали из описания вакансии\n"
            "- Без шаблонных фраз\n"
        ),
        user_prompt=prompt,
        temperature=0.2,
        max_tokens=260,
    )
    raw = res.text
    meta = {
        "prompt_tokens": res.prompt_tokens,
        "completion_tokens": res.completion_tokens,
        "total_tokens": res.total_tokens,
    }
    emp = vacancy.get("employer") if isinstance(vacancy.get("employer"), dict) else {}
    log_letter_generation(
        user_id,
        {
            "stage": "model_raw",
            "attempt": attempt,
            "model": res.model_used,
            "prompt_chars": len(prompt),
            "resume_chars": len(resume_text or ""),
            "vacancy_id": str(vacancy.get("id") or "")[:32] or None,
            "vacancy_title": (vacancy.get("name") or "")[:200] or None,
            "employer": (emp.get("name") or "")[:120] or None,
            "raw_len": len(raw),
            "raw_preview": raw[:400] if raw else "",
            **meta,
        },
    )
    return raw


def clean_letter(text: str) -> str:
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
    # Иногда модель вставляет "think" без тегов — вырезаем такие блоки в начале.
    cleaned = re.sub(r"^\s*\(?\s*think\s*\)?\s*[\s\S]{0,800}?\n+", "", cleaned, flags=re.IGNORECASE).strip()
    bad_starts = [
        r"^Уважаем\w+.*?,?\s*",
        r"^Здравствуйте.*?[,!]\s*",
        r"^Я с.*?вакансией[,.]?\s*",
        r"^Ищу\s+возможност\w*[^.]{0,120}?[,:;]?\s*",
        r"^В\s+поиске\s+возможност\w*[^.]{0,120}?[,:;]?\s*",
        r"^Хочу\s+развиваться[^.]{0,100}?[,:;]?\s*",
        r"^Стремлюсь\s+к\s+развитию[^.]{0,100}?[,:;]?\s*",
        r"^Меня заинтересовал[аиоы]?[^.\n]*(?:ваканси|позици|рол[ьи]|предложени)[^.]{0,80}?[,.]?\s*",
        r"^Меня заинтересовал[аиоы]?\w*[^.\n]{0,120}?[,.]?\s*",
    ]
    for pattern in bad_starts:
        cleaned = re.sub(pattern, "", cleaned, count=1, flags=re.IGNORECASE | re.DOTALL)
    cleaned = cleaned.strip()
    # Убрать «шапку» в одну строку: только название с «!», без запятой/точки в строке
    parts = cleaned.split("\n", 1)
    if len(parts) == 2:
        fl = parts[0].strip()
        if fl.endswith("!") and "," not in fl and "." not in fl and 3 <= len(fl) <= 90:
            cleaned = parts[1].strip()
    return cleaned.strip()


def validate_letter(text: str) -> tuple[bool, str]:
    red_flags = [
        "командный игрок",
        "стрессоустойчив",
        "готов внести вклад",
        "меня привлекает возможность",
        "меня заинтересовала вакансия",
        "меня заинтересовало",
        "меня заинтересовали",
        "меня заинтересовала позиция",
        "меня заинтересовала роль",
        "с удовольствием рассмотрю",
        "идеальный кандидат",
        "ознакомился с вакансией",
        "синерг",
        "ищу возможности",
        "ищу возможность",
        "в поиске возможностей",
        "стремлюсь к развитию",
        "хочу развиваться",
        "возможности для развития",
    ]

    lower = text.lower()
    if "<think" in lower or "```" in lower:
        return False, "Лишний блок (think/code) — письмо должно быть только текстом"
    for phrase in red_flags:
        if phrase in lower:
            return False, f"Найдена шаблонная фраза: '{phrase}'"

    first_chunk = (text.lstrip()[:220] or "").lower()
    if "ищу" in first_chunk[:80] and "возможн" in first_chunk[:120]:
        return False, "Шаблонное начало: «ищу» и «возможност» в начале письма"

    first_line = (text.lstrip().split("\n")[0] or "").strip()
    if first_line.endswith("!") and "," not in first_line and "." not in first_line and len(first_line) <= 90:
        return False, "Письмо начинается как заголовок с «!» — уберите отдельную строку с названием компании"

    if len(text) > 1200:
        return False, "Письмо слишком длинное"
    if len(text) < 100:
        return False, "Письмо слишком короткое"

    tail = text.rstrip()
    if len(text) > 80 and not re.search(r"[.!?…][\"'»\)]*\s*$", tail):
        return False, "Нет завершающей пунктуации в конце письма (модель могла обрезать ответ)"

    return True, "OK"


def get_quality_letter(
    vacancy: dict[str, Any],
    resume_text: str,
    api_key: str,
    max_retries: int = 4,
    user_id: int | None = None,
    model: str | None = None,
) -> str:
    log_letter_generation(
        user_id,
        {
            "stage": "quality_loop_start",
            "max_retries": max_retries,
            "model": settings.gemini_model,
            "vacancy_id": str(vacancy.get("id") or "")[:32] or None,
            "vacancy_title": (vacancy.get("name") or "")[:200] or None,
        },
    )

    last = ""
    last_raw = ""
    last_reason = ""
    for attempt in range(max_retries + 1):
        raw = generate_cover_letter(
            vacancy,
            resume_text,
            api_key,
            model=model,
            attempt=attempt,
            user_id=user_id,
        )
        last_raw = raw
        cleaned = clean_letter(raw)
        last = cleaned
        ok, reason = validate_letter(cleaned)
        last_reason = reason
        changed_by_clean = raw.strip() != cleaned.strip()

        log_letter_generation(
            user_id,
            {
                "stage": "after_clean_validate",
                "attempt": attempt,
                "validation_ok": ok,
                "validation_message": reason,
                "cleaned_len": len(cleaned),
                "cleaned_preview": cleaned[:450] if cleaned else "",
                "changed_by_clean": changed_by_clean,
            },
        )

        if ok:
            log_letter_generation(
                user_id,
                {"stage": "quality_success", "attempt": attempt, "final_len": len(cleaned)},
            )
            return cleaned

    log_letter_generation(
        user_id,
        {
            "stage": "quality_give_up",
            "attempts": max_retries + 1,
            "last_validation": last_reason,
            "last_cleaned_preview": last[:450] if last else "",
            "last_raw_preview": last_raw[:450] if last_raw else "",
        },
    )
    return last
