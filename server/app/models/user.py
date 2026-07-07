"""用户、密钥、设备 ORM 模型。"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str | None] = mapped_column(String(320), unique=True, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    auth_key_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    password_salt: Mapped[str | None] = mapped_column(Text, nullable=True)
    kdf_settings: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON string
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow
    )

    keys: Mapped["UserKeys"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan")
    devices: Mapped[list["UserDevice"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    items: Mapped[list["Item"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserKeys(Base):
    """用户的加密密钥材料。服务端永远不知道这些字段的明文。"""

    __tablename__ = "user_keys"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    password_wrapped: Mapped[str] = mapped_column(Text)
    recovery_wrapped: Mapped[str] = mapped_column(Text)
    encrypted_private: Mapped[str] = mapped_column(Text)
    rsa_public_key: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow
    )

    user: Mapped["User"] = relationship(back_populates="keys")


class UserDevice(Base):
    """用户已注册的设备（用于 Keystore 密钥交换）。"""

    __tablename__ = "user_devices"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    device_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    device_public_key: Mapped[str] = mapped_column(Text)
    device_wrapped: Mapped[str] = mapped_column(Text)
    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="devices")


class TokenFamily(Base):
    """Refresh token family — 防重放攻击。每个 family 一个活跃 token，刷新后旧 token 作废。"""

    __tablename__ = "token_families"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    family: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    active_token_hash: Mapped[str] = mapped_column(String(128))
    used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Item(Base):
    """加密条目。所有敏感字段由客户端 RSA 加密后上传。"""

    __tablename__ = "items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    client_did: Mapped[int | None] = mapped_column(nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(20))
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str] = mapped_column(Text)       # RSA 加密 + Base64
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[str | None] = mapped_column(Text, nullable=True)  # RSA 加密 JSON
    version: Mapped[int] = mapped_column(default=1)
    is_deleted: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="items")
