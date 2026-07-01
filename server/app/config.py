"""应用配置，通过环境变量覆盖默认值。"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 数据库
    database_url: str = "postgresql+asyncpg://safebox:safebox@localhost:5432/safebox"

    # JWT — 生产环境必须覆盖此默认值
    jwt_secret_key: str = "change-me-in-production-use-openssl-rand-hex-32"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30

    # 验证码
    verification_code_length: int = 6
    verification_code_expire_seconds: int = 300  # 5 分钟
    verification_code_rate_limit_seconds: int = 60  # 同目标 60 秒内只能发一次

    # Redis (验证码存储)
    redis_url: str = "redis://localhost:6379/0"

    # SMS (Twilio)
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""  # e.g. +1234567890

    # Email
    smtp_host: str = "smtp.example.com"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "noreply@safebox.example.com"

    # Debug mode — 关闭时 Google OAuth 必须配置真实凭证
    debug: bool = True

    # Google OAuth
    google_client_id: str = ""

    # CORS
    cors_origins: str = "*"

    # 同步
    sync_batch_limit: int = 100

    model_config = {"env_prefix": "SAFEBOX_", "env_file": ".env"}


settings = Settings()
