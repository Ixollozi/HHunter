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
from .resume_pdf import extract_experience_block, polish_resume_text_for_llm


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
- Универсальные маркеры без конкретики:
  - "подходит для задач, описанных в вашей вакансии"
  - "такой же подход подходит"
  - "описанных в вашей вакансии"
"""

FIRST_SENTENCE_EXAMPLES = """
Примеры хорошего первого предложения (сразу факт/результат, без «лет опыта» и без списка технологий):
- "Переписал систему очередей — время обработки упало с 8 секунд до 400мс."
- "Сдал три API‑сервиса под нагрузку, последний держит 2k rps без деградации."
- "Оптимизировал прокси‑пул — трафик снизился в 5 раз на реальном проекте."

Плохие первые предложения:
- "Работал с FastAPI, Django, PostgreSQL..." — перечисление технологий
- "Два года занимаюсь backend‑разработкой..." — количество лет
"""

STYLE_TEMPLATES = r"""
СТИЛЕВЫЕ ШАБЛОНЫ (ориентир; не копируй дословно, а миксуй стиль и структуру):

Шаблон A — короткий:
"Работал с [СТЕК ИЗ ВАКАНСИИ] — делал похожие задачи на коммерческих проектах. За ~2 года сдал 5+ backend‑сервисов с нуля до продакшена.

Из конкретного: оптимизировал систему прокси — трафик упал в 5 раз. Настраивал Docker, Nginx, PostgreSQL в production.

Готов на созвон на этой неделе."

Шаблон B — средний:
"Увидел у вас задачу [КОНКРЕТНАЯ ЗАДАЧА ИЗ ВАКАНСИИ] — решал такое в рабочих проектах.

Последние ~2 года разрабатываю backend на FastAPI и Django: REST API, PostgreSQL, Docker, Redis/Celery. Сдал 5+ коммерческих проектов с реальными пользователями.

Один кейс: переработал систему прокси‑соединений, потребление трафика снизилось в 5 раз. Такой же подход применяю к любой задаче на оптимизацию.

Готов обсудить детали — напишите или позвоните."

Шаблон C — для хороших компаний:
"Знаком с [ЧТО ДЕЛАЕТ КОМПАНИЯ / ПРОДУКТ] — интересно попасть в команду именно здесь.

Backend на Python — мой основной стек уже ~2 года: FastAPI, Django, PostgreSQL, Docker. Работал на реальных проектах с живыми пользователями, не только в учебных задачах.

Из того что могу показать: github.com/Ixollozi — там коммерческие проекты.

Буду рад созвону."
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
    resume_block = extract_experience_block(polish_resume_text_for_llm(resume_text or ""))
    # Диагностика качества промпта: логируем только короткий превью блока опыта (без полного резюме).
    try:
        log_letter_generation(
            None,
            {
                "stage": "resume_block_preview",
                "resume_block_len": len(resume_block),
                "resume_block_preview": (resume_block or "")[:500],
            },
        )
    except Exception:
        pass
    style_extra = ""
    if (style_block or "").strip():
        style_extra = f"\nСТИЛЬ И ВАРИАЦИЯ (для этой вакансии — соблюдай):\n{style_block.strip()}\n"
    return f"""
Ты — живой специалист. Пишешь сопроводительное письмо на русском под ОДНУ конкретную вакансию.
Письмо должно быть привязано к описанию вакансии (не универсальный текст).

ВАКАНСИЯ:
Название: {vacancy.get('name', '')}
Компания: {employer.get('name', '')}
Описание: {description}
Ключевые навыки: {skills_line}

МОЁ РЕЗЮМЕ:
{resume_block}
{style_extra}
СУТЬ:
Найди 1–2 конкретные задачи/требования из описания и свяжи их с фактами из резюме (кейс/результат/цифра/контекст).

КРИТИЧНО (начало письма):
- Первое предложение НЕ про «N лет опыта» и НЕ список технологий. Только конкретный факт/действие/результат.
{FIRST_SENTENCE_EXAMPLES.strip()}

СТРУКТУРА:
- 5–7 законченных предложений (без списков/маркировок).
- 1: сильный факт/результат.
- 2–3: связь с конкретной задачей/требованием из описания (перефразируй коротко).
- 4–6: ещё 1–2 факта из резюме, которые усиливают релевантность (без «всё умею»).
- финал: одна нейтральная фраза про связь/переписку/созвон, без названия компании.

ЗАПРЕЩЕНО:
- Универсальные вводные и HR‑клише.
- Перечисление технологий списком в первом предложении.
- Последнее предложение с названием компании «для галочки».

САМOПРОВЕРКА (перед ответом):
- Есть ли в тексте минимум 3 слова/термина из описания вакансии (не считая общих слов)?
- Первое предложение — не «лет опыта» и не список технологий?
- Можно ли отправить это на другую вакансию без правок? Если да — перепиши.

{STYLE_TEMPLATES.strip()}

{FORBIDDEN_PHRASES.strip()}

Ответ: выведи только текст письма. Без кавычек, без пояснений, без заголовков.
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


def validate_letter(text: str, vacancy_description: str = "") -> tuple[bool, str]:
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
        # Универсальные фразы без привязки к вакансии
        "подходит для задач, описанных в вашей вакансии",
        "описанных в вашей вакансии",
        "такой же подход подходит",
        "похоже на задачу",
        "описанную в вакансии",
        # "в удобное время" — часто как окончание-шаблон
        "обсудить задачи в удобное",
        "рассказать подробнее или обсудить",
        "в удобное время",
        # Робо-чеклист
        "подхожу по требованиям",
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

    # Проверка привязки к вакансии: пересечение слов (>=5 букв) из описания и письма.
    vd = (vacancy_description or "").lower()
    if vd.strip():
        vacancy_words = set(re.findall(r"\b\w{5,}\b", vd))
        letter_words = set(re.findall(r"\b\w{5,}\b", lower))
        overlap = vacancy_words & letter_words
        if len(overlap) < 3:
            return False, "Письмо не содержит слов из описания вакансии"

    # Не начинать с перечисления технологий
    first_sentence = re.split(r"[.!?…\n]+", text.lstrip(), maxsplit=1)[0].strip().lower()
    if first_sentence:
        tech = {
            "python",
            "django",
            "fastapi",
            "flask",
            "postgresql",
            "postgres",
            "mysql",
            "sqlite",
            "redis",
            "kafka",
            "rabbitmq",
            "celery",
            "docker",
            "kubernetes",
            "graphql",
            "rest",
            "grpc",
            "aws",
            "gcp",
            "azure",
            "git",
            "linux",
            "ci",
            "cd",
        }
        hits = 0
        for w in re.findall(r"[a-z][a-z0-9+#._-]{1,24}", first_sentence, flags=re.IGNORECASE):
            if w.lower() in tech:
                hits += 1
        if hits >= 3 and ("," in first_sentence or " / " in first_sentence or " и " in first_sentence):
            return False, "Письмо начинается с перечисления технологий — начните с результата/факта"

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
        ok, reason = validate_letter(cleaned, vacancy_description=str(vacancy.get("description") or ""))
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

        # Если письмо не прошло валидацию — следующая попытка должна отличаться (вторая генерация не должна быть "почти той же").
        if attempt >= 0:
            temperature = min(float(temperature) + 0.08, 0.65)

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
