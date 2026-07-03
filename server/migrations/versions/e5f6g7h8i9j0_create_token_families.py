"""create token_families table

Revision ID: e5f6g7h8i9j0
Revises: c2d3e4f5a6b7
Create Date: 2026-07-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "e5f6g7h8i9j0"
down_revision: Union[str, None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table("token_families",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("family", sa.String(length=64), nullable=False),
        sa.Column("active_token_hash", sa.String(length=128), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("family"),
    )
    op.create_index("ix_token_families_user_id", "token_families", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_token_families_user_id", table_name="token_families")
    op.drop_table("token_families")
