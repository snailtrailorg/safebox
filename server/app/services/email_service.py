"""SMTP 邮件发送服务。"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.config import settings
from app.i18n import get_text


async def _send_email(to: str, subject: str, html_body: str) -> bool:
    """底层发送邮件。"""
    if not settings.smtp_username:
        print(f"[DEV] 邮件未配置，主题={subject} 应发送到 {to}")
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
        import logging
        logging.getLogger("safebox").exception(f"Email send failed: {e}")
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


async def send_recovery_alert(
    user, event: str, accelerate_token: str = "", freeze_token: str = "",
) -> bool:
    """发送助记词相关告警邮件。

    event: "initiate" | "accelerate" | "freeze" | "password_changed"
    """
    email = user.email
    phone = user.phone
    if not email and not phone:
        return False

    base_url = settings.cors_origins.split(",")[0] if settings.cors_origins != "*" else "https://safebox.snailtrail.org"
    accelerate_url = f"{base_url}/recovery/accelerate?token={accelerate_token}" if accelerate_token else ""
    freeze_url = f"{base_url}/recovery/freeze?token={freeze_token}" if freeze_token else ""

    if event == "initiate":
        accelerate_url = f"{base_url}/recovery/accelerate?token={accelerate_token}"
        freeze_url = f"{base_url}/recovery/freeze?token={freeze_token}"
        subject = "SafeBox 安全告警：助记词已用于重置密码"
        body = f"""
        <html>
        <body style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>⚠️ 安全告警</h2>
            <p>您的 SafeBox 助记词已被用于发起密码重置。</p>
            <p>新密码将在 <strong>24 小时冷却期</strong>后自动生效。</p>
            <p style="margin: 20px 0;">
                <a href="{accelerate_url}" style="display: inline-block; padding: 12px 24px;
                   background: #4CAF50; color: white; text-decoration: none; border-radius: 6px;
                   margin-right: 12px;">✅ 我是本人，立即恢复</a>
                <a href="{freeze_url}" style="display: inline-block; padding: 12px 24px;
                   background: #f44336; color: white; text-decoration: none; border-radius: 6px;">
                   🛑 这不是我，立即冻结</a>
            </p>
            <p style="color: #666; font-size: 14px;">
                如果不是您本人操作，请立即点击"冻结"按钮。冻结后旧密码保持不变。
            </p>
        </body>
        </html>
        """
    elif event == "accelerate":
        subject = "SafeBox：密码重置已确认"
        body = """
        <html>
        <body style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>✅ 密码重置完成</h2>
            <p>您的 SafeBox 新密码已通过加速通道激活。</p>
            <p style="color: #666; font-size: 14px;">如果不是您本人操作，请立即联系客服。</p>
        </body>
        </html>
        """
    elif event == "freeze":
        subject = "SafeBox：密码重置已冻结"
        body = """
        <html>
        <body style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>🛑 密码重置已冻结</h2>
            <p>您的 SafeBox 恢复操作已被冻结。旧密码保持不变，可正常登录。</p>
            <p style="color: #666; font-size: 14px;">如果不是您本人操作，建议登录后修改密码。</p>
        </body>
        </html>
        """
    elif event == "password_changed":
        subject = "SafeBox 安全告警：密码已修改"
        body = """
        <html>
        <body style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>🔐 安全告警</h2>
            <p>您的 SafeBox Passphrase已被修改。</p>
            <p style="color: #666; font-size: 14px;">
                如果不是您本人操作，请立即通过助记词恢复账户。
            </p>
        </body>
        </html>
        """
    else:
        return False

    if email:
        return await _send_email(email, subject, body)
    # phone 用户发 SMS 告警（含 accelerate/freeze URL）
    if phone:
        from app.services.sms_service import send_alert_sms
        if event == "initiate":
            msg = f"SafeBox 安全告警：助记词已用于重置密码。本人加速:{accelerate_url} ; 非本人冻结:{freeze_url}"
        elif event == "accelerate":
            msg = "SafeBox：密码重置已确认"
        elif event == "freeze":
            msg = "SafeBox：密码重置已冻结，旧密码恢复"
        elif event == "password_changed":
            msg = "SafeBox 安全告警：密码已修改"
        else:
            return False
        return await send_alert_sms(phone, msg)
    return False
