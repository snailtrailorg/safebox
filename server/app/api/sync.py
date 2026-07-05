"""同步 API：pull（拉取服务端更新）、push（上传本地修改）、delete（软删除）。"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware import get_current_user_id
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
    limit: int = Query(100, ge=1, le=500),
    user_id: UUID = Depends(get_current_user_id),
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
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """上传本地修改的条目。LWW 策略：按 updated_at 覆盖。"""
    results: list[SyncPushResult] = []
    new_items: list[Item] = []  # 新建的 Item 对象，flush 后取 ID

    for item_req in req.items:
        if item_req.client_did is not None:
            result = await db.execute(
                select(Item).where(
                    and_(Item.user_id == user_id, Item.client_did == item_req.client_did)
                )
            )
            existing = result.scalar_one_or_none()
        else:
            existing = None

        if existing:
            client_updated_at = datetime.fromisoformat(item_req.updated_at) if item_req.updated_at else existing.updated_at
            if client_updated_at > existing.updated_at:
                existing.type = item_req.type
                existing.icon = item_req.icon
                existing.name = item_req.name
                existing.description = item_req.description
                existing.data = item_req.data
                existing.version = item_req.version
                existing.is_deleted = False
                existing.updated_at = client_updated_at
                results.append(SyncPushResult(client_did=item_req.client_did, server_id=str(existing.id), status="updated"))
            else:
                results.append(SyncPushResult(client_did=item_req.client_did, server_id=str(existing.id), status="conflict"))
        else:
            item = Item(
                user_id=user_id, client_did=item_req.client_did, type=item_req.type,
                icon=item_req.icon, name=item_req.name, description=item_req.description,
                data=item_req.data, version=item_req.version,
            )
            db.add(item)
            new_items.append(item)
            results.append(SyncPushResult(client_did=item_req.client_did, server_id="", status="created"))

    await db.flush()
    # flush 后新 Item 已分配 ID
    for item, result_item in zip(new_items, [r for r in results if r.status == "created"]):
        result_item.server_id = str(item.id)
    await db.commit()
    return SyncPushResponse(results=results)


@router.post("/delete", response_model=SyncDeleteResponse)
async def sync_delete(
    req: SyncDeleteRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """软删除条目。"""
    results: list[SyncDeleteResult] = []

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
