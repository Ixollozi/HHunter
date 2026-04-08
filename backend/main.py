from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db
from .routes_auth import router as auth_router
from .routes_settings import router as settings_router
from .routes_session import router as session_router
from .routes_applications import router as applications_router
from .routes_reports import router as reports_router
from .routes_extension import router as extension_router
from .routes_diagnostics import router as diagnostics_router
from .routes_dashboard import router as dashboard_router


def create_app() -> FastAPI:
    app = FastAPI(title="HHunter", version="0.1.0")

    _extra = [o.strip() for o in (settings.cors_extra_origins or "").split(",") if o.strip()]
    # Запросы fetch из content script на hh.ru идут с Origin https://hh.ru — без этого OPTIONS → 400.
    _hh_fixed = ("https://hh.ru", "https://www.hh.ru")
    _origins = [settings.frontend_origin, *_hh_fixed, *_extra]

    _re_parts = [r"https://([\w-]+\.)*hh\.ru"]
    if settings.cors_allow_chrome_extension_regex:
        _re_parts.append(r"chrome-extension://[\w-]+")
    _origin_re = "|".join(_re_parts)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_origin_regex=_origin_re,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def _startup() -> None:
        init_db()
        from .logger import ensure_log_dirs

        ensure_log_dirs()

    app.include_router(auth_router)
    app.include_router(settings_router)
    app.include_router(session_router)
    app.include_router(applications_router)
    app.include_router(reports_router)
    app.include_router(extension_router)
    app.include_router(diagnostics_router)
    app.include_router(dashboard_router)

    return app


app = create_app()

