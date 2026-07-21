"""device info: client_name/os_name/last_auth_ip

Revision ID: h9c0d1e2f3a4
Revises: g8b9c0d1e2f3
Create Date: 2026-07-21
"""
from alembic import op
import sqlalchemy as sa


revision = "h9c0d1e2f3a4"
down_revision = "g8b9c0d1e2f3"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("user_devices", sa.Column("client_name", sa.String(length=255), nullable=True))
    op.add_column("user_devices", sa.Column("os_name", sa.String(length=255), nullable=True))
    op.add_column("user_devices", sa.Column("last_auth_ip", sa.String(length=64), nullable=True))


def downgrade():
    op.drop_column("user_devices", "last_auth_ip")
    op.drop_column("user_devices", "os_name")
    op.drop_column("user_devices", "client_name")
