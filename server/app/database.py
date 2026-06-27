"""SQLAlchemy 异步引擎与会话工厂。懒初始化，允许测试覆盖。"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


_engine = None
_async_session = None


def get_engine():
    global _engine, _async_session
    if _engine is None:
        from app.config import settings

        _engine = create_async_engine(settings.database_url, echo=False)
        _async_session = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)
    return _engine


def get_async_session():
    global _async_session
    if _async_session is None:
        get_engine()
    return _async_session


def set_engine(engine, async_session):
    """测试用：注入自定义引擎和会话工厂。"""
    global _engine, _async_session
    _engine = engine
    _async_session = async_session


async def get_db() -> AsyncSession:
    """FastAPI 依赖注入：每次请求提供一个数据库会话。"""
    async with get_async_session()() as session:
        try:
            yield session
        finally:
            await session.close()
