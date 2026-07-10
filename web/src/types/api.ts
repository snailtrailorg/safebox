/** 类型定义 — 对应 Android Dtos.kt 中的请求/响应 */

// ── Auth ──────────────────────────────────────────

export interface SendCodeRequest {
  target: "phone" | "email";
  value: string;
}

export interface SendCodeResponse {
  expires_in: number;
}

export interface RegisterEmailRequest {
  email: string;
  verification_code: string;
  auth_key_hash: string;
  password_salt: string;
  password_wrapped: string;
  encrypted_private: string;
  rsa_public_key: string;
  kdf_settings?: Record<string, unknown>;
  device_name?: string;
  device_public_key?: string;
  device_wrapped?: string;
}

export interface RegisterPhoneRequest extends RegisterEmailRequest {
  phone: string;
  verification_code: string;
}

export interface RegisterGoogleRequest {
  google_id_token: string;
  auth_key_hash: string;
  password_salt: string;
  password_wrapped: string;
  encrypted_private: string;
  rsa_public_key: string;
  kdf_settings?: Record<string, unknown>;
  device_name?: string;
  device_public_key?: string;
  device_wrapped?: string;
}

export interface RegisterResponse {
  user_id: string;
  access_token: string;
  refresh_token: string;
}

export interface LoginEmailRequest {
  email: string;
  auth_key_hash: string;
}

export interface LoginPhoneRequest {
  phone: string;
  verification_code: string;
  auth_key_hash: string;
}

export interface LoginGoogleRequest {
  google_id_token: string;
}

export interface DeviceInfo {
  id: string;
  device_name: string | null;
  device_wrapped: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  password_salt: string;
  password_wrapped: string | null;
  encrypted_private: string;
  rsa_public_key: string;
  devices: DeviceInfo[];
}

export interface ResetPasswordRequest {
  target: "phone" | "email";
  value: string;
  verification_code: string;
  new_auth_key_hash: string;
  new_password_salt: string;
  new_password_wrapped: string;
}

/** 已登录改密：在重置字段之外额外携带当前密码派生的 auth key，供服务端二次校验。 */
export interface ChangePasswordRequest extends ResetPasswordRequest {
  current_auth_key_hash: string;
}

export interface ResetPasswordResponse {
  success: boolean;
  access_token?: string;
  refresh_token?: string;
  password_salt?: string;
  password_wrapped?: string;
  encrypted_private?: string;
  rsa_public_key?: string;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
}

export interface RegisterDeviceRequest {
  device_name?: string;
  device_public_key: string;
  device_wrapped: string;
}

export interface RegisterDeviceResponse {
  device_id: string;
}

// ── Recovery ───────────────────────────────────────

export interface GenerateRecoveryRequest {
  target: "phone" | "email";
  value: string;
  verification_code: string;
  current_auth_key_hash: string;
}

export interface GenerateRecoveryResponse {
  recovery_code: string;
}

export interface InitiateRecoveryRequest {
  target: "phone" | "email";
  value: string;
  recovery_code: string;
  new_auth_key_hash: string;
  new_password_salt: string;
  new_kdf_settings: Record<string, unknown>;
  new_wrapped_user_key: string;
}

export interface InitiateRecoveryResponse {
  cooldown_expires_at: string;
}

export interface AccelerateRecoveryRequest {
  signed_token: string;
  verification_code: string;
}

export interface FreezeRecoveryRequest {
  signed_token: string;
}

export interface RecoveryStatusResponse {
  status: string;
  cooldown_expires_at: string | null;
  recovery_attempt_count: number;
}

export interface RevokeRecoveryRequest {
  target: "phone" | "email";
  value: string;
  verification_code: string;
  current_auth_key_hash: string;
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

export interface SyncPushRequest {
  items: SyncItemRequest[];
}

export interface SyncPushResult {
  client_did: number | null;
  server_id: string | null;
  status: "created" | "updated" | "conflict";
  version?: number | null;
}

export interface SyncPushResponse {
  results: SyncPushResult[];
}

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

export interface SyncDeleteRequest {
  server_ids: string[];
}

export interface SyncDeleteResult {
  server_id: string;
  status: "deleted" | "not_found";
}

export interface SyncDeleteResponse {
  results: SyncDeleteResult[];
}
