"""同步相关的请求/响应 Schema。"""

from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, Field


class SyncItemRequest(BaseModel):
    client_did: Optional[int] = None      # 本地 did，仅用于首次推送的回配
    server_id: Optional[str] = None       # 已同步条目的稳定 UUID，跨设备 re-push 时按此匹配更新
    type: str
    icon: Optional[str] = None
    name: str       # EncryptedField JSON ({encrypted_key, ciphertext})
    description: Optional[str] = None
    data: Optional[str] = None
    version: int = 1
    updated_at: str  # ISO8601


class SyncPushRequest(BaseModel):
    items: List[SyncItemRequest]


class SyncPushResult(BaseModel):
    client_did: Optional[int]
    server_id: Optional[str] = None
    status: str  # "created" | "updated" | "conflict"
    version: Optional[int] = None  # 服务端权威版本（created/updated 后的结果；conflict 时为服务端当前版本）


class SyncPushResponse(BaseModel):
    results: List[SyncPushResult]


class SyncPullResponse(BaseModel):
    items: List["SyncItemResponse"]
    server_time: str        # ISO8601，客户端以此为下次 since
    has_more: bool


class SyncItemResponse(BaseModel):
    server_id: str
    client_did: Optional[int]
    type: str
    icon: Optional[str]
    name: str
    description: Optional[str]
    data: Optional[str]
    version: int
    is_deleted: bool
    updated_at: str         # ISO8601


class SyncDeleteRequest(BaseModel):
    server_ids: List[str]


class SyncDeleteResult(BaseModel):
    server_id: str
    status: str  # "deleted" | "not_found"


class SyncDeleteResponse(BaseModel):
    results: List[SyncDeleteResult]
