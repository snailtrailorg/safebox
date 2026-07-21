"""认证相关的请求/响应 Schema（SRP-6a + 2SKD 模型）。"""

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
    srp_verifier: str                                       # SRP-6a verifier v 的 hex（客户端 deriveX+computeVerifier 本地派生）
    srp_salt: str                                            # 2SKD x 派生用盐（hex），客户端生成
    local_salt: str                                         # 本地 cached_K 派生用盐
    kdf_settings: Optional[dict] = None
    encrypted_user_key: str                                 # AES(K, User Key)，K=PBKDF2(助记词+主密码, mnemonic_salt)
    mnemonic_salt: str                                      # K 派生用盐
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


class RegisterGoogleRequest(BaseModel):
    model_config = {"populate_by_name": True}
    google_id_token: str
    srp_verifier: str                                       # Google 用户也存 verifier，供改密/删号 SRP 验旧密码
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


# ── 登录（SRP-6a 两步：challenge A->B，verify M1->M2+token）──

class SRPChallengeRequest(BaseModel):
    model_config = {"populate_by_name": True}
    target_type: str = Field(..., pattern="^(phone|email)$")
    target: str                                             # email 或 phone
    A: str                                                   # 客户端公开值 A 的 hex


class SRPChallengeResponse(BaseModel):
    session_id: str
    B: str                                                   # 服务端公开值 B 的 hex


class SRPVerifyRequest(BaseModel):
    session_id: str
    M1: str                                                  # 客户端证据 M1 的 hex


class LoginGoogleRequest(BaseModel):
    google_id_token: str


class LoginResponse(BaseModel):
    user_id: str
    access_token: str
    refresh_token: str
    local_salt: str                                          # 本地 cached_K 派生用盐
    encrypted_user_key: str                                  # AES(K, User Key)，解出 User Key
    mnemonic_salt: str                                       # K 派生用盐
    M2: str = ""                                             # 服务端证据 M2 的 hex（SRP 登录有，Google 登录无）
    devices: List["DeviceInfo"] = []


class DeviceInfo(BaseModel):
    id: str
    device_name: Optional[str]
    device_wrapped: str


# ── 改主密码（K 变，重新包裹 encrypted_user_key；前端用助记词+新主密码派生新 K）──
# 旧主密码由前置 SRP 登录验证（客户端先走 challenge+verify 拿 fresh token），此端点只验 fresh token。

class ChangePasswordRequest(BaseModel):
    """改主密码：主密码参与 K 派生，改密码要重新派生 K + 重新包裹 User Key。
    前端用助记词+新主密码派生新 K，重新包裹 UserKey -> new_encrypted_user_key，
    重新派生 SRP x -> new_srp_verifier 上传。旧密码由前置 SRP 登录验证。"""
    model_config = {"populate_by_name": True}
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    verification_code: str = Field(..., min_length=6, max_length=6)
    new_srp_verifier: str
    new_srp_salt: str
    new_local_salt: str
    new_encrypted_user_key: str                              # AES(新K, UserKey)，新主密码派生新 K 重新包裹


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
    """删号：旧主密码由前置 SRP 登录验证，此端点只验 fresh token + 验证码。"""
    verification_code: str = Field(..., min_length=6, max_length=6)
