"""同步相关的请求/响应 Schema。"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SyncItemRequest(BaseModel):
    client_did: int | None = None      # 本地 did，仅用于首次推送的回配
    server_id: str | None = None       # 已同步条目的稳定 UUID，跨设备 re-push 时按此匹配更新
    type: str
    icon: str | None = None
    name: str       # EncryptedField JSON ({encrypted_key, ciphertext})
    description: str | None = None
    data: str | None = None
    version: int = 1
    updated_at: str  # ISO8601


class SyncPushRequest(BaseModel):
    items: list[SyncItemRequest]


class SyncPushResult(BaseModel):
    client_did: int | None
    server_id: str | None = None
    status: str  # "created" | "updated" | "conflict"
    version: int | None = None  # 服务端权威版本（created/updated 后的结果；conflict 时为服务端当前版本）


class SyncPushResponse(BaseModel):
    results: list[SyncPushResult]


class SyncPullResponse(BaseModel):
    items: list["SyncItemResponse"]
    server_time: str        # ISO8601，客户端以此为下次 since
    has_more: bool


class SyncItemResponse(BaseModel):
    server_id: str
    client_did: int | None
    type: str
    icon: str | None
    name: str
    description: str | None
    data: str | None
    version: int
    is_deleted: bool
    updated_at: str         # ISO8601


class SyncDeleteRequest(BaseModel):
    server_ids: list[str]


class SyncDeleteResult(BaseModel):
    server_id: str
    status: str  # "deleted" | "not_found"


class SyncDeleteResponse(BaseModel):
    results: list[SyncDeleteResult]
