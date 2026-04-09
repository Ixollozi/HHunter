"""Add hourly_limit to search_configs.

Revision ID: 0002_search_hourly_limit
Revises: 0002_hh_oauth
Create Date: 2026-04-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_search_hourly_limit"
down_revision = "0002_hh_oauth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("search_configs") as batch:
        batch.add_column(sa.Column("hourly_limit", sa.Integer(), nullable=False, server_default="35"))


def downgrade() -> None:
    with op.batch_alter_table("search_configs") as batch:
        batch.drop_column("hourly_limit")
