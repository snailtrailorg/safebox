"""Twilio 短信服务。"""

import httpx
from app.config import settings
from app.i18n import get_text

TWILIO_URL = "https://api.twilio.com/2010-04-01/Accounts"


async def send_sms(phone: str, code: str, lang: str = "en") -> bool:
    """发送短信验证码。

    Args:
        phone: 收件人手机号
        code: 验证码
        lang: 语言代码 (zh/en)

    Returns:
        True 如果发送成功。
    """
    if not settings.twilio_account_sid:
        print(f"[DEV] 短信未配置，验证码 {code} 应发送到 {phone}")
        return True

    # 确保号码有 + 前缀
    if not phone.startswith("+"):
        phone = f"+{phone}"

    minutes = settings.verification_code_expire_seconds // 60
    url = f"{TWILIO_URL}/{settings.twilio_account_sid}/Messages.json"
    auth = (settings.twilio_account_sid, settings.twilio_auth_token)
    body = {
        "From": settings.twilio_phone_number,
        "To": phone,
        "Body": get_text("sms_body", lang, code=code, minutes=minutes),
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, data=body, auth=auth)
        data = resp.json()
        return data.get("status") in ("queued", "sent", "delivered")
