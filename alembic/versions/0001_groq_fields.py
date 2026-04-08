"""Add Groq settings and model_used.

Revision ID: 0001_groq_fields
Revises: 
Create Date: 2026-04-08
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0001_groq_fields"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # user_settings
    with op.batch_alter_table("user_settings") as batch:
        batch.add_column(sa.Column("groq_api_key_enc", sa.Text(), nullable=True))
        batch.add_column(sa.Column("groq_model", sa.String(length=64), nullable=True))

    # applications
    with op.batch_alter_table("applications") as batch:
        batch.add_column(sa.Column("model_used", sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("applications") as batch:
        batch.drop_column("model_used")

    with op.batch_alter_table("user_settings") as batch:
        batch.drop_column("groq_model")
        batch.drop_column("groq_api_key_enc")

