from __future__ import annotations

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.db_url, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    # Import models so metadata is populated before create_all().
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)

    # Старые БД: колонка users.email → users.username (SQLite 3.25+)
    insp = inspect(engine)
    tables = insp.get_table_names()
    if "users" in tables:
        cols = {c["name"] for c in insp.get_columns("users")}
        if "email" in cols and "username" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users RENAME COLUMN email TO username"))

    if "search_configs" in tables:
        sc_cols = {c["name"] for c in insp.get_columns("search_configs")}
        with engine.begin() as conn:
            if "order_by" not in sc_cols:
                conn.execute(text("ALTER TABLE search_configs ADD COLUMN order_by VARCHAR(64)"))
            if "only_with_salary" not in sc_cols:
                conn.execute(text("ALTER TABLE search_configs ADD COLUMN only_with_salary INTEGER NOT NULL DEFAULT 0"))
            if "search_fields" not in sc_cols:
                conn.execute(text("ALTER TABLE search_configs ADD COLUMN search_fields TEXT"))

