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
    email: EmailStr
    verification_code: str = Field(..., min_length=6, max_length=6)
    password_hash: str          # PBKDF2(password, salt) - 客户端已哈希
    password_salt: str
    password_wrapped: str       # AES-256-GCM(masterKey, passwordDerivedKey)
    recovery_wrapped: str       # AES-256-GCM(masterKey, recoveryKey)
    encrypted_private: str      # AES-256-GCM(rsaPrivateKey, masterKey)
    rsa_public_key: str
    device_name: str | None = None
    device_public_key: str = "web"      # Android Keystore 公钥
    device_wrapped: str = "web"         # AES-256-GCM(masterKey, devicePublicKey)


class RegisterPhoneRequest(BaseModel):
    phone: str = Field(..., pattern=r"^\+?[1-9]\d{6,14}$")
    verification_code: str = Field(..., min_length=6, max_length=6)
    password_hash: str
    password_salt: str
    password_wrapped: str
    recovery_wrapped: str
    encrypted_private: str
    rsa_public_key: str
    device_name: str | None = None
    device_public_key: str
    device_wrapped: str


class RegisterGoogleRequest(BaseModel):
    google_id_token: str
    password_hash: str
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
    email: EmailStr
    password_hash: str


class LoginPhoneRequest(BaseModel):
    phone: str
    verification_code: str = Field(..., min_length=6, max_length=6)
    password_hash: str


class LoginGoogleRequest(BaseModel):
    google_id_token: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    # 密钥材料（客户端用来解密 masterKey）
    password_salt: str              # PBKDF2 salt，新设备登录时必需
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
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    verification_code: str = Field(..., min_length=6, max_length=6)
    new_password_hash: str
    new_password_salt: str
    new_password_wrapped: str


class ResetPasswordResponse(BaseModel):
    success: bool


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
