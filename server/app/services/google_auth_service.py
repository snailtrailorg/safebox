"""Google OAuth 身份验证服务。"""

from app.config import settings


async def verify_google_id_token(token: str) -> str | None:
    """验证 Google ID Token。

    Returns:
        Google 用户 ID (sub) 如果验证通过，否则 None。
    """
    if not settings.google_client_id:
        print(f"[DEV] Google OAuth 未配置，使用占位验证")
        return f"google:{token[:32]}"

    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests

        import asyncio
        loop = asyncio.get_running_loop()

        def _verify():
            idinfo = id_token.verify_oauth2_token(
                token,
                google_requests.Request(),
                settings.google_client_id,
            )
            return idinfo.get("sub")

        return await loop.run_in_executor(None, _verify)
    except Exception as e:
        print(f"[GOOGLE AUTH ERROR] {e}")
        return None
