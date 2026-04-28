"""Add gender to user_settings.

Revision ID: 0006_user_gender
Revises: 0005_salary_currency_code
Create Date: 2026-04-25
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_user_gender"
down_revision = "0005_salary_currency_code"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("user_settings") as batch:
        batch.add_column(sa.Column("gender", sa.String(length=16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("user_settings") as batch:
        batch.drop_column("gender")

