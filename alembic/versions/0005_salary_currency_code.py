"""Add salary_currency_code to search_configs.

Revision ID: 0005_salary_currency_code
Revises: 0004_work_format
Create Date: 2026-04-25
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_salary_currency_code"
down_revision = "0004_work_format"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("search_configs") as batch:
        batch.add_column(sa.Column("salary_currency_code", sa.String(length=8), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("search_configs") as batch:
        batch.drop_column("salary_currency_code")

