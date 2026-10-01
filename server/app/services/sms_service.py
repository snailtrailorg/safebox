"""Twilio 短信服务。"""

import logging

import httpx
from app.config import settings
from app.i18n import get_text

logger = logging.getLogger("safebox.sms")

TWILIO_URL = "https://api.twilio.com/2010-04-01/Accounts"


async def send_sms(phone: str, code: str, lang: str = "en") -> bool:
    """发送短信验证码。

    Args:
        phone: 收件人手机号
        code: 验证码
        lang: 语言代码 (zh/en)

    Returns:
        True 如果发送成功。

    Raises:
        不抛异常；失败以 False 表达，由调用方转 503。见下方未配置分支的说明。
    """
    if not settings.twilio_account_sid:
        # 与 email_service 同策略：开发放行、生产拒绝，绝不静默假装成功。
        # 且**验证码本身只在 development 才可能进日志** —— production 分支
        # 只报配置缺失，不碰 code（生产日志开 DEBUG 也不泄码）。
        if settings.is_production:
            logger.error(
                "Twilio 未配置（twilio_account_sid 为空），生产环境拒绝发送。"
                "请设置 SAFEBOX_TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER。"
            )
            return False
        logger.warning("[DEV] SMS not configured. Code %s would be sent to %s（开发环境放行）", code, phone)
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

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, data=body, auth=auth, timeout=10)
            data = resp.json()
            return data.get("status") in ("queued", "sent", "delivered")
    except (httpx.HTTPError, httpx.TimeoutException) as e:
        logger.exception(f"SMS send failed: {e}")
        return False


async def send_alert_sms(phone: str, message: str, lang: str = "en") -> bool:
    """发送告警短信（自定义文本，如"密码已修改"安全告警）。

    注：早期 docstring 写"如助记词告警含 accelerate/freeze URL" —— 该恢复机制
    已在 e8acba4 取消（见 email_service.send_password_changed_alert 的历史说明），
    现仅用于发送单条无链接的告警文案。
    """
    if not settings.twilio_account_sid:
        if settings.is_production:
            logger.error("Twilio 未配置，生产环境拒绝发送告警短信。")
            return False
        # 告警短信正文不含验证码，开发环境可直接落日志便于调试
        logger.warning("[DEV] SMS alert not configured. To=%s: %s（开发环境放行）", phone, message)
        return True

    if not phone.startswith("+"):
        phone = f"+{phone}"

    url = f"{TWILIO_URL}/{settings.twilio_account_sid}/Messages.json"
    auth = (settings.twilio_account_sid, settings.twilio_auth_token)
    body = {"From": settings.twilio_phone_number, "To": phone, "Body": message}

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, data=body, auth=auth, timeout=10)
            data = resp.json()
            return data.get("status") in ("queued", "sent", "delivered")
    except (httpx.HTTPError, httpx.TimeoutException) as e:
        logger.exception(f"SMS alert failed: {e}")
        return False
