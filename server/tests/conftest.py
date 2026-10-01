"""SafeBox 后端测试配置。"""

import asyncio
import os
from typing import AsyncGenerator
from unittest.mock import AsyncMock, patch

# 测试用 HMAC 密钥
os.environ["SAFEBOX_RECOVERY_HMAC_KEY"] = "dGVzdC1obWFjLWtleS0zMi1ieXRlcy1sb25nISEh"

# ── 测试环境隔离（必须在 import app.config 之前设置）────────────────
#
# 为什么必须显式清空：Settings 的 model_config 带 env_file=".env"，而开发者
# 本机的 server/.env 常配了**真实凭据**（SMTP / Twilio）。一旦真实凭据进入
# 测试进程，未 mock 的发送路径会真的外呼：
#   - 最坏情况是挂死 —— smtplib.SMTP() 无超时，在受限网络下 test_change_password
#     会卡在 TCP/TLS 握手，整个 pytest 永不返回（实测卡死 >5 分钟）。
#   - 即使连通，也会用生产账号真的发出一封"密码已修改"告警邮件。
# 测试不该依赖网络，更不该产生外呼副作用（尤其发信）。
# 置空后 _send_email/send_sms 走"未配置 + development"分支，直接 return True。
os.environ["SAFEBOX_SMTP_USERNAME"] = ""
os.environ["SAFEBOX_SMTP_PASSWORD"] = ""
os.environ["SAFEBOX_TWILIO_ACCOUNT_SID"] = ""
os.environ["SAFEBOX_TWILIO_AUTH_TOKEN"] = ""
# 显式声明开发环境：生产语义由 test_config_environment 之类的单测覆盖，
# 不靠"本机 .env 恰好没设 SAFEBOX_ENVIRONMENT"这种巧合。
os.environ["SAFEBOX_ENVIRONMENT"] = "development"

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from tests._srp import FakeRedis

# 测试用 SQLite 数据库 —— **内存库，非文件库**
#
# 早期用 `sqlite+aiosqlite:///./test.db`（文件），有两个真实危害：
# 1. **并发冲突**：两个 pytest 进程共用同一个 test.db，一个 drop_all 撞上另一个
#    的写入 → `OperationalError: database is locked`。实测发生过（一次全量跑
#    与另一次单跑重叠，13 分钟后以 OperationalError 失败）。
# 2. **残留污染**：进程非正常退出时 drop_all 跑不到，test.db 留在磁盘上，
#    下次跑测试从脏库开始。
# 内存库（`sqlite+aiosqlite://`）天然隔离每次进程、退出即销毁，两者一并解决。
# 注：SQLite 内存库对每个连接是独立实例，故用 StaticPool 让同一进程内复用
# 单一连接，避免建表与查询走到不同连接上。
TEST_DATABASE_URL = "sqlite+aiosqlite://"

test_engine = create_async_engine(
    TEST_DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
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
        try:
            yield db_session
            await db_session.commit()
        except Exception:
            await db_session.rollback()
            raise

    app.dependency_overrides[get_db] = override_get_db

    # Mock Redis 依赖的验证/限流函数；SRP session 走 FakeRedis（无真 Redis）
    # K 通信：mock 固定 K + identity 加解密 + 测试请求带 X-Safebox-Encrypted header，
    # 让 middleware 透传明文（测试关注业务逻辑，不验传输层加密；K 通信正确性靠前端 transport.ts 测试）
    fake_redis = FakeRedis()
    with (
        patch("app.api.auth.verify_and_consume", new_callable=AsyncMock) as mock_verify,
        patch("app.api.auth.check_rate_limit", new_callable=AsyncMock) as mock_rl,
        patch("app.api.auth.get_login_wait", new_callable=AsyncMock) as mock_wait,
        patch("app.api.auth.record_login_failure", new_callable=AsyncMock),
        patch("app.api.auth.clear_login_failures", new_callable=AsyncMock),
        patch("app.api.auth.store_code", new_callable=AsyncMock),
        patch("app.api.auth.send_verification_email", new_callable=AsyncMock),
        patch("app.api.auth.send_sms", new_callable=AsyncMock),
        # 改密后的安全告警（BackgroundTasks 里发出）。**必须 mock**：
        # 该函数经 _send_email -> smtplib 真实外呼，未被 mock 的路径会让
        # 未显式 patch 的用例（如 test_change_password）挂死在 SMTP 握手上。
        # 需要断言告警行为的用例自行局部 patch（见 test_change_password_sends_security_alert）。
        patch("app.api.auth.send_password_changed_alert", new_callable=AsyncMock),
        patch("app.middleware.rate_limit.check_rate_key", new_callable=AsyncMock) as mock_rate,
        patch("app.services.verification_service._get_redis", new_callable=AsyncMock) as mock_redis,
        patch("app.middleware.transport_crypto.get_session_key", new_callable=AsyncMock) as mock_session_key,
        patch("app.services.transport_crypto.encrypt", side_effect=lambda K, data: data),
        patch("app.services.transport_crypto.decrypt", side_effect=lambda K, data: data),
    ):
        mock_verify.return_value = True
        mock_rl.return_value = True
        mock_wait.return_value = 0
        mock_rate.return_value = False  # 不限流
        mock_redis.return_value = fake_redis
        mock_session_key.return_value = "00" * 32  # 固定测试 K（middleware identity 加解密透传）

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", headers={"X-Safebox-Encrypted": "1"}) as ac:
            yield ac

    app.dependency_overrides.clear()
