/** API 请求/响应类型（模型 D 串行化）。 */

// ── 验证码 ──────────────────────────────────────────

export interface SendCodeRequest {
  target: "phone" | "email";
  value: string;
}
export interface SendCodeResponse { expires_in: number }

// ── 注册 ──────────────────────────────────────────

export interface RegisterEmailRequest {
  email: string;
  verification_code: string;
  auth_key_hash: string;
  login_salt: string;
  encrypted_user_key: string;     // AES(K, User Key), K=PBKDF2(恢复码[+主密码],recovery_salt)
  recovery_salt: string;          // K 派生用盐
  kdf_settings?: Record<string, unknown>;
  has_master_password?: boolean;
  recovery_code: string;          // 恢复码明文（服务端接收一次，HMAC hash 存储）
  recovery_code_salt: string;     // HMAC 验码用盐
  device_name?: string;
  device_public_key?: string;
  device_wrapped?: string;
}
export interface RegisterPhoneRequest extends RegisterEmailRequest {
  phone: string;
}
export interface RegisterGoogleRequest {
  google_id_token: string;
  auth_key_hash: string;
  login_salt: string;
  encrypted_user_key: string;
  recovery_salt: string;
  kdf_settings?: Record<string, unknown>;
  has_master_password?: boolean;
  recovery_code: string;
  recovery_code_salt: string;
  device_name?: string;
  device_public_key?: string;
  device_wrapped?: string;
}
export interface RegisterResponse {
  user_id: string;
  access_token: string;
  refresh_token: string;
}

// ── 登录 ──────────────────────────────────────────

export interface LoginEmailRequest {
  email: string;
  auth_key_hash: string;
}
export interface LoginPhoneRequest {
  phone: string;
  verification_code: string;
  auth_key_hash: string;
}
export interface LoginGoogleRequest { google_id_token: string }
export interface LoginResponse {
  user_id: string;
  access_token: string;
  refresh_token: string;
  login_salt: string;
  encrypted_user_key: string;
  recovery_salt: string;
  has_master_password: boolean;
  devices?: DeviceInfo[];
}
export interface DeviceInfo { id: string; device_name?: string | null; device_wrapped: string }

// ── Verify ────────────────────────────────────────

export interface VerifyRequest { auth_key_hash: string; password_version: number }
export interface VerifyResponse { password_version: number; status: string }

// ── 改密 ──────────────────────────────────────────

export interface ChangePasswordRequest {
  target: "phone" | "email";
  value: string;
  verification_code: string;
  current_auth_key_hash: string;
  new_auth_key_hash: string;
  new_login_salt: string;
}
export interface ChangePasswordResponse {
  success: boolean;
  access_token?: string;
  refresh_token?: string;
}

// ── Token ─────────────────────────────────────────

export interface RefreshTokenRequest { refresh_token: string }
export interface RefreshTokenResponse { access_token: string; refresh_token: string }

// ── 设备 ──────────────────────────────────────────

export interface RegisterDeviceRequest { device_name?: string; device_public_key: string; device_wrapped: string }
export interface RegisterDeviceResponse { device_id: string }

// ── Recovery ──────────────────────────────────────

export interface InitiateRecoveryRequest {
  target: "phone" | "email";
  value: string;
  recovery_code: string;
  new_auth_key_hash: string;
  new_login_salt: string;
}
export interface InitiateRecoveryResponse {
  encrypted_user_key: string;
  recovery_salt: string;
  initiate_token: string;
}
export interface ConfirmRecoveryRequest {
  initiate_token: string;
}
export interface ConfirmRecoveryResponse { cooldown_until: string }
export interface AccelerateRecoveryRequest { signed_token: string; verification_code: string }
export interface FreezeRecoveryRequest { signed_token: string }
export interface RecoveryStatusResponse {
  status: string;
  cooldown_until: string | null;
  failed_attempt_count?: number;
}
export interface RevokeRecoveryRequest { target: "phone" | "email"; value: string; verification_code: string; current_auth_key_hash: string }

// ── Sync ──────────────────────────────────────────

export interface SyncItemRequest {
  client_did: number | null;
  server_id?: string | null;
  type: string;
  icon: string | null;
  name: string;
  description: string | null;
  data: string | null;
  version: number;
  updated_at: string;
}
export interface SyncPushRequest { items: SyncItemRequest[] }
export interface SyncPushResult {
  client_did: number | null;
  server_id: string | null;
  status: "created" | "updated" | "conflict";
  version?: number | null;
}
export interface SyncPushResponse { results: SyncPushResult[] }
export interface SyncItemResponse {
  server_id: string;
  client_did: number | null;
  type: string;
  icon: string | null;
  name: string;
  description: string | null;
  data: string | null;
  version: number;
  is_deleted: boolean;
  updated_at: string;
}
export interface SyncPullResponse {
  items: SyncItemResponse[];
  server_time: string;
  has_more: boolean;
}
export interface SyncDeleteRequest { server_ids: string[] }
export interface SyncDeleteResult { server_id: string; status: string }
export interface SyncDeleteResponse { results: SyncDeleteResult[] }
