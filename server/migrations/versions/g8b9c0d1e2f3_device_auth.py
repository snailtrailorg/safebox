"""device_auth: UserDevice is_revoked/revoked_at/updated_at + TokenFamily device_id

Revision ID: g8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-07-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "g8b9c0d1e2f3"
down_revision: Union[str, None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # UserDevice: deauthorize 支持（is_revoked 标记 + revoked_at + updated_at）
    op.add_column("user_devices", sa.Column("is_revoked", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("user_devices", sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("user_devices", sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False))
    # TokenFamily: 绑 device_id（nullable 兼容旧 token；按 device 撤销）
    op.add_column("token_families", sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_token_families_device_id", "token_families", "user_devices", ["device_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_token_families_device_id", "token_families", ["device_id"])


def downgrade() -> None:
    op.drop_index("ix_token_families_device_id", table_name="token_families")
    op.drop_constraint("fk_token_families_device_id", "token_families", type_="foreignkey")
    op.drop_column("token_families", "device_id")
    op.drop_column("user_devices", "updated_at")
    op.drop_column("user_devices", "revoked_at")
    op.drop_column("user_devices", "is_revoked")
