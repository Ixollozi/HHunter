from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .config import settings
from .deps import get_db
from .crypto import decrypt_secret, encrypt_secret
from .letter_generation import generate_cover_letter
from .models import SearchConfig, UserSettings
from .schemas import SettingsIn, SettingsOut
from .resume_pdf import MAX_RESUME_PDF_BYTES, extract_resume_pdf_text
from .search_params import encode_str_list, search_config_dict_from_row

router = APIRouter(prefix="/settings", tags=["settings"])


def _latest_search(db: Session, user_id: int) -> SearchConfig | None:
    return db.scalar(select(SearchConfig).where(SearchConfig.user_id == user_id).order_by(desc(SearchConfig.created_at)))


@router.get("", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db), user=Depends(get_current_user)) -> SettingsOut:
    s = db.get(UserSettings, user.id)
    if not s:
        s = UserSettings(user_id=user.id)
        db.add(s)
        db.commit()

    cfg = _latest_search(db, user.id)
    search = search_config_dict_from_row(cfg) if cfg else None
    return SettingsOut(
        gemini_api_key=s.gemini_api_key,
        resume_text=s.resume_text,
        groq_model=s.groq_model,
        groq_configured=bool((s.groq_api_key_enc or "").strip()),
        cover_letter_mode=(s.cover_letter_mode or "ai"),
        cover_letter_text=s.cover_letter_text,
        gender=(getattr(s, "gender", None) or "male"),
        relevance_profile=(s.relevance_profile or "python_backend"),
        relevance_skills=(s.relevance_skills or ""),
        relevance_min_score=int(3 if s.relevance_min_score is None else s.relevance_min_score),
        search=search,
    )


@router.get("/health")
def settings_health(user=Depends(get_current_user)) -> dict:
    """
    Быстрый health-check конфигурации, чтобы UI мог показать понятное сообщение
    до попытки сохранить/расшифровать Groq API ключ.
    """
    fernet_ok = bool((settings.groq_key_fernet_secret or "").strip())
    return {
        "ok": True,
        "groq_fernet_configured": fernet_ok,
        "missing": [] if fernet_ok else ["GROQ_KEY_FERNET_SECRET"],
    }


@router.put("", response_model=SettingsOut)
def put_settings(payload: SettingsIn, db: Session = Depends(get_db), user=Depends(get_current_user)) -> SettingsOut:
    s = db.get(UserSettings, user.id)
    if not s:
        s = UserSettings(user_id=user.id)
        db.add(s)
        db.flush()

    for field in [
        "gemini_api_key",
        "resume_text",
        "groq_model",
        "cover_letter_mode",
        "cover_letter_text",
        "gender",
        "relevance_profile",
        "relevance_skills",
        "relevance_min_score",
    ]:
        val = getattr(payload, field)
        if val is not None:
            setattr(s, field, val)

    if payload.groq_api_key is not None:
        if payload.groq_api_key.strip():
            try:
                s.groq_api_key_enc = encrypt_secret(payload.groq_api_key)
            except RuntimeError as e:
                # Не 500: это ошибка конфигурации окружения.
                raise HTTPException(
                    status_code=400,
                    detail=str(e)
                    + " Добавьте GROQ_KEY_FERNET_SECRET в backend/.env (см. backend/.env.example) и перезапустите сервер.",
                ) from e
        else:
            s.groq_api_key_enc = None

    if payload.search is not None:
        cfg = SearchConfig(user_id=user.id)
        data = payload.search.model_dump(exclude_none=True)
        emp = data.pop("employment", None)
        sch = data.pop("schedule", None)
        wf = data.pop("work_format", None)
        sf = data.pop("search_fields", None)
        if emp is not None:
            cfg.employment = encode_str_list(emp)
        if sch is not None:
            cfg.schedule = encode_str_list(sch)
        if wf is not None:
            cfg.work_format = encode_str_list(wf)
        if sf is not None:
            cfg.search_fields = encode_str_list(sf)
        for field, val in data.items():
            setattr(cfg, field, val)
        db.add(cfg)

    db.add(s)
    db.commit()
    return get_settings(db=db, user=user)


@router.post("/resume-upload")
async def upload_resume_pdf(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> dict:
    """Загрузка PDF резюме: текст пишется в resume_text."""
    name = (file.filename or "").lower()
    ctype = (file.content_type or "").lower()
    if "pdf" not in ctype and not name.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Нужен файл в формате PDF")

    data = await file.read()
    if len(data) > MAX_RESUME_PDF_BYTES:
        raise HTTPException(status_code=400, detail="Файл больше 6 МБ")

    try:
        text = extract_resume_pdf_text(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if not text:
        raise HTTPException(
            status_code=400,
            detail="В PDF нет извлекаемого текста (часто у сканов без текстового слоя — используйте PDF с текстовым слоем или введите текст ниже).",
        )

    s = db.get(UserSettings, user.id)
    if not s:
        s = UserSettings(user_id=user.id)
        db.add(s)
    s.resume_text = text
    db.commit()

    return {"ok": True, "length": len(text), "resume_text": text}


@router.post("/test-keys")
def test_keys(db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    s = db.get(UserSettings, user.id)
    if not s:
        raise HTTPException(status_code=400, detail="Settings not found")

    results: dict = {"groq": None}

    if (s.groq_api_key_enc or "").strip():
        try:
            key = decrypt_secret(s.groq_api_key_enc or "")
            txt = generate_cover_letter(
                vacancy={
                    "name": "Тестовая вакансия",
                    "employer": {"name": "Тест"},
                    "description": "Нужно написать короткое письмо без клише.",
                    "key_skills": ["Python"],
                },
                resume_text=(s.resume_text or "Python разработчик"),
                api_key=key,
                model=(s.groq_model or None),
                gender=(getattr(s, "gender", None) or "male"),
            )
            results["groq"] = {"ok": True, "sample_len": len(txt), "model": (s.groq_model or None)}
        except RuntimeError as e:
            results["groq"] = {"ok": False, "error": str(e)}
        except Exception as e:  # noqa: BLE001
            results["groq"] = {"ok": False, "error": str(e)}
    else:
        results["groq"] = {"ok": False, "error": "No groq_api_key"}

    return results
