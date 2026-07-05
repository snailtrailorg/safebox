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

        _engine = create_async_engine(settings.database_url, echo=False)
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
    """FastAPI 依赖注入：每次请求提供一个数据库会话。"""
    async with get_session_factory()() as session:
        yield session
