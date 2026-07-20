"""助记词 ORM 模型。"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Mnemonic(Base):
    """用户助记词。一人一码，服务端 HMAC-SHA256 哈希存储。

    助记词 + 主密码派生 K，K 包裹 User Key。助记词 132bit 不可暴力枚举，
    无需失败计数/锁定。initiate 失败由 RateLimitMiddleware（100/h）防骚扰。
    """

    __tablename__ = "mnemonics"
    __table_args__ = (Index("idx_mnemonics_user", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    mnemonic_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    mnemonic_hmac_salt: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
