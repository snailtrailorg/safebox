"""FastAPI 应用入口。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import api_router
from app.config import settings
from app.database import get_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动/关闭。"""
    yield
    from app.database import get_engine
    engine = get_engine()
    await engine.dispose()


app = FastAPI(
    title="SafeBox API",
    description="端到端加密密码管理器后端",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — 通配符源时禁 credentials，否则浏览器拒绝
cors_origins = settings.cors_origins.split(",") if settings.cors_origins != "*" else ["*"]
allow_creds = settings.cors_origins != "*"
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=allow_creds,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
async def health():
    """健康检查。验证 DB 可达性。"""
    try:
        async for session in get_db():
            await session.execute(text("SELECT 1"))
            break
        return {"status": "ok"}
    except Exception:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=503, content={"status": "unavailable"})
