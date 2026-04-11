from __future__ import annotations

import hashlib
import re
import time

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
- Начинать письмо с «N лет опыта», «N лет в разработке», «N месяцев в backend» — это шаблон, не показывающий релевантность
- «что позволяет эффективно включиться в существующий процесс разработки» и любые вариации
- «соответствует требованиям позиции в [компания]»
- «готов обсудить детали в удобное для команды время»
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
Ты — живой специалист, пишешь сопроводительное письмо под конкретную вакансию.
Не ИИ. Не шаблон. Живой человек который прочитал описание и пишет именно про эту вакансию.

ВАКАНСИЯ:
Название: {vacancy.get('name', '')}
Компания: {employer.get('name', '')}
Описание: {description}
Ключевые навыки: {skills_line}

МОЁ РЕЗЮМЕ:
{resume_block}
{style_extra}
ЗАДАЧА:
Прочитай описание вакансии внимательно. Найди 1-2 конкретные задачи или требования которые прямо совпадают с опытом кандидата из резюме. Напиши письмо вокруг этого совпадения — покажи что кандидат решал именно такие задачи.

ЖЁСТКИЕ ПРАВИЛА:

СТРУКТУРА (строго):
- Предложение 1: конкретное действие или результат из резюме (не «N лет опыта», не «работал с технологией») — что именно делал, построил, решил
- Предложение 2-3: прямая связь с конкретной задачей или требованием из описания вакансии — процитируй или перефразируй что-то из описания и покажи как твой опыт это закрывает
- Предложение 4-5: 1-2 дополнительных факта из резюме которые усиливают первые два предложения
- Финал: одна короткая фраза про готовность обсудить — без названия компании

ЗАПРЕЩЕНО:
- Начинать с «N лет опыта», «N месяцев», «Два года», «Год и» — это шаблон который все пишут
- Копировать фразы из резюме дословно
- Писать обобщённо без привязки к конкретной вакансии — письмо должно подходить ТОЛЬКО этой вакансии
- Перечислять технологии списком через запятую в одном предложении
- «Готов внести вклад», «командный игрок», «стрессоустойчивый»
- «соответствует требованиям позиции в [компания]»
- «готов обсудить в удобное для команды время»
- «работал с X, Y, Z, A, B» — перегруженные перечисления
- Называть компанию в последнем предложении
- Любые шаблонные HR-фразы

ТЕСТ ПЕРЕД ОТПРАВКОЙ (проверь сам):
- Можно ли это письмо отправить на другую вакансию без изменений? Если да — перепиши
- Есть ли в письме хоть одна конкретная деталь из описания вакансии? Если нет — перепиши
- Начинается ли с количества лет/месяцев? Если да — перепиши

{FORBIDDEN_PHRASES}

ПРИМЕР ХОРОШЕГО ПИСЬМА для вакансии где нужен опыт с очередями и нагрузкой:
"Переписывал систему обработки событий под нагрузку — до этого она роняла сервис при 500 rps, после стала держать 5k.
В описании у вас упор на масштабирование и брокеры сообщений — это прямо то что мы решали, использовали Kafka и партиционирование по tenant_id.
Покрыл критические пути тестами, настроил алерты — не пришлось дежурить по ночам.
Готов рассказать детали на созвоне."

ПРИМЕР ПЛОХОГО ПИСЬМА (так писать нельзя):
"Два года опыта в backend-разработке на Python, включая проектирование REST API..." — шаблон, не про эту вакансию
"Разрабатывал REST API для обработки больших объёмов данных, включая интеграции с брокерами..." — обобщённо, подходит для любой вакансии

Напиши только текст письма. Без кавычек, без пояснений, без тегов. Сразу первое предложение.
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
    last_exc = None
    m = (model or settings.groq_default_model).lower()
    # Groq Qwen3: иначе в content попадают теги <think> / </redacted_thinking> (reasoning в сыром виде).
    groq_extra: dict[str, Any] = {}
    if "qwen3" in m:
        groq_extra["reasoning_effort"] = "none"
        groq_extra["reasoning_format"] = "hidden"

    for _attempt in range(3):
        try:
            res = groq_chat_completion(
                api_key=api_key,
                model=model or settings.groq_default_model,
                extra_body=groq_extra or None,
                system_prompt=(
                    "Ты помогаешь соискателю написать сопроводительное письмо на русском языке под конкретную вакансию.\n"
                    "Правила:\n"
                    "- Только русский язык\n"
                    "- Только текст письма, без темы и заголовков\n"
                    "- НИКОГДА не используй теги <think>, </think>, <thinking>, </thinking> и любые блоки размышлений. Выводи ТОЛЬКО финальный текст письма.\n"
                    "- Без преамбулы: не пиши «план», «шаги», «сначала», «нужно» — сразу текст письма работодателю, с первого значимого предложения.\n"
                    "- Никогда не показывай рассуждения, план, анализ или скрытые мысли.\n"
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
            break
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            time.sleep(2 * (_attempt + 1))
    else:
        raise last_exc  # type: ignore[misc]

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
    return clean_letter(raw)


def clean_letter(text: str) -> str:
    """Убирает think/redacted-блоки Qwen3, в т.ч. сиротский </redacted_thinking> перед текстом письма."""
    cleaned = str(text or "").replace("\ufeff", "").strip()
    # Невидимые символы между «буквами» тега ломают простые regex
    cleaned = re.sub(r"[\u200b-\u200f\u202a-\u202e\ufeff\u2060-\u2064]", "", cleaned)
    _tag = (
        r"redacted_thinking|redacted_reasoning|thinking|think"
        r"|thought|reasoning"
    )
    _pair = re.compile(
        rf"<\s*(?:{_tag})\s*>[\s\S]*?</\s*(?:{_tag})\s*>",
        re.IGNORECASE,
    )
    _orphan_close = re.compile(rf"</\s*(?:{_tag})\s*>\s*", re.IGNORECASE)
    _orphan_open = re.compile(rf"<\s*(?:{_tag})\s*>", re.IGNORECASE)
    _empty_pair = re.compile(
        rf"<\s*(?:{_tag})\s*>\s*</\s*(?:{_tag})\s*>",
        re.IGNORECASE,
    )
    for _ in range(16):
        prev = cleaned
        cleaned = _pair.sub("", cleaned).strip()
        cleaned = _empty_pair.sub("", cleaned).strip()
        cleaned = re.sub(r"<think\s*/?>\s*", "", cleaned, flags=re.IGNORECASE).strip()
        # Сиротские теги (часто модель оставляет только закрывающий перед письмом)
        cleaned = _orphan_close.sub("", cleaned).strip()
        cleaned = _orphan_open.sub("", cleaned).strip()
        cleaned = re.sub(r"^\s*\(?\s*think\s*\)?\s*[\s\S]{0,800}?\n+", "", cleaned, flags=re.IGNORECASE).strip()
        _bq = chr(96)
        for _wrapped in (
            _bq + "</redacted_thinking>" + _bq,
            _bq + "</thinking>" + _bq,
            _bq + "<redacted_thinking>" + _bq,
            _bq + "<thinking>" + _bq,
        ):
            cleaned = cleaned.replace(_wrapped, "").strip()
        if cleaned == prev:
            break
    # Строки, состоящие только из служебных тегов
    _bq_esc = re.escape(chr(96))
    _tag_only = re.compile(
        rf"</?\s*(?:{_tag})\s*>|<think\s*/?>|"
        + _bq_esc
        + r"</?\s*(?:redacted_thinking|redacted_reasoning|thinking)\s*>"
        + _bq_esc,
        re.IGNORECASE,
    )
    kept: list[str] = []
    for line in cleaned.splitlines():
        s = line.strip()
        if not s:
            kept.append(line)
            continue
        if _tag_only.fullmatch(s):
            continue
        kept.append(line)
    cleaned = "\n".join(kept).strip()
    cleaned = cleaned.lstrip()
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
    if re.search(
        r"<redacted_thinking|</think>|<redacted_reasoning|</redacted_reasoning>|"
        r"<thinking|</thinking>|<reasoning|</reasoning>|<thought|</thought>|"
        r"<think[\s/>]",
        text,
        re.IGNORECASE,
    ):
        return False, "Остались служебные теги размышлений — письмо должно быть только текстом"
    if "```" in lower:
        return False, "Лишний блок (code) — письмо должно быть только текстом"
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
    max_retries: int = 1,
    user_id: int | None = None,
    model: str | None = None,
) -> str:
    log_letter_generation(
        user_id,
        {
            "stage": "quality_loop_start",
            "max_retries": max_retries,
            "model": model or settings.groq_default_model,
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
        # generate_cover_letter уже возвращает clean_letter(ответ модели)
        cleaned = raw
        last = cleaned
        ok, reason = validate_letter(cleaned)
        last_reason = reason
        changed_by_clean = False

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
