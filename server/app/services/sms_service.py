"""Twilio 短信服务。"""

import httpx
from app.config import settings

TWILIO_URL = "https://api.twilio.com/2010-04-01/Accounts"


async def send_sms(phone: str, code: str) -> bool:
    """发送短信验证码。

    Returns:
        True 如果发送成功。
    """
    if not settings.twilio_account_sid:
        print(f"[DEV] 短信未配置，验证码 {code} 应发送到 {phone}")
        return True

    # 确保号码有 + 前缀
    if not phone.startswith("+"):
        phone = f"+{phone}"

    url = f"{TWILIO_URL}/{settings.twilio_account_sid}/Messages.json"
    auth = (settings.twilio_account_sid, settings.twilio_auth_token)
    body = {
        "From": settings.twilio_phone_number,
        "To": phone,
        "Body": f"[SafeBox] 您的验证码为 {code}，{settings.verification_code_expire_seconds // 60} 分钟内有效。",
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, data=body, auth=auth)
        data = resp.json()
        return data.get("status") in ("queued", "sent", "delivered")
