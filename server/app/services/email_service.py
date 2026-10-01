"""SMTP 邮件发送服务。"""

import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.config import settings
from app.i18n import get_text

logger = logging.getLogger("safebox.email")


async def _send_email(to: str, subject: str, html_body: str) -> bool:
    """底层发送邮件。

    未配置 SMTP 时的行为按环境分流（**这是刻意的，别改成无条件 return True**）：
      - development：打 warning 日志并返回 True，让本地开发能走通注册/登录全流程；
      - production ：返回 False，由调用方（/send-code）抛 503。**绝不静默假装成功** ——
        生产忘配 SMTP 时若返回 True，用户永远收不到验证码，而接口一路 200，
        这类"看着成功"的失败最难排查。

    注意：日志**只记录主题与收件人**，不打印正文 —— 验证码邮件正文含码，
    任何日志聚合都可能长期留存它。
    """
    if not settings.smtp_username:
        if settings.is_production:
            logger.error(
                "SMTP 未配置（smtp_username 为空），生产环境拒绝发送。"
                "请设置 SAFEBOX_SMTP_USERNAME/PASSWORD 等，或改用其他投递通道。"
            )
            return False
        logger.warning("[DEV] 邮件未配置，主题=%s 应发送到 %s（开发环境放行）", subject, to)
        return True

    msg = MIMEMultipart()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html"))

    import asyncio
    loop = asyncio.get_running_loop()

    def _send():
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.starttls()
            server.login(settings.smtp_username, settings.smtp_password)
            server.sendmail(settings.smtp_from, to, msg.as_string())

    try:
        await loop.run_in_executor(None, _send)
        return True
    except (smtplib.SMTPException, OSError) as e:
        logger.exception(f"Email send failed: {e}")
        return False


async def send_verification_email(email: str, code: str, lang: str = "en") -> bool:
    """发送邮件验证码。"""
    minutes = settings.verification_code_expire_seconds // 60
    subject = get_text("email_subject", lang)
    body = f"""
    <html>
    <body style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>{get_text("email_heading", lang)}</h2>
        <p>{get_text("email_body_code", lang)}</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px;
                    text-align: center; padding: 20px; background: #f0f0f0;
                    border-radius: 8px; margin: 20px 0;">
            {code}
        </div>
        <p style="color: #666; font-size: 14px;">
            {get_text("email_body_expiry", lang, minutes=minutes)}
            {get_text("email_body_ignore", lang)}
        </p>
    </body>
    </html>
    """
    return await _send_email(email, subject, body)


async def send_password_changed_alert(user, lang: str = "en") -> bool:
    """发送「密码已修改」安全告警（邮件或短信）。

    lang: 收件人语言（zh/en）。**必须由调用方按请求的 Accept-Language 传入** ——
          安全告警收件人看不懂就等于告警失效；早期实现硬编码中文，英文用户收到天书。

    返回 bool：False 表示发送失败，由调用方决定是否处理（当前走 BackgroundTasks，
    失败只记日志、不阻断改密响应 —— 改密本身已成功，不该因通知渠道故障回滚）。

    【历史说明，勿回退】本函数原为 send_recovery_alert，带
    initiate / accelerate / freeze 三个分支，服务于助记词恢复的
    "冷却期 + 冻结/加速" 机制。该机制已在提交 e8acba4
    （"合并主密码 + 取消冷却/加速/冻结恢复机制"）中**主动取消**，
    对应端点 /auth/recovery/* 已删除（见 docs/RECOVERY_MECHANISM.md §11）。
    那三个分支成了永不触达的死代码，且它们构造的 URL 指向已不存在的路由。
    故此收缩为单一职责。若将来要恢复该机制，请连同端点、模型、前端路由
    一并设计，不要只把分支加回来。
    """
    email = user.email
    phone = user.phone
    if not email and not phone:
        return False

    subject = get_text("alert_subject_password_changed", lang)
    body = f"""
        <html>
        <body style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>{get_text("alert_heading", lang)}</h2>
            <p>{get_text("alert_body_password_changed", lang)}</p>
            <p style="color: #666; font-size: 14px;">
                {get_text("alert_body_password_changed_hint", lang)}
            </p>
        </body>
        </html>
        """

    if email:
        return await _send_email(email, subject, body)
    # phone 用户发 SMS 告警
    if phone:
        from app.services.sms_service import send_alert_sms
        sms_key = "sms_alert_password_changed"
        msg = get_text(sms_key, lang)
        if msg == sms_key:
            # key 缺失时 get_text 原样返回 key —— 不要把这个当文案发出去
            logger.warning("缺少翻译 key %s (lang=%s)", sms_key, lang)
            return False
        return await send_alert_sms(phone, msg, lang)
    return False
