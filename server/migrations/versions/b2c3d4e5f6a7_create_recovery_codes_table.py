"""create_recovery_codes_table

Revision ID: b2c3d4e5f6a7
Revises: 17473000bd71
Create Date: 2026-07-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = '17473000bd71'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('recovery_codes',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('recovery_code_hash', sa.String(length=128), nullable=False),
        sa.Column('recovery_code_salt', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='active'),
        sa.Column('cooldown_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rollback_auth_key_hash', sa.String(length=128), nullable=True),
        sa.Column('rollback_login_salt', sa.String(length=128), nullable=True),
        sa.Column('failed_attempt_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('failed_attempt_last_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('pending_initiate_token', sa.String(length=128), nullable=True),
        sa.Column('pending_initiate_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('pending_new_auth_key_hash', sa.String(length=128), nullable=True),
        sa.Column('pending_new_login_salt', sa.String(length=128), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id')
    )
    op.create_index('idx_recovery_codes_user', 'recovery_codes', ['user_id', 'status'])


def downgrade() -> None:
    op.drop_index('idx_recovery_codes_user', table_name='recovery_codes')
    op.drop_table('recovery_codes')
