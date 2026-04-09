"""Placeholder: revision was applied locally / in another branch without this file.

Revision ID: 0002_hh_oauth
Revises: 0001_groq_fields
Create Date: 2026-04-08

If your DB already has version_num = 0002_hh_oauth, Alembic needs this node in the graph.
Upgrade is a no-op; real schema change for hourly_limit is in 0002_search_hourly_limit.
"""

from __future__ import annotations

from alembic import op

revision = "0002_hh_oauth"
down_revision = "0001_groq_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
