"""用户、密钥、设备 ORM 模型。"""

import uuid
from datetime import datetime, timezone
from typing import Optional, List

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
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
    email: Mapped[Optional[str]] = mapped_column(String(320), unique=True, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True)
    google_id: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    local_password_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    local_salt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # 本地密码派生用盐
    kdf_settings: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON string
    local_password_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 改本地密码+1，多设备同步用
    has_passphrase: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # 是否设了Passphrase
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow
    )

    keys: Mapped["UserKeys"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan")
    devices: Mapped[List["UserDevice"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    items: Mapped[List["Item"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserKeys(Base):
    """用户的加密密钥材料。服务端永远不知道这些字段的明文。"""

    __tablename__ = "user_keys"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    # 模型 D 串行化：K = PBKDF2(助记词[+Passphrase], mnemonic_salt)，K 不存服务器
    encrypted_user_key: Mapped[str] = mapped_column(Text)  # AES(K, User Key raw)，K 不在服务器
    mnemonic_salt: Mapped[str] = mapped_column(Text)  # K 派生用盐（注册时客户端生成）
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
    device_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
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
    """加密条目。敏感字段由客户端用 Item Key + AES-256-GCM 加密后上传（v2 EncryptedField JSON）。"""

    __tablename__ = "items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    client_did: Mapped[Optional[int]] = mapped_column(nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(20))
    icon: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    name: Mapped[str] = mapped_column(Text)       # EncryptedField JSON ({encrypted_key, ciphertext})
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # EncryptedField JSON
    version: Mapped[int] = mapped_column(default=1)
    is_deleted: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utcnow
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="items")
