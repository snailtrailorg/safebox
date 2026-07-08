"""认证相关的请求/响应 Schema。"""

from pydantic import BaseModel, EmailStr, Field


# ── 验证码 ──────────────────────────────────────────

class SendCodeRequest(BaseModel):
    target: str = Field(..., pattern="^(phone|email)$")
    value: str = Field(..., min_length=5, max_length=320)


class SendCodeResponse(BaseModel):
    expires_in: int


# ── 注册 ──────────────────────────────────────────

class RegisterEmailRequest(BaseModel):
    model_config = {"populate_by_name": True}
    email: EmailStr
    verification_code: str = Field(..., min_length=6, max_length=6)
    auth_key_hash: str = Field(..., alias="password_hash")  # PBKDF2(password, salt+"auth") - 客户端已派生
    password_salt: str
    password_wrapped: str       # AES-256-GCM(masterKey, passwordDerivedKey)
    recovery_wrapped: str = ""       # 注册时不再生成（恢复码在安全设置页单独生成）
    encrypted_private: str      # AES-256-GCM(rsaPrivateKey, masterKey)
    rsa_public_key: str
    kdf_settings: dict | None = None
    device_name: str | None = None
    device_public_key: str = "web"
    device_wrapped: str = "web"


class RegisterPhoneRequest(BaseModel):
    model_config = {"populate_by_name": True}
    phone: str = Field(..., pattern=r"^\+?[1-9]\d{6,14}$")
    verification_code: str = Field(..., min_length=6, max_length=6)
    auth_key_hash: str = Field(..., alias="password_hash")
    password_salt: str
    password_wrapped: str
    recovery_wrapped: str
    encrypted_private: str
    rsa_public_key: str
    device_name: str | None = None
    device_public_key: str
    device_wrapped: str


class RegisterGoogleRequest(BaseModel):
    model_config = {"populate_by_name": True}
    google_id_token: str
    auth_key_hash: str = Field(..., alias="password_hash")
    password_salt: str
    password_wrapped: str
    recovery_wrapped: str
    encrypted_private: str
    rsa_public_key: str
    device_name: str | None = None
    device_public_key: str
    device_wrapped: str


class RegisterResponse(BaseModel):
    user_id: str
    access_token: str
    refresh_token: str


# ── 登录 ──────────────────────────────────────────

class LoginEmailRequest(BaseModel):
    model_config = {"populate_by_name": True}
    email: EmailStr
    auth_key_hash: str = Field(..., alias="password_hash")


class LoginPhoneRequest(BaseModel):
    model_config = {"populate_by_name": True}
    phone: str
    verification_code: str = Field(..., min_length=6, max_length=6)
    auth_key_hash: str = Field(..., alias="password_hash")


class LoginGoogleRequest(BaseModel):
    google_id_token: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    # 密钥材料（客户端用来解密 masterKey）
    password_salt: str = ""              # PBKDF2 salt，新设备登录时必需
    password_wrapped: str | None = None
    recovery_wrapped: str
    encrypted_private: str
    rsa_public_key: str
    devices: list["DeviceInfo"] = []


class DeviceInfo(BaseModel):
    id: str
    device_name: str | None
    device_wrapped: str


# ── 密码重置 ───────────────────────────────────────

class ResetPasswordRequest(BaseModel):
    model_config = {"populate_by_name": True}
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    verification_code: str = Field(..., min_length=6, max_length=6)
    new_auth_key_hash: str = Field(..., alias="new_password_hash")
    new_password_salt: str
    new_password_wrapped: str


class ResetPasswordResponse(BaseModel):
    success: bool
    access_token: str | None = None
    refresh_token: str | None = None
    password_salt: str | None = None
    password_wrapped: str | None = None
    recovery_wrapped: str | None = None
    encrypted_private: str | None = None
    rsa_public_key: str | None = None


# ── Token 刷新 ─────────────────────────────────────

class RefreshTokenRequest(BaseModel):
    refresh_token: str


class RefreshTokenResponse(BaseModel):
    access_token: str
    refresh_token: str


# ── 设备注册 ───────────────────────────────────────

class RegisterDeviceRequest(BaseModel):
    device_name: str | None = None
    device_public_key: str
    device_wrapped: str


class RegisterDeviceResponse(BaseModel):
    device_id: str


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


class DeleteAccountRequest(BaseModel):
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    verification_code: str = Field(..., min_length=6, max_length=6)
