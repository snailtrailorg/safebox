"""认证相关的请求/响应 Schema（SRP-6a + 2SKD + device 模型）。"""

from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field


# ── 验证码 ──────────────────────────────────────────

class SendCodeRequest(BaseModel):
    target: str = Field(..., pattern="^(phone|email)$")
    value: str = Field(..., min_length=5, max_length=320)


class SendCodeResponse(BaseModel):
    expires_in: int


# ── 注册（K=PBKDF2(助记词+主密码)，encrypted_user_key=AES(K,UserKey)；SRP verifier 客户端派生）──

class RegisterEmailRequest(BaseModel):
    model_config = {"populate_by_name": True}
    email: EmailStr
    verification_code: str = Field(..., min_length=6, max_length=6)
    srp_verifier: str
    srp_salt: str
    local_salt: str
    kdf_settings: Optional[dict] = None
    encrypted_user_key: str
    mnemonic_salt: str
    device_name: Optional[str] = None
    device_public_key: str = "web"
    device_wrapped: str = "web"


class RegisterPhoneRequest(BaseModel):
    model_config = {"populate_by_name": True}
    phone: str = Field(..., pattern=r"^\+?[1-9]\d{6,14}$")
    verification_code: str = Field(..., min_length=6, max_length=6)
    srp_verifier: str
    srp_salt: str
    local_salt: str
    kdf_settings: Optional[dict] = None
    encrypted_user_key: str
    mnemonic_salt: str
    device_name: Optional[str] = None
    device_public_key: str = "web"
    device_wrapped: str = "web"


class RegisterResponse(BaseModel):
    user_id: str
    access_token: str
    refresh_token: str
    device_id: str              # 当前设备 id（token 绑定）


# ── 登录（SRP-6a 两步 + device 绑定）──

class SRPChallengeRequest(BaseModel):
    model_config = {"populate_by_name": True}
    target_type: str = Field(..., pattern="^(phone|email)$")
    target: str
    A: str
    device_id: Optional[str] = None     # 同设备登录（已有 device）
    device_name: Optional[str] = None   # 新设备登录（建 UserDevice）


class SRPChallengeResponse(BaseModel):
    session_id: str
    B: str


class SRPVerifyRequest(BaseModel):
    session_id: str
    M1: str


class LoginResponse(BaseModel):
    user_id: str
    access_token: str
    refresh_token: str
    local_salt: str
    encrypted_user_key: str
    mnemonic_salt: str
    M2: str = ""
    device_id: str = ""            # 当前设备 id（token 绑定）
    devices: List["DeviceInfo"] = []


class DeviceInfo(BaseModel):
    id: str
    device_name: Optional[str] = None
    device_wrapped: str = ""
    client_name: Optional[str] = None
    os_name: Optional[str] = None
    last_auth_ip: Optional[str] = None
    last_active_at: Optional[str] = None
    created_at: Optional[str] = None
    is_revoked: bool = False
    is_current: bool = False


# ── 改主密码 ──

class ChangePasswordRequest(BaseModel):
    model_config = {"populate_by_name": True}
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    verification_code: str = Field(..., min_length=6, max_length=6)
    new_srp_verifier: str
    new_srp_salt: str
    new_local_salt: str
    new_encrypted_user_key: str


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


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


class DeleteAccountRequest(BaseModel):
    verification_code: str = Field(..., min_length=6, max_length=6)
