"""同步相关的请求/响应 Schema。"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SyncItemRequest(BaseModel):
    client_did: int | None = None
    type: str
    icon: str | None = None
    name: str       # RSA 加密 + Base64
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
