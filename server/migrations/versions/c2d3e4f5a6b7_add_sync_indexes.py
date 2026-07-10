"""add sync indexes

Revision ID: c2d3e4f5a6b7
Revises: 17473000bd71
Create Date: 2026-07-01
"""
from typing import Sequence, Union
from alembic import op

revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_items_user_id", "items", ["user_id"])
    op.create_index("ix_items_client_did", "items", ["client_did"])


def downgrade() -> None:
    op.drop_index("ix_items_client_did", table_name="items")
    op.drop_index("ix_items_user_id", table_name="items")
