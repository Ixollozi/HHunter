from __future__ import annotations

import hashlib
import re

from typing import Any

"""
Генерация письма через LLM.

По ТЗ: Groq (OpenAI-compatible), модели Qwen/Llama.
Имена функций сохранены для совместимости с существующим кодом.
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
- Вставку названия работодателя «для галочки»: в конце «в команду [бренд]», «в [бренд]», «соответствует требованиям позиции в [бренд]» — так не пишут живые люди
- "Готов внести вклад в развитие компании"
- "Командный игрок", "стрессоустойчивый", "ответственный"
- "Буду рад стать частью вашей команды"
- Канцелярит: «эффективно включиться в процесс», «что позволяет эффективно», «в рамках требований позиции»
- Любые шаблонные вводные фразы и обрывы на полуслове (все предложения должны быть законченными)
- Слово "синергия" и подобный корпоратив
"""


def vacancy_dict_for_extension(
    title: str,
    description: str,
    company_name: str,
    *,
    requirements: str = "",
    key_skills_text: str = "",
    salary_info: str = "",
) -> dict[str, Any]:
    """dict вакансии для build_prompt из данных расширения (DOM hh.ru / hh.uz …)."""
    skills_list: list[str] = []
    if (key_skills_text or "").strip():
        skills_list = [x.strip() for x in re.split(r"[,;•\n|]", key_skills_text) if x.strip()][:48]
    parts: list[str] = [(description or "").strip()]
    if (requirements or "").strip():
        parts.append("Требования и ожидания (фрагмент с сайта):\n" + requirements.strip()[:8000])
    if (salary_info or "").strip():
        parts.append("Зарплата (как на сайте): " + salary_info.strip()[:400])
    full_desc = "\n\n".join(p for p in parts if p)[:120_000]
    return {
        "name": title,
        "description": full_desc,
        "employer": {"name": company_name or ""},
        "key_skills": [{"name": n} for n in skills_list],
    }


def letter_style_from_seed(seed: str) -> tuple[float, str]:
    """Температура Groq и текстовые вариации, чтобы письма отличались между вакансиями."""
    h = hashlib.sha256(seed.encode("utf-8")).digest()
    t = 0.30 + (h[0] / 255.0) * 0.26
    n_lo = 5 + (h[1] % 2)
    n_hi = n_lo + 1 + (h[2] % 2)
    openings = [
        "Без приветствия «Здравствуйте» и без «уважаемые».",
        "Старт — конкретный факт из резюме (срок, роль или метрика), затем связь с формулировкой из описания.",
        "Первое предложение — про задачу из описания; следующее — как ваш опыт это закрывает.",
    ]
    closings = [
        "Последнее предложение — коротко про готовность к короткому созвону или ответу в переписке.",
        "Финал — одна нейтральная фраза; не вставляй название компании в последнее предложение.",
        "Заверши ненавязчиво: если удобно — готов уточнить детали в ответном сообщении.",
    ]
    mid = [
        "В середине явно назови не больше двух технологий.",
        "Технологии вплетай в факты, не списком через запятую в одном предложении.",
    ]
    block = (
        f"{openings[h[3] % len(openings)]}\n"
        f"{mid[h[5] % len(mid)]}\n"
        f"Длина: {n_lo}–{n_hi} законченных предложений (выбери число в этом диапазоне).\n"
        f"{closings[h[4] % len(closings)]}"
    )
    return round(t, 3), block


def build_prompt(vacancy: dict[str, Any], resume_text: str, *, style_block: str = "") -> str:
    description = (vacancy.get("description") or "")[:12000]
    employer = vacancy.get("employer") or {}
    key_skills = vacancy.get("key_skills") or []
    if key_skills and isinstance(key_skills[0], dict):
        key_skills = [x.get("name") for x in key_skills if isinstance(x, dict) and x.get("name")]
    skills_line = ", ".join(str(x) for x in key_skills if x) or "—"
    resume_block = trim_resume_for_prompt(polish_resume_text_for_llm(resume_text or ""))
    style_extra = ""
    if (style_block or "").strip():
        style_extra = f"\nСТИЛЬ И ВАРИАЦИЯ (для этой вакансии — соблюдай):\n{style_block.strip()}\n"
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
{style_extra}
ЗАДАЧА:
Напиши сопроводительное письмо так, как коротко написал бы человек рекрутеру в переписке — без «продающего» HR-тона.

ПРАВИЛА:
1. Длина и ритм: если задан блок «СТИЛЬ И ВАРИАЦИЯ» — следуй ему; иначе 4–6 коротких предложений; каждое закончено точкой (не обрывай слово в конце)
2. Первое предложение — живой факт из резюме (срок, роль, что делал), связь с задачей из описания вакансии; БЕЗ «ищу возможности», БЕЗ «развитие в разработке» как старт
3. Название работодателя из поля «Компания» НЕ обязательно упоминать. Если без имени звучит естественно — не вставляй бренд насильно. Допустимо «у вас», «в описании», «по задачам из вакансии». Не заканчивай письмо шаблоном «в команду [название компании]» или «в [название]» — это выдаёт бота
4. Не перечисляй весь стек одной строкой через запятую. В одном предложении — не больше 2–3 технологий; остальное вплети по смыслу или опусти
5. Свяжи 1–2 навыка с тем, что явно в описании или ключевых навыках вакансии
6. Тон: спокойный, разговорный деловой; короткие фразы; без «воды» про «развитие» и «возможности» в первых двух предложениях
7. Никаких списков и подзаголовков — сплошной текст
8. Не упоминай что ты "идеальный кандидат"
9. Последнее предложение — коротко про созвон или ответ на письмо, без повторного названия компании и без «удобное для команды [бренд]»

{FORBIDDEN_PHRASES}

ПРИМЕР ХОРОШЕГО ПИСЬМА (факты, без перечня технологий и без имени работодателя в конце):
"Пять лет в backend на Python, последние два года тянул платежи и лимиты в fintech.
В описании у вас упор на очереди — у нас как раз поднимали пропускную способность до порядка 50k операций в секунду, стек близкий к тому, что у вас в тексте.
Если интересно, расскажу подробнее на коротком созвоне."

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
    style_block: str = "",
    temperature: float | None = None,
) -> str:
    prompt = build_prompt(vacancy, resume_text, style_block=style_block)
    temp = 0.2 if temperature is None else max(0.08, min(0.72, float(temperature)))
    res = groq_chat_completion(
        api_key=api_key,
        model=model or settings.groq_default_model,
        system_prompt=(
            "Ты помогаешь соискателю написать сопроводительное письмо на русском языке под конкретную вакансию.\n"
            "Правила:\n"
            "- Только русский язык\n"
            "- Только текст письма, без темы и заголовков\n"
            "- Никогда не показывай рассуждения, план, анализ или скрытые мысли. Не используй теги <redacted_thinking>.\n"
            "- Не начинать с «Ищу возможности…» / «Хочу развиваться…» и подобных вводных\n"
            "- Опирайся на описание вакансии, но не копируй формулировки «как от робота»\n"
            "- Не обязательно называть компанию-работодателя по имени; не вставляй бренд в последнее предложение насильно\n"
            "- Короткие предложения, разговорный деловой тон; не перечисляй весь стек через запятую в одном предложении\n"
            "- Без шаблонных HR-фраз\n"
        ),
        user_prompt=prompt,
        temperature=temp,
        max_tokens=300,
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
    cleaned = re.sub(r"<redacted_thinking>[\s\S]*?</redacted_thinking>", "", text, flags=re.IGNORECASE).strip()
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
        "соответствует требованиям позиции",
        "эффективно включиться",
        "в существующий процесс разработки",
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

    desc_snip = str(vacancy.get("description") or "")[:520]
    emp = vacancy.get("employer") if isinstance(vacancy.get("employer"), dict) else {}
    style_seed = f"{vacancy.get('name') or ''}|{emp.get('name') or ''}|{desc_snip}"
    temperature, style_block = letter_style_from_seed(style_seed)

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
            style_block=style_block,
            temperature=temperature,
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
