"""Add relevance settings to user_settings.

Revision ID: 0003_relevance_settings
Revises: 0002_search_hourly_limit
Create Date: 2026-04-16
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_relevance_settings"
down_revision = "0002_search_hourly_limit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("user_settings") as batch:
        batch.add_column(sa.Column("relevance_profile", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("relevance_skills", sa.Text(), nullable=True))
        batch.add_column(sa.Column("relevance_min_score", sa.Integer(), nullable=True, server_default="3"))


def downgrade() -> None:
    with op.batch_alter_table("user_settings") as batch:
        batch.drop_column("relevance_min_score")
        batch.drop_column("relevance_skills")
        batch.drop_column("relevance_profile")

