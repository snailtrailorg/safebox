"""SQLAlchemy 异步引擎与会话工厂。懒初始化，允许测试覆盖。"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


_engine = None
_session_factory = None


def get_engine():
    global _engine, _session_factory
    if _engine is None:
        from app.config import settings

        _engine = create_async_engine(
            settings.database_url,
            echo=False,
            # 连接池健壮性：默认 pool_pre_ping=False / pool_recycle=-1 会在 PG 或
            # 防火墙断开空闲连接后留死连接，借出时 hang 到 pool_timeout（默认 30s）。
            pool_pre_ping=True,   # 借出前 ping，自动剔除死连接
            pool_recycle=1800,    # 30 分钟主动回收，防空闲连接被对端断开
            pool_size=10,          # 每 worker 常驻 10（gunicorn -w 2 共 20）
            max_overflow=20,       # 单 worker 上限 30
            pool_timeout=10,       # 等连接超时 10s，快速失败留日志（默认 30s）
        )
        _session_factory = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)
    return _engine


def get_session_factory():
    global _session_factory
    if _session_factory is None:
        get_engine()
    return _session_factory


def set_engine(engine, session_factory):
    """测试用：注入自定义引擎和会话工厂。"""
    global _engine, _session_factory
    _engine = engine
    _session_factory = session_factory


async def get_db() -> AsyncSession:
    """FastAPI 依赖注入：每次请求提供一个数据库会话，请求结束自动 commit，异常回滚。"""
    async with get_session_factory()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
