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
    _origins = [settings.frontend_origin, *_extra]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_origin_regex=r"chrome-extension://.*" if settings.cors_allow_chrome_extension_regex else None,
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

