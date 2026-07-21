"""srp_auth: drop local_password_hash, add srp_verifier/srp_salt, drop mnemonics

Revision ID: f7a8b9c0d1e2
Revises: e5f6g7h8i9j0
Create Date: 2026-07-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, None] = "e5f6g7h8i9j0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SRP-6a 认证：删 bcrypt local_password_hash，加 srp_verifier/srp_salt（2SKD x 派生用）
    op.drop_column("users", "local_password_hash")
    op.add_column("users", sa.Column("srp_verifier", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("srp_salt", sa.Text(), nullable=True))
    # 助记词不再服务端存储（SRP + 客户端本地持有），删 mnemonics 表
    op.drop_index("idx_mnemonics_user", table_name="mnemonics")
    op.drop_table("mnemonics")


def downgrade() -> None:
    op.create_table(
        "mnemonics",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("mnemonic_hash", sa.String(length=128), nullable=False),
        sa.Column("mnemonic_hmac_salt", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("idx_mnemonics_user", "mnemonics", ["user_id"])
    op.drop_column("users", "srp_salt")
    op.drop_column("users", "srp_verifier")
    op.add_column("users", sa.Column("local_password_hash", sa.Text(), nullable=True))
