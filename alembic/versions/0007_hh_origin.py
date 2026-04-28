"""Add hh_origin to search_configs.

Revision ID: 0007_hh_origin
Revises: 0006_user_gender
Create Date: 2026-04-25
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_hh_origin"
down_revision = "0006_user_gender"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("search_configs") as batch:
        batch.add_column(sa.Column("hh_origin", sa.String(length=128), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("search_configs") as batch:
        batch.drop_column("hh_origin")

