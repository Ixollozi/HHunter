"""Add work_format to search_configs.

Revision ID: 0004_work_format
Revises: 0003_relevance_settings
Create Date: 2026-04-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_work_format"
down_revision = "0003_relevance_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("search_configs") as batch:
        batch.add_column(sa.Column("work_format", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("search_configs") as batch:
        batch.drop_column("work_format")

