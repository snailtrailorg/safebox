"""SMTP 邮件发送服务。"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.config import settings
from app.i18n import get_text


async def send_verification_email(email: str, code: str, lang: str = "en") -> bool:
    """发送邮件验证码。

    Args:
        email: 收件人邮箱
        code: 验证码
        lang: 语言代码 (zh/en)

    Returns:
        True 如果发送成功。
    """
    if not settings.smtp_username:
        print(f"[DEV] 邮件未配置，验证码 {code} 应发送到 {email}")
        return True

    minutes = settings.verification_code_expire_seconds // 60
    msg = MIMEMultipart()
    msg["From"] = settings.smtp_from
    msg["To"] = email
    msg["Subject"] = get_text("email_subject", lang)

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
    msg.attach(MIMEText(body, "html"))

    # smtplib 是同步的，用 run_in_executor 包装
    import asyncio
    loop = asyncio.get_running_loop()

    def _send():
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.starttls()
            server.login(settings.smtp_username, settings.smtp_password)
            server.sendmail(settings.smtp_from, email, msg.as_string())

    try:
        await loop.run_in_executor(None, _send)
        return True
    except Exception as e:
        print(f"[EMAIL ERROR] {e}")
        return False
