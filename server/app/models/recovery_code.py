"""恢复码 ORM 模型。"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RecoveryCode(Base):
    """用户恢复码。一人一码，服务端 HMAC-SHA256 哈希存储。"""

    __tablename__ = "recovery_codes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    recovery_code_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    recovery_code_salt: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="active"
    )  # active | pending_activation | permanently_locked | consumed

    # pending 字段（冷却期）
    pending_new_auth_key_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    pending_password_salt: Mapped[str | None] = mapped_column(String(128), nullable=True)
    pending_kdf_settings: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON string
    pending_wrapped_user_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    pending_setup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cooldown_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    recovery_attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
