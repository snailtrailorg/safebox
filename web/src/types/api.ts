/** API 请求/响应类型（SRP-6a 模型）。 */

// ── 验证码 ──────────────────────────────────────────

export interface SendCodeRequest {
  target: "phone" | "email";
  value: string;
}
export interface SendCodeResponse { expires_in: number }

// ── /salt 响应 ─────────────────────────────────────

export interface SaltResponse {
  srp_salt: string;        // hex，2SKD x 派生用
  local_salt: string;      // base64，cached_K / mnemonic 缓存派生用
  mnemonic_salt: string;   // base64，K 派生用
  kdf_settings: { algorithm: string; iterations: number };
  N: string;               // hex，RFC 3526 4096-bit（前端也硬编码，此处用于一致性校验）
  g: string;               // "2"
}

// ── 注册 ──────────────────────────────────────────

export interface RegisterEmailRequest {
  email: string;
  verification_code: string;
  srp_verifier: string;          // hex，客户端 deriveX + computeVerifier 本地派生
  srp_salt: string;               // hex，客户端生成
  local_salt: string;
  encrypted_user_key: string;     // AES(K, User Key), K=PBKDF2(助记词+主密码,mnemonic_salt)
  mnemonic_salt: string;          // K 派生用盐
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
  srp_verifier: string;           // Google 用户也存 verifier，供改密/删号 SRP 验旧密码
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
}

// ── 登录（SRP-6a 两步：challenge A->B，verify M1->M2+token）──

export interface SRPChallengeRequest {
  target_type: "phone" | "email";
  target: string;
  A: string;                      // hex，客户端公开值
}
export interface SRPChallengeResponse {
  session_id: string;
  B: string;                      // hex，服务端公开值
}
export interface SRPVerifyRequest {
  session_id: string;
  M1: string;                     // hex，客户端证据
}
export interface LoginGoogleRequest { google_id_token: string }
export interface LoginResponse {
  user_id: string;
  access_token: string;
  refresh_token: string;
  local_salt: string;
  encrypted_user_key: string;
  mnemonic_salt: string;
  M2: string;                     // hex，服务端证据（SRP 登录有，Google 登录空）
  devices?: DeviceInfo[];
}
export interface DeviceInfo { id: string; device_name?: string | null; device_wrapped: string }

// ── 改密（旧密码由前置 SRP 登录验，此端点只传新材料）──

export interface ChangePasswordRequest {
  target: "phone" | "email";
  value: string;
  verification_code: string;
  new_srp_verifier: string;
  new_srp_salt: string;
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

// ── 删号（旧密码由前置 SRP 登录验，只需验证码）──

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
