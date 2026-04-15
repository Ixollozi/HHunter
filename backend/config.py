from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _BACKEND_DIR.parent


def _default_db_path() -> Path:
    """Файл БД: <корень_репо>/database/hhunter.db (не зависит от cwd)."""
    return (_REPO_ROOT / "database" / "hhunter.db").resolve()


def _default_db_url() -> str:
    p = _default_db_path()
    return "sqlite:///" + p.as_posix()


def _sqlite_fs_path_from_url(url: str) -> Path:
    """Парсит sqlite:///... в Path; чинит старый DB_URL вида sqlite:///../database/... (расчёт на cwd=backend)."""
    rest = url[10:].strip()  # после "sqlite:///"
    raw = rest.replace("\\", "/").strip()
    p = Path(rest)
    if p.is_absolute():
        return p
    if raw.startswith("..") or "/../" in raw:
        return _default_db_path()
    return (_REPO_ROOT / rest).resolve()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    jwt_secret: str
    jwt_expires_min: int = 60 * 24 * 30

    db_url: str = _default_db_url()

    frontend_origin: str = "http://localhost:5173"
    # Дополнительные Origin для CORS (через запятую), помимо frontend_origin.
    cors_extra_origins: str = ""
    # Разрешить Origin вида chrome-extension://... (распакованное расширение).
    cors_allow_chrome_extension_regex: bool = True
    # Явный allowlist ID расширений Chrome: chrome-extension://<id>.
    # Пример: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    cors_chrome_extension_ids: str = ""

    # Логи (logs/): ротация и retention.
    # LOG_DEBUG=false: не писать наиболее "шумные" диагностические записи (превью резюме/сырой ответ модели).
    log_debug: bool = False
    # Через сколько дней удалять старые логи (mtime). 0/отрицательное = не удалять.
    log_retention_days: int = 7
    # Максимальный размер одного файла лога (в мегабайтах) до ротации. 0/отрицательное = без ротации по размеру.
    log_max_mb: int = 10

    # Модель Gemini API (Google Gen AI SDK): https://ai.google.dev/gemini-api/docs/models
    gemini_model: str = "gemini-2.5-flash"

    # Groq (OpenAI-compatible) модель по умолчанию
    groq_default_model: str = "qwen/qwen3-32b"

    # Обязательное требование API hh.ru: UA с контактом приложения / разработчика.
    hh_api_user_agent: str = "HHunter/1.0 (+https://hh.ru)"

    # Fernet key (base64) for encrypting Groq API key at rest.
    # Generate once: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    groq_key_fernet_secret: str | None = None

    @field_validator("db_url", mode="before")
    @classmethod
    def _normalize_sqlite_db_url(cls, v: object) -> str:
        if v is None or (isinstance(v, str) and not str(v).strip()):
            return _default_db_url()
        if not isinstance(v, str):
            return v  # type: ignore[return-value]
        s = v.strip()
        if not s.startswith("sqlite:"):
            return s
        low = s.lower()
        if ":memory:" in low:
            return s
        if not s.startswith("sqlite:///"):
            return s
        path = _sqlite_fs_path_from_url(s)
        path.parent.mkdir(parents=True, exist_ok=True)
        return "sqlite:///" + path.resolve().as_posix()


settings = Settings()
