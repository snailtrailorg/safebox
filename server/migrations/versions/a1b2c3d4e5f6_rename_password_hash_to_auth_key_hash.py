"""rename_password_hash_to_auth_key_hash

Revision ID: a1b2c3d4e5f6
Revises: e5f6g7h8i9j0
Create Date: 2026-07-07
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'e5f6g7h8i9j0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('users', 'password_hash', new_column_name='auth_key_hash')


def downgrade() -> None:
    op.alter_column('users', 'auth_key_hash', new_column_name='password_hash')
