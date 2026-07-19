"""create_mnemonics_table

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
    op.create_table('mnemonics',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('mnemonic_hash', sa.String(length=128), nullable=False),
        sa.Column('mnemonic_hmac_salt', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='active'),
        sa.Column('cooldown_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rollback_local_password_hash', sa.String(length=128), nullable=True),
        sa.Column('rollback_local_salt', sa.String(length=128), nullable=True),
        sa.Column('rollback_local_password_version', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('pending_initiate_token', sa.String(length=128), nullable=True),
        sa.Column('pending_initiate_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('pending_new_local_password_hash', sa.String(length=128), nullable=True),
        sa.Column('pending_new_local_salt', sa.String(length=128), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id')
    )
    op.create_index('idx_mnemonics_user', 'mnemonics', ['user_id', 'status'])


def downgrade() -> None:
    op.drop_index('idx_mnemonics_user', table_name='mnemonics')
    op.drop_table('mnemonics')
