"""API 路由注册。"""

from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.sync import router as sync_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(sync_router)
