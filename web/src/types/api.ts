/** API 请求/响应类型（SRP-6a + device 模型）。 */

// ── 验证码 ──────────────────────────────────────────

export interface SendCodeRequest {
  target: "phone" | "email";
  value: string;
}
export interface SendCodeResponse { expires_in: number }

// ── /salt 响应 ─────────────────────────────────────

export interface SaltResponse {
  srp_salt: string;
  local_salt: string;
  mnemonic_salt: string;
  kdf_settings: { algorithm: string; iterations: number };
  N: string;
  g: string;
}

// ── 注册 ──

export interface RegisterEmailRequest {
  email: string;
  verification_code: string;
  srp_verifier: string;
  srp_salt: string;
  local_salt: string;
  encrypted_user_key: string;
  mnemonic_salt: string;
  kdf_settings?: Record<string, unknown>;
  device_name?: string;
  device_public_key?: string;
  device_wrapped?: string;
}
export interface RegisterPhoneRequest extends Omit<RegisterEmailRequest, "email"> {
  phone: string;
}
export interface RegisterGoogleRequest {
  google_id_token: string;
  srp_verifier: string;
  srp_salt: string;
  local_salt: string;
  encrypted_user_key: string;
  mnemonic_salt: string;
  kdf_settings?: Record<string, unknown>;
  device_name?: string;
  device_public_key?: string;
  device_wrapped?: string;
}
export interface RegisterResponse {
  user_id: string;
  access_token: string;
  refresh_token: string;
  device_id: string;            // 当前设备 id（token 绑定）
}

// ── 登录（SRP-6a 两步 + device 绑定）──

export interface SRPChallengeRequest {
  target_type: "phone" | "email";
  target: string;
  A: string;
  device_id?: string;           // 同设备登录（已有 device）
  device_name?: string;         // 新设备登录（建 UserDevice）
}
export interface SRPChallengeResponse {
  session_id: string;
  B: string;
}
export interface SRPVerifyRequest {
  session_id: string;
  M1: string;
}
export interface LoginGoogleRequest {
  google_id_token: string;
  device_id?: string;
  device_name?: string;
}
export interface LoginResponse {
  user_id: string;
  access_token: string;
  refresh_token: string;
  local_salt: string;
  encrypted_user_key: string;
  mnemonic_salt: string;
  M2: string;
  device_id: string;            // 当前设备 id（token 绑定）
  devices?: DeviceInfo[];
}
export interface DeviceInfo {
  id: string;
  device_name?: string | null;
  device_wrapped: string;
  client_name?: string | null;
  os_name?: string | null;
  last_auth_ip?: string | null;
  last_active_at?: string | null;
  created_at?: string | null;
  is_revoked: boolean;
  is_current: boolean;
}

// ── 改密 ──

export interface ChangePasswordRequest {
  target: "phone" | "email";
  value: string;
  verification_code: string;
  new_srp_verifier: string;
  new_srp_salt: string;
  new_local_salt: string;
  new_encrypted_user_key: string;
}
export interface ChangePasswordResponse {
  success: boolean;
  access_token?: string;
  refresh_token?: string;
}

// ── Token ─────────────────────────────────────────

export interface RefreshTokenRequest { refresh_token: string }
export interface RefreshTokenResponse { access_token: string; refresh_token: string }

// ── 删号 ──

export interface DeleteAccountRequest { verification_code: string }

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
