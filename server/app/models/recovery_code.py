"""恢复码 ORM 模型。"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RecoveryCode(Base):
    """用户恢复码。一人一码，服务端 HMAC-SHA256 哈希存储。

    状态机（v2 重设计，登录零写入）：
      - active：正常，可发起恢复
      - cooldown：恢复中，账户锁定（新旧密码均不可登录），cooldown_until 到期后可登录
      - permanently_locked：永久锁定（失败≥5 / 月发起>3 / 主动作废）
    initiate 时正式字段直接写新密码，旧密码存 rollback_* 供 freeze 回滚。
    accelerate / freeze / 冷却后首次登录成功 时清 rollback_*。
    """

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
    )  # active | cooldown | permanently_locked

    # 冷却到期时间（登录门：now < cooldown_until 则拒绝登录）
    cooldown_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # 旧密码副本（initiate 时存，freeze 回滚用；accelerate/freeze/冷却后首次登录成功时清）
    rollback_auth_key_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    rollback_password_salt: Mapped[str | None] = mapped_column(String(128), nullable=True)
    rollback_kdf_settings: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON string
    rollback_wrapped_user_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    monthly_initiation_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_attempt_last_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 两步 initiate 待确认态（步骤1 验码后存，步骤2 confirm 用后清；15min 过期）
    pending_initiate_token: Mapped[str | None] = mapped_column(String(128), nullable=True)  # sha256(token)
    pending_initiate_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pending_new_auth_key_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    pending_new_password_salt: Mapped[str | None] = mapped_column(String(128), nullable=True)
    pending_new_kdf_settings: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
