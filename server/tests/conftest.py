"""SafeBox 后端测试配置。"""

import asyncio
import os
from typing import AsyncGenerator
from unittest.mock import AsyncMock, patch

# 测试用 HMAC 密钥
os.environ["SAFEBOX_RECOVERY_HMAC_KEY"] = "dGVzdC1obWFjLWtleS0zMi1ieXRlcy1sb25nISEh"

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.main import app

# 测试用 SQLite 数据库
TEST_DATABASE_URL = "sqlite+aiosqlite:///./test.db"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestAsyncSession = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """每个测试函数独立的数据库会话。"""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with TestAsyncSession() as session:
        yield session

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """带测试数据库的 HTTP 客户端。"""

    async def override_get_db():
        # 忠实复刻生产 get_db：成功 commit、异常 rollback。
        # 否则端点抛 4xx 时的中间写入（如恢复码失败计数）不会被回滚，
        # 测试无法复现「异常回滚」相关的生产行为。
        try:
            yield db_session
            await db_session.commit()
        except Exception:
            await db_session.rollback()
            raise

    app.dependency_overrides[get_db] = override_get_db

    # Mock Redis 依赖的验证/限流函数，测试中用 SQLite 运行
    with (
        patch("app.api.auth.verify_and_consume", new_callable=AsyncMock) as mock_verify,
        patch("app.api.auth.check_rate_limit", new_callable=AsyncMock) as mock_rl,
        patch("app.api.auth.get_login_wait", new_callable=AsyncMock) as mock_wait,
        patch("app.api.auth.record_login_failure", new_callable=AsyncMock),
        patch("app.api.auth.clear_login_failures", new_callable=AsyncMock),
        patch("app.api.auth.store_code", new_callable=AsyncMock),
        patch("app.api.auth.send_verification_email", new_callable=AsyncMock),
        patch("app.api.auth.send_sms", new_callable=AsyncMock),
        patch("app.middleware.rate_limit.check_rate_key", new_callable=AsyncMock) as mock_rate,
    ):
        mock_verify.return_value = True
        mock_rl.return_value = True
        mock_wait.return_value = 0
        mock_rate.return_value = False  # 不限流

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()