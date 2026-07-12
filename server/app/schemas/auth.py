"""认证相关的请求/响应 Schema（模型 D 串行化）。"""

from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field


# ── 验证码 ──────────────────────────────────────────

class SendCodeRequest(BaseModel):
    target: str = Field(..., pattern="^(phone|email)$")
    value: str = Field(..., min_length=5, max_length=320)


class SendCodeResponse(BaseModel):
    expires_in: int


# ── 注册（模型 D：K=PBKDF2(恢复码[+主密码])，encrypted_user_key=AES(K,UserKey)）──

class RegisterEmailRequest(BaseModel):
    model_config = {"populate_by_name": True}
    email: EmailStr
    verification_code: str = Field(..., min_length=6, max_length=6)
    auth_key_hash: str = Field(..., alias="password_hash")  # PBKDF2(登录密码, login_salt+"auth") - 客户端已派生
    login_salt: str                                         # 登录密码派生用盐
    kdf_settings: Optional[dict] = None
    encrypted_user_key: str                                 # AES(K, User Key)，K=PBKDF2(恢复码[+主密码],recovery_salt)
    recovery_salt: str                                      # K 派生用盐
    has_master_password: bool = False
    recovery_code: str                                      # 恢复码明文（服务端接收一次，计算 HMAC hash 存储）
    recovery_code_salt: str                                 # HMAC 验码用盐（服务端生成或客户端上传）
    device_name: Optional[str] = None
    device_public_key: str = "web"
    device_wrapped: str = "web"


class RegisterPhoneRequest(BaseModel):
    model_config = {"populate_by_name": True}
    phone: str = Field(..., pattern=r"^\+?[1-9]\d{6,14}$")
    verification_code: str = Field(..., min_length=6, max_length=6)
    auth_key_hash: str = Field(..., alias="password_hash")
    login_salt: str
    kdf_settings: Optional[dict] = None
    encrypted_user_key: str
    recovery_salt: str
    has_master_password: bool = False
    recovery_code: str
    recovery_code_salt: str
    device_name: Optional[str] = None
    device_public_key: str = "web"
    device_wrapped: str = "web"


class RegisterGoogleRequest(BaseModel):
    model_config = {"populate_by_name": True}
    google_id_token: str
    auth_key_hash: str = Field(..., alias="password_hash")
    login_salt: str
    kdf_settings: Optional[dict] = None
    encrypted_user_key: str
    recovery_salt: str
    has_master_password: bool = False
    recovery_code: str
    recovery_code_salt: str
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
    login_salt: str                                    # 登录密码派生用盐（新设备登录时必需）
    encrypted_user_key: str                            # AES(K, User Key)，换设备时解出 User Key
    recovery_salt: str                                 # K 派生用盐
    has_master_password: bool = False
    devices: List["DeviceInfo"] = []


class DeviceInfo(BaseModel):
    id: str
    device_name: Optional[str]
    device_wrapped: str


# ── 密码校验（/verify，语义1）──────────────────────

class VerifyRequest(BaseModel):
    auth_key_hash: str
    password_version: int


class VerifyResponse(BaseModel):
    password_version: int
    status: str = "ok"  # "ok" | "password_changed"


# ── 改登录密码 ──────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    """模型 D 改密：只改登录密码认证字段（authKey+login_salt+password_version），不改  K/User Key。"""
    model_config = {"populate_by_name": True}
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    verification_code: str = Field(..., min_length=6, max_length=6)
    current_auth_key_hash: str = Field(..., alias="current_password_hash")
    new_auth_key_hash: str = Field(..., alias="new_password_hash")
    new_login_salt: str


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
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    verification_code: str = Field(..., min_length=6, max_length=6)
