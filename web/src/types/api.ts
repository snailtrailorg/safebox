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
  local_password_hash: string;
  local_salt: string;
  encrypted_user_key: string;     // AES(K, User Key), K=PBKDF2(助记词+主密码,mnemonic_salt)
  mnemonic_salt: string;          // K 派生用盐
  kdf_settings?: Record<string, unknown>;

  mnemonic: string;          // 助记词明文（服务端接收一次，HMAC hash 存储）
  mnemonic_hmac_salt: string;     // HMAC 验码用盐
  device_name?: string;
  device_public_key?: string;
  device_wrapped?: string;
}
export interface RegisterPhoneRequest extends Omit<RegisterEmailRequest, "email"> {
  phone: string;
}
export interface RegisterGoogleRequest {
  google_id_token: string;
  local_password_hash: string;
  local_salt: string;
  encrypted_user_key: string;
  mnemonic_salt: string;
  kdf_settings?: Record<string, unknown>;

  mnemonic: string;
  mnemonic_hmac_salt: string;
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
  local_password_hash: string;
}
export interface LoginPhoneRequest {
  phone: string;
  verification_code: string;
  local_password_hash: string;
}
export interface LoginGoogleRequest { google_id_token: string }
export interface LoginResponse {
  user_id: string;
  access_token: string;
  refresh_token: string;
  local_salt: string;
  encrypted_user_key: string;
  mnemonic_salt: string;

  devices?: DeviceInfo[];
}
export interface DeviceInfo { id: string; device_name?: string | null; device_wrapped: string }

// ── Verify ────────────────────────────────────────


// ── 改密 ──────────────────────────────────────────

export interface ChangePasswordRequest {
  target: "phone" | "email";
  value: string;
  verification_code: string;
  current_local_password_hash: string;
  new_local_password_hash: string;
  new_local_salt: string;
  new_encrypted_user_key: string;   // AES(新K, UserKey)，主密码参与 K 派生，改密重包裹
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

// ── Recovery（换设备：验助记词返回 encrypted_user_key）─────────────

export interface InitiateRecoveryRequest {
  target: "phone" | "email";
  value: string;
  mnemonic: string;
}
export interface InitiateRecoveryResponse {
  encrypted_user_key: string;   // 客户端用 K=PBKDF2(助记词+主密码, mnemonic_salt) 解出 User Key
  mnemonic_salt: string;        // K 派生用盐
}

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
  server_id: string | null;
  has_more: boolean;
}
export interface SyncDeleteRequest { server_ids: string[] }
export interface SyncDeleteResult { server_id: string; status: string }
export interface SyncDeleteResponse { results: SyncDeleteResult[] }
