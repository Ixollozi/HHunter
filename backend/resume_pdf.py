from __future__ import annotations

import re
import unicodedata
from io import BytesIO

from pypdf import PdfReader

MAX_RESUME_PDF_BYTES = 6 * 1024 * 1024
MAX_PDF_PAGES = 40

_HH_SECTION_MARKERS: tuple[str, ...] = (
    "Желаемая должность и зарплата",
    "Желаемая должность",
    "Желательное время в пути до работы",
    "Опыт работы",
    "Повышение квалификации, курсы",
    "Повышение квалификации",
    "Ключевые навыки",
    "Образование",
    "Знание языков",
    "Тип занятости",
    "Формат работы",
    "Навыки",
    "О себе",
    "Специализации",
    "Обязанности",
    "Достижения",
)

# Типичные «склейки» в экспорте PDF с hh.ru (без пробелов между словами)
_HH_GLUED_REPLACEMENTS: tuple[tuple[str, str], ...] = tuple(
    reversed(
        sorted(
            [
                ("Желаемаядолжностьизарплата", "Желаемая должность и зарплата"),
                ("Желательноевремявпутидоработы", "Желательное время в пути до работы"),
                ("неболеечаса", "не более часа"),
                ("Типзанятости", "Тип занятости"),
                ("полнаязанятость", "полная занятость"),
                ("Форматработы", "Формат работы"),
                ("местеработодателя", "месте работодателя"),
                ("Опытработы", "Опыт работы"),
                ("Неготовкпереезду", "Не готов к переезду"),
                ("неготовккомандировкам", "не готов к командировкам"),
                ("естьразрешениенаработу", "есть разрешение на работу"),
                ("предпочитаемыйспособсвязи", "предпочитаемый способ связи"),
                ("Знаниеязыков", "Знание языков"),
                ("Разрабатываюнадёжные", "Разрабатываю надёжные"),
                ("серверныерешенияна", "серверные решения на"),
                ("сфокусомначистуюархитектуру", "с фокусом на чистую архитектуру"),
                ("масштабируемостьиреальнуюбизнес-ценность", "масштабируемость и реальную бизнес-ценность"),
                ("Проектированиеиразработка", "Проектирование и разработка"),
                ("сиспользованием", "с использованием"),
                ("JWT-аутентификациииинтеграцийсостороннимисервисами", "JWT-аутентификации и интеграций со сторонними сервисами"),
                ("Telegram-ботовисистемавтоматизациидлябизнес-задач", "Telegram-ботов и систем автоматизации для бизнес-задач"),
                ("Проектированиеиоптимизациябазданных", "Проектирование и оптимизация баз данных"),
                ("эффективныхзапросов", "эффективных запросов"),
                ("Контейнеризацияприложенийс", "Контейнеризация приложений с"),
                ("production-окружениячерез", "production-окружения через"),
                ("Подключениеиработасброкерамисообщений", "Подключение и работа с брокерами сообщений"),
                ("асинхроннойобработкизадач", "асинхронной обработки задач"),
                ("Написаниетестовсиспользованием", "Написание тестов с использованием"),
                ("контролькачествакодаирефакторинг", "контроль качества кода и рефакторинг"),
                ("Работасданнымичерез", "Работа с данными через"),
                ("Ведениепроектовчерез", "Ведение проектов через"),
                ("Разработализадеплоилнесколько", "Разработал и задеплоил несколько"),
                ("проектовснуля", "проектов с нуля"),
                ("включаявеб-приложенияс", "включая веб-приложения с"),
                ("реальнымипользователями", "реальными пользователями"),
                ("Переработалсистемуработыспрокси", "Переработал систему работы с прокси"),
                ("вместосозданияновогосоединениянакаждыйзапрос", "вместо создания нового соединения на каждый запрос"),
                ("сделалпулспереиспользованиемиумнойротацией", "сделал пул с переиспользованием и умной ротацией"),
                ("Потреблениетрафикаупалов", "Потребление трафика упало в"),
                ("Обеспечилпокрытиекодатестамичерез", "Обеспечил покрытие кода тестами через"),
                ("снизивколичестворегрессийпри", "снизив количество регрессий при"),
                ("итеративнойразработке", "итеративной разработке"),
                ("Алгоритмыиструктурыданных", "Алгоритмы и структуры данных"),
                ("Рефакторингкода", "Рефакторинг кода"),
            ],
            key=lambda x: len(x[0]),
        )
    )
)

RESUME_TEXT_PROMPT_MAX = 10000


def _space_quality_score(text: str) -> float:
    """Выше — больше похоже на нормальный текст с пробелами."""
    if not text.strip():
        return 0.0
    spaces = text.count(" ")
    letters = sum(1 for c in text if c.isalpha())
    if letters == 0:
        return 0.0
    glued = len(re.findall(r"[а-яёa-z]{4,}[А-ЯЁA-Z][а-яёa-z]{2,}", text))
    return spaces / max(letters, 1) - glued * 0.15


def _extract_pdfplumber_word_lines(raw: bytes) -> str:
    import pdfplumber

    chunks: list[str] = []
    with pdfplumber.open(BytesIO(raw)) as pdf:
        for page in pdf.pages[:MAX_PDF_PAGES]:
            try:
                words = page.extract_words(use_text_flow=True) or []
            except TypeError:
                words = page.extract_words() or []
            if not words:
                t = (page.extract_text() or "").strip()
                if t:
                    chunks.append(t)
                continue
            words.sort(key=lambda w: (w.get("top", 0), w.get("x0", 0)))
            lines: list[str] = []
            row: list[str] = []
            last_top: float | None = None
            hs = [w.get("height") or 0 for w in words if (w.get("height") or 0) > 0]
            y_tol = max(3.0, (sum(hs) / len(hs)) * 0.75) if hs else 4.0
            for w in words:
                top = float(w.get("top", 0))
                if last_top is not None and abs(top - last_top) > y_tol:
                    if row:
                        lines.append(" ".join(row))
                    row = []
                row.append(w.get("text") or "")
                last_top = top
            if row:
                lines.append(" ".join(row))
            chunks.append("\n".join(lines))
    return "\n\n".join(chunks).strip()


def _extract_pypdf(raw: bytes) -> str:
    reader = PdfReader(BytesIO(raw))
    if getattr(reader, "is_encrypted", False):
        raise ValueError("PDF с паролем — экспортируйте с hh копию без защиты")
    parts: list[str] = []
    for page in reader.pages[:MAX_PDF_PAGES]:
        layout = ""
        try:
            layout = page.extract_text(extraction_mode="layout") or ""
        except Exception:
            pass
        plain = page.extract_text() or ""
        lu, pu = layout.strip(), plain.strip()
        txt = layout if len(lu) >= max(30, len(pu) * 0.5) else plain
        if txt.strip():
            parts.append(txt.strip())
    return "\n\n".join(parts).strip()


def _apply_glued_dictionary(text: str) -> str:
    t = text
    for bad, good in _HH_GLUED_REPLACEMENTS:
        t = re.sub(f"(?i){re.escape(bad)}", good, t)
    return t


def _heuristic_spacing(text: str) -> str:
    """Пробелы после знаков; телефон +998(70); ФамилияИмя на строке."""
    t = text
    t = re.sub(r"([,;:])([А-Яа-яЁёA-Za-z])", r"\1 \2", t)
    t = re.sub(r"(\d)([а-яё]{3,}\b)", r"\1 \2", t, flags=re.IGNORECASE)
    t = re.sub(r"(\d)(год\b|месяц|месяцев\b)", r"\1 \2", t, flags=re.IGNORECASE)
    t = re.sub(r"([А-Яа-яЁё])(\d)", r"\1 \2", t)
    t = re.sub(r"(\+\d{1,4})\((\d{2,4})\)(\d[\d\s]*)", r"\1 (\2) \3", t)
    t = re.sub(r"(?m)^([А-ЯЁ][а-яё]{2,})([А-ЯЁ][а-яё]{2,})$", r"\1 \2", t)
    t = re.sub(r"([а-яё])([А-ЯЁ])([а-яё]{2,})", r"\1 \2\3", t)
    return t


def _norm_line_key(s: str) -> str:
    return re.sub(r"\s+", "", s.lower())


def _is_footer_or_noise_line(line: str) -> bool:
    n = _norm_line_key(line)
    if "резюмеобновлено" in n:
        return True
    if re.match(r"^[•·]\s*", line.strip()) and "обновлен" in n:
        return True
    if re.fullmatch(r"[•·]\s*резюме\s*обновлено[^\n]*", line.strip(), re.I):
        return True
    return False


def _strip_noise_lines(text: str) -> str:
    lines = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if _is_footer_or_noise_line(stripped):
            continue
        lines.append(line.rstrip())
    return "\n".join(lines)


def _dedupe_adjacent_lines(text: str) -> str:
    lines = text.split("\n")
    out: list[str] = []
    prev_norm = ""
    for line in lines:
        n = _norm_line_key(line)
        if n and n == prev_norm:
            continue
        out.append(line)
        if n:
            prev_norm = n
        else:
            prev_norm = ""
    return "\n".join(out)


def _dedupe_duration_lines(text: str) -> str:
    """Одинаковые строки «N год M месяцев» — оставляем одну."""
    pat = re.compile(r"^\s*\d+\s+год\s+\d+\s+месяц", re.I)
    seen_keys: set[str] = set()
    lines = text.split("\n")
    out: list[str] = []
    for line in lines:
        if pat.search(line):
            key = re.sub(r"\s+", " ", line.strip().lower())
            if key in seen_keys:
                continue
            seen_keys.add(key)
        out.append(line)
    return "\n".join(out)


def _merge_duplicate_section_headers(text: str) -> str:
    """Вторая и последующие одинаковые ## … — убираем только заголовок."""
    lines = text.split("\n")
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        if line.startswith("## "):
            key = re.sub(r"\s+", " ", line[3:].strip().lower())
            if key in seen:
                continue
            seen.add(key)
        out.append(line)
    return "\n".join(out)


def polish_resume_text_for_llm(text: str) -> str:
    if not text or not text.strip():
        return ""

    t = unicodedata.normalize("NFKC", text)
    t = t.replace("\u00a0", " ")
    t = t.replace("\u202f", " ")
    t = t.replace("\u2009", " ")
    t = t.replace("\r\n", "\n").replace("\r", "\n")

    t = _apply_glued_dictionary(t)
    t = _heuristic_spacing(t)

    t = _strip_noise_lines(t)
    t = _dedupe_adjacent_lines(t)

    cyr_word_before = r"([А-Яа-яЁёA-Za-z0-9\)\.\:])"

    for marker in sorted(_HH_SECTION_MARKERS, key=len, reverse=True):
        base = marker.rstrip(":").rstrip()
        esc = re.escape(base)
        t = re.sub(
            rf"{cyr_word_before}(\s*{esc}:?)",
            r"\1\n\n## \2\n",
            t,
            flags=re.IGNORECASE,
        )
        t = re.sub(
            rf"(?m)^(?!##\s)({esc})(:?)(\s.*)?$",
            r"## \1\2\3",
            t,
            flags=re.IGNORECASE,
        )

    t = re.sub(r"(?<!\n)([•·])\s+", r"\n\1 ", t)
    t = re.sub(r"(?<!\n)—\s{2,}", r"\n— ", t)

    lines = []
    for line in t.split("\n"):
        line = re.sub(r"[ \t]{2,}", " ", line).rstrip()
        if line:
            lines.append(line)
    t = "\n".join(lines)
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = re.sub(r"(?m)^##\s*$", "", t)

    t = _merge_duplicate_section_headers(t)
    t = _dedupe_duration_lines(t)
    t = _strip_noise_lines(t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def trim_resume_for_prompt(text: str, limit: int = RESUME_TEXT_PROMPT_MAX) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit("\n", 1)[0]
    return cut.rstrip() + "\n\n[… текст резюме сокращён для промпта …]"


def extract_resume_pdf_text(raw: bytes) -> str:
    if len(raw) > MAX_RESUME_PDF_BYTES:
        raise ValueError("Файл больше 6 МБ")
    try:
        pypdf_text = _extract_pypdf(raw)
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Не удалось прочитать PDF: {e}") from e

    plum = ""
    try:
        plum = _extract_pdfplumber_word_lines(raw)
    except Exception:
        plum = ""

    ps, qs = _space_quality_score(pypdf_text), _space_quality_score(plum)
    if plum.strip() and (not pypdf_text.strip() or qs >= ps - 0.001):
        raw_text = plum
    else:
        raw_text = pypdf_text

    if not raw_text.strip():
        raise ValueError("В PDF не найден текст")

    raw_text = _apply_glued_dictionary(raw_text)
    raw_text = _heuristic_spacing(raw_text)
    raw_text = _strip_noise_lines(raw_text)
    raw_text = _dedupe_adjacent_lines(raw_text)

    return polish_resume_text_for_llm(raw_text)
