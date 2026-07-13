"""恢复码 ORM 模型。"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RecoveryCode(Base):
    """用户恢复码。一人一码，服务端 HMAC-SHA256 哈希存储。

    恢复码是 K 的种子（与主密码一起派生 K），永久不变，不重生成。
    恢复码 132bit 不可暴力枚举，无需失败计数/锁定。
    initiate 失败由 RateLimitMiddleware（100/h）防骚扰，不累积计数。
    """

    __tablename__ = "recovery_codes"
    __table_args__ = (Index("idx_recovery_codes_user", "user_id", "status"),)

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
    )  # active | cooldown

    # 冷却到期时间（登录门 + 数据访问门：now < cooldown_until 则拒绝）
    cooldown_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # 旧登录密码副本（initiate confirm 时存，freeze 回滚用；accelerate/freeze/冷却后首次登录成功时清）
    # 注：不存 rollback_wrapped_user_key（K/User Key 不变，无需回滚密钥包裹）
    rollback_auth_key_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    rollback_login_salt: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    rollback_password_version: Mapped[Optional[int]] = mapped_column(nullable=True)  # freeze 回滚 password_version

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # 两步 initiate 待确认态（步骤1 验码后存，步骤2 confirm 用后清；15min 过期）
    pending_initiate_token: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    pending_initiate_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    pending_new_auth_key_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    pending_new_login_salt: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
