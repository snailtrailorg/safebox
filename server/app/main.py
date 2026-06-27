"""FastAPI 应用入口。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.database import Base, get_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动/关闭。"""
    yield
    engine = get_engine()
    await engine.dispose()


app = FastAPI(
    title="SafeBox API",
    description="端到端加密密码管理器后端",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS（开发阶段允许所有来源）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
