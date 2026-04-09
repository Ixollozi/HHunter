from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.UTC)
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    settings: Mapped["UserSettings"] = relationship(back_populates="user", uselist=False)
    search_configs: Mapped[list["SearchConfig"]] = relationship(back_populates="user")
    sessions: Mapped[list["Session"]] = relationship(back_populates="user")
    applications: Mapped[list["Application"]] = relationship(back_populates="user")
    activity_logs: Mapped[list["ActivityLog"]] = relationship(back_populates="user")


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)

    gemini_api_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    resume_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    groq_api_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    groq_model: Mapped[str | None] = mapped_column(String(64), nullable=True)

    user: Mapped[User] = relationship(back_populates="settings")


class SearchConfig(Base):
    __tablename__ = "search_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)

    search_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Где искать text: name / description / company_name → query search_field (список в JSON)
    search_fields: Mapped[str | None] = mapped_column(Text, nullable=True)
    area: Mapped[str | None] = mapped_column(String(64), nullable=True)
    experience: Mapped[str | None] = mapped_column(String(64), nullable=True)
    employment: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON-массив кодов
    schedule: Mapped[str | None] = mapped_column(Text, nullable=True)
    period: Mapped[int | None] = mapped_column(Integer, nullable=True)
    salary: Mapped[int | None] = mapped_column(Integer, nullable=True)
    only_with_salary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    order_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    delay_min: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    delay_max: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    daily_limit: Mapped[int] = mapped_column(Integer, default=200, nullable=False)
    hourly_limit: Mapped[int] = mapped_column(Integer, default=35, nullable=False)

    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.UTC)
    )

    user: Mapped[User] = relationship(back_populates="search_configs")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)

    started_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.UTC)
    )
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    total_found: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_sent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_skipped: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_errors: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="running", nullable=False)

    user: Mapped[User] = relationship(back_populates="sessions")
    applications: Mapped[list["Application"]] = relationship(back_populates="session")


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id"), index=True, nullable=True)

    vacancy_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    vacancy_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    vacancy_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    company_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    company_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    contact_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(Text, nullable=True)

    salary_from: Mapped[int | None] = mapped_column(Integer, nullable=True)
    salary_to: Mapped[int | None] = mapped_column(Integer, nullable=True)
    salary_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)

    cover_letter: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_used: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="sent", nullable=False)
    skip_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    applied_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.UTC)
    )

    user: Mapped[User] = relationship(back_populates="applications")
    session: Mapped[Session] = relationship(back_populates="applications")


class ActivityLog(Base):
    """Пошаговые записи расширения (и опционально других источников) для вкладки «Логи» в UI."""

    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.UTC)
    )
    level: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    step: Mapped[str | None] = mapped_column(String(64), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    user: Mapped[User] = relationship(back_populates="activity_logs")

