"""认证相关的请求/响应 Schema（主密码合并模型）。"""

from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field


# ── 验证码 ──────────────────────────────────────────

class SendCodeRequest(BaseModel):
    target: str = Field(..., pattern="^(phone|email)$")
    value: str = Field(..., min_length=5, max_length=320)


class SendCodeResponse(BaseModel):
    expires_in: int


# ── 注册（K=PBKDF2(助记词+主密码)，encrypted_user_key=AES(K,UserKey)）──

class RegisterEmailRequest(BaseModel):
    model_config = {"populate_by_name": True}
    email: EmailStr
    verification_code: str = Field(..., min_length=6, max_length=6)
    local_password_hash: str = Field(..., alias="local_password_hash")  # PBKDF2(主密码, local_salt+"auth")
    local_salt: str                                         # 主密码派生用盐
    kdf_settings: Optional[dict] = None
    encrypted_user_key: str                                 # AES(K, User Key)，K=PBKDF2(助记词+主密码, mnemonic_salt)
    mnemonic_salt: str                                      # K 派生用盐
    mnemonic: str                                           # 助记词明文（服务端接收一次，HMAC hash 存储）
    mnemonic_hmac_salt: str                                 # HMAC 验码用盐
    device_name: Optional[str] = None
    device_public_key: str = "web"
    device_wrapped: str = "web"


class RegisterPhoneRequest(BaseModel):
    model_config = {"populate_by_name": True}
    phone: str = Field(..., pattern=r"^\+?[1-9]\d{6,14}$")
    verification_code: str = Field(..., min_length=6, max_length=6)
    local_password_hash: str = Field(..., alias="local_password_hash")
    local_salt: str
    kdf_settings: Optional[dict] = None
    encrypted_user_key: str
    mnemonic_salt: str
    mnemonic: str
    mnemonic_hmac_salt: str
    device_name: Optional[str] = None
    device_public_key: str = "web"
    device_wrapped: str = "web"


class RegisterGoogleRequest(BaseModel):
    model_config = {"populate_by_name": True}
    google_id_token: str
    local_password_hash: str = Field(..., alias="local_password_hash")
    local_salt: str
    kdf_settings: Optional[dict] = None
    encrypted_user_key: str
    mnemonic_salt: str
    mnemonic: str
    mnemonic_hmac_salt: str
    device_name: Optional[str] = None
    device_public_key: str = "web"
    device_wrapped: str = "web"


class RegisterResponse(BaseModel):
    user_id: str
    access_token: str
    refresh_token: str


# ── 登录 ──────────────────────────────────────────

class LoginEmailRequest(BaseModel):
    model_config = {"populate_by_name": True}
    email: EmailStr
    local_password_hash: str = Field(..., alias="local_password_hash")


class LoginPhoneRequest(BaseModel):
    model_config = {"populate_by_name": True}
    phone: str
    verification_code: str = Field(..., min_length=6, max_length=6)
    local_password_hash: str = Field(..., alias="local_password_hash")


class LoginGoogleRequest(BaseModel):
    google_id_token: str


class LoginResponse(BaseModel):
    user_id: str
    access_token: str
    refresh_token: str
    local_salt: str                                    # 主密码派生用盐（新设备登录时必需）
    encrypted_user_key: str                            # AES(K, User Key)，换设备时解出 User Key
    mnemonic_salt: str                                 # K 派生用盐
    devices: List["DeviceInfo"] = []


class DeviceInfo(BaseModel):
    id: str
    device_name: Optional[str]
    device_wrapped: str


# ── 改主密码（K 变，重新包裹 encrypted_user_key；前端用助记词+新主密码派生新 K）──

class ChangePasswordRequest(BaseModel):
    """改主密码：主密码参与 K 派生，改密码要重新派生 K + 重新包裹 User Key。
    前端用助记词+新主密码派生新 K，重新包裹 UserKey -> new_encrypted_user_key 上传。"""
    model_config = {"populate_by_name": True}
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    verification_code: str = Field(..., min_length=6, max_length=6)
    current_local_password_hash: str = Field(..., alias="current_local_password_hash")
    new_local_password_hash: str = Field(..., alias="new_local_password_hash")
    new_local_salt: str
    new_encrypted_user_key: str                          # AES(新K, UserKey)，新主密码派生新 K 重新包裹


class ChangePasswordResponse(BaseModel):
    success: bool
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None


# ── Token 刷新 ─────────────────────────────────────

class RefreshTokenRequest(BaseModel):
    refresh_token: str


class RefreshTokenResponse(BaseModel):
    access_token: str
    refresh_token: str


# ── 设备注册 ───────────────────────────────────────

class RegisterDeviceRequest(BaseModel):
    device_name: Optional[str] = None
    device_public_key: str
    device_wrapped: str


class RegisterDeviceResponse(BaseModel):
    device_id: str


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


class DeleteAccountRequest(BaseModel):
    verification_code: str = Field(..., min_length=6, max_length=6)
    current_local_password_hash: str
