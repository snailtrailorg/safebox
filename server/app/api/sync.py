"""同步 API：pull（拉取服务端更新）、push（上传本地修改）、delete（软删除）。"""

from typing import Optional, List
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import settings
from app.middleware import require_not_in_cooldown
from app.models import Item
from app.schemas.sync import (
    SyncDeleteRequest,
    SyncDeleteResponse,
    SyncDeleteResult,
    SyncItemResponse,
    SyncPullResponse,
    SyncPushRequest,
    SyncPushResponse,
    SyncPushResult,
)

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


@router.get("/pull", response_model=SyncPullResponse)
async def sync_pull(
    since: str = Query(..., description="ISO8601 时间戳，拉取此时间之后更新的条目"),
    limit: int = Query(settings.sync_batch_limit, ge=1, le=500),
    user_id: UUID = Depends(require_not_in_cooldown),
    db: AsyncSession = Depends(get_db),
):
    """拉取自 since 以来更新的条目（包括软删除的）。"""
    try:
        since_dt = datetime.fromisoformat(since)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid since format")

    result = await db.execute(
        select(Item)
        .where(and_(Item.user_id == user_id, Item.updated_at > since_dt))
        .order_by(Item.updated_at.asc())
        .limit(limit + 1)
    )
    items = result.scalars().all()

    has_more = len(items) > limit
    if has_more:
        items = items[:limit]

    # 用最后条目的 updated_at 作为 next 游标，避免服务器时间滑动导致跳号
    cursor = items[-1].updated_at.isoformat() if items else datetime.now(timezone.utc).isoformat()

    return SyncPullResponse(
        items=[
            SyncItemResponse(
                server_id=str(item.id),
                client_did=item.client_did,
                type=item.type,
                icon=item.icon,
                name=item.name,
                description=item.description,
                data=item.data,
                version=item.version,
                is_deleted=item.is_deleted,
                updated_at=item.updated_at.isoformat(),
            )
            for item in items
        ],
        server_time=cursor,
        has_more=has_more,
    )


@router.post("/push", response_model=SyncPushResponse)
async def sync_push(
    req: SyncPushRequest,
    user_id: UUID = Depends(require_not_in_cooldown),
    db: AsyncSession = Depends(get_db),
):
    """上传本地修改的条目。乐观并发：按 version 检测冲突（不依赖时钟）。

    客户端 version = 其持有的基线（上次拉到的服务端版本）。
    base == 服务端当前 -> 接受，version+1；base != 服务端当前 -> conflict。
    updated_at 由模型 onupdate 自动维护（仅用于 pull 游标/显示，不参与冲突判断）。
    """
    from sqlalchemy import or_

    results: List[SyncPushResult] = []
    new_items: List[Item] = []  # 新建的 Item 对象，flush 后取 ID

    # 批量查询已有条目：优先按 server_id（跨设备稳定标识），回退 client_did（同设备首次回配）
    all_dids = [i.client_did for i in req.items if i.client_did is not None]
    valid_server_ids: List[UUID] = []
    for i in req.items:
        if i.server_id:
            try:
                valid_server_ids.append(UUID(i.server_id))
            except ValueError:
                pass  # 非法 server_id 忽略，按 client_did/新建处理

    existing_map_by_did: dict[Optional[int], Item] = {}
    existing_map_by_sid: dict[str, Item] = {}
    if all_dids or valid_server_ids:
        sub_conds = []
        if all_dids:
            sub_conds.append(Item.client_did.in_(all_dids))
        if valid_server_ids:
            sub_conds.append(Item.id.in_(valid_server_ids))
        existing_result = await db.execute(
            select(Item).where(and_(Item.user_id == user_id, or_(*sub_conds))).with_for_update()
        )
        for item in existing_result.scalars().all():
            if item.client_did is not None:
                existing_map_by_did[item.client_did] = item
            existing_map_by_sid[str(item.id)] = item

    for item_req in req.items:
        # server_id 优先匹配（跨设备），否则 client_did（同设备）
        existing = None
        if item_req.server_id:
            existing = existing_map_by_sid.get(item_req.server_id)
        if existing is None and item_req.client_did is not None:
            existing = existing_map_by_did.get(item_req.client_did)

        if existing:
            # 乐观并发：客户端基线 version 必须等于服务端当前 version
            if item_req.version == existing.version:
                existing.type = item_req.type
                existing.icon = item_req.icon
                existing.name = item_req.name
                existing.description = item_req.description
                existing.data = item_req.data
                existing.is_deleted = False
                existing.version += 1  # 服务端权威递增（updated_at 由 onupdate 自动刷新）
                results.append(SyncPushResult(
                    client_did=item_req.client_did, server_id=str(existing.id),
                    status="updated", version=existing.version,
                ))
            else:
                # 基线不匹配：客户端基于旧版编辑，冲突
                results.append(SyncPushResult(
                    client_did=item_req.client_did, server_id=str(existing.id),
                    status="conflict", version=existing.version,
                ))
        else:
            item = Item(
                user_id=user_id, client_did=item_req.client_did, type=item_req.type,
                icon=item_req.icon, name=item_req.name, description=item_req.description,
                data=item_req.data, version=1,  # 新建从 1 开始，服务端权威
            )
            db.add(item)
            new_items.append(item)
            results.append(SyncPushResult(client_did=item_req.client_did, server_id="", status="created", version=1))

    await db.flush()
    # flush 后新 Item 已分配 ID
    for item, result_item in zip(new_items, [r for r in results if r.status == "created"]):
        result_item.server_id = str(item.id)
    await db.commit()
    return SyncPushResponse(results=results)


@router.post("/delete", response_model=SyncDeleteResponse)
async def sync_delete(
    req: SyncDeleteRequest,
    user_id: UUID = Depends(require_not_in_cooldown),
    db: AsyncSession = Depends(get_db),
):
    """软删除条目。"""
    results: List[SyncDeleteResult] = []

    for server_id_str in req.server_ids:
        try:
            item_id = UUID(server_id_str)
        except ValueError:
            results.append(SyncDeleteResult(server_id=server_id_str, status="not_found"))
            continue

        result = await db.execute(
            select(Item).where(and_(Item.user_id == user_id, Item.id == item_id))
        )
        item = result.scalar_one_or_none()

        if item:
            item.is_deleted = True
            results.append(SyncDeleteResult(server_id=server_id_str, status="deleted"))
        else:
            results.append(SyncDeleteResult(server_id=server_id_str, status="not_found"))

    await db.commit()
    return SyncDeleteResponse(results=results)
