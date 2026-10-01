"""应用配置，通过环境变量覆盖默认值。"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 数据库
    database_url: str = "postgresql+asyncpg://safebox:safebox@localhost:5432/safebox"

    # JWT
    jwt_secret_key: str = "change-me-in-production-use-openssl-rand-hex-32"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30

    # 验证码
    verification_code_length: int = 6
    verification_code_expire_seconds: int = 300
    verification_code_rate_limit_seconds: int = 60

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # SMS (Twilio)
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""

    # Email
    smtp_host: str = "smtp.example.com"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "noreply@safebox.example.com"

    # 助记词
    mnemonic_hmac_key: str = ""  # 32 字节 base64 编码，服务端 HMAC 密钥
    cors_origins: str = "*"

    # 运行环境："development"（默认）| "production"
    # 决定「外部服务未配置」时的行为：
    #   development -> 打日志 + 假装成功（便于本地调试走通注册/登录全流程）
    #   production  -> 返回失败（让 /send-code 抛 503，而不是静默发不出去）
    # 误判风险：生产若忘了设为 production，会出现"用户收不到验证码但接口 200"的
    # 静默失败。故 production 部署必须显式设置 SAFEBOX_ENVIRONMENT=production，
    # 本项已列入 DEPLOY.md 检查单。
    environment: str = "development"

    # 限流
    trusted_proxies: str = ""  # 可信代理 IP（逗号分隔），仅这些直连 IP 的 X-Forwarded-For/X-Real-IP 被采纳

    # 同步
    sync_batch_limit: int = 100

    model_config = {"env_prefix": "SAFEBOX_", "env_file": ".env", "extra": "ignore"}

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() in ("production", "prod")


settings = Settings()
