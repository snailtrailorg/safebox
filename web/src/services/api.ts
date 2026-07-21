/**
 * API 客户端 - fetch 封装 + JWT 注入 + 401 自动刷新 + SRP K 通信加密
 * 对标 1Password SRP+GCM：认证 POST body + 响应用 K 加密（AES-256-GCM）
 */
import type {
  SendCodeRequest, SendCodeResponse,
  RegisterEmailRequest, RegisterPhoneRequest, RegisterGoogleRequest, RegisterResponse,
  SaltResponse,
  SRPChallengeRequest, SRPChallengeResponse, SRPVerifyRequest,
  LoginGoogleRequest, LoginResponse,
  ChangePasswordRequest, ChangePasswordResponse,
  RefreshTokenRequest, RefreshTokenResponse,
  DeleteAccountRequest,
  DeviceInfo,
  SyncPushRequest, SyncPushResponse, SyncPullResponse, SyncDeleteRequest, SyncDeleteResponse,
} from "../types/api";
import { getAccessToken, getRefreshToken, updateTokens, getSession } from "../db/sessionStore";
import { encryptBody, decryptBody, hexToBytes } from "../crypto/transport";

const API_BASE = "/api/v1";
const BODY_METHODS = ["POST", "PUT", "DELETE", "PATCH"];

function getLang(): string {
  return navigator.language.startsWith("zh") ? "zh" : "en";
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

class ApiClient {
  private onAuthFailure: (() => void) | null = null;

  setOnAuthFailure(cb: () => void): void { this.onAuthFailure = cb; }

  private async getK(): Promise<Uint8Array | null> {
    const session = await getSession();
    if (!session.session_K) return null;
    return hexToBytes(session.session_K);
  }

  private async request<T>(method: string, path: string, body?: unknown, skipAuth = false): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept-Language": getLang(),
    };
    if (!skipAuth) {
      const token = await getAccessToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    // 认证请求（!skipAuth）才取 K：GET 解密响应；BODY_METHODS 加密 body + 发 header 防 downgrade
    // 登录前请求（register/login/salt/refresh，skipAuth）走 middleware 白名单透传，不能加密 body（否则端点收到密文）
    const K = !skipAuth ? await this.getK() : null;
    if (K && BODY_METHODS.includes(method)) {
      headers["X-Safebox-Encrypted"] = "1";
    }
    let reqBody: BodyInit | undefined;
    if (body !== undefined) {
      const json = JSON.stringify(body);
      if (K) {
        // 加密 body，保持 Content-Type=application/json（middleware 解密后端点按 JSON 解析明文）
        reqBody = (await encryptBody(K, new TextEncoder().encode(json))) as BodyInit;
      } else {
        reqBody = json;
      }
    }

    const url = `${API_BASE}${path}`;
    let response = await fetch(url, { method, headers, body: reqBody });

    // 401 自动刷新 token
    if (response.status === 401 && !skipAuth) {
      let refreshed = false;
      try { refreshed = await this.tryRefreshToken(); } catch { /* 网络错误不触发登出 */ }
      if (refreshed) {
        const newToken = await getAccessToken();
        if (newToken) {
          headers["Authorization"] = `Bearer ${newToken}`;
          const K2 = await this.getK();
          if (K2 && body !== undefined) {
            reqBody = (await encryptBody(K2, new TextEncoder().encode(JSON.stringify(body)))) as BodyInit;
          }
          response = await fetch(url, { method, headers, body: reqBody });
        }
      } else {
        this.onAuthFailure?.();
        throw new ApiError(401, "Authentication failed");
      }
    }

    return this.parseResponse<T>(response, K);
  }

  private async parseResponse<T>(response: Response, K: Uint8Array | null): Promise<T> {
    const isEncrypted = response.headers.get("X-Safebox-Encrypted") === "1";
    if (!response.ok) {
      let detail = `Request failed: ${response.status}`;
      try {
        if (isEncrypted && K) {
          const enc = new Uint8Array(await response.arrayBuffer());
          const dec = await decryptBody(K, enc);
          const err = JSON.parse(new TextDecoder().decode(dec));
          detail = Array.isArray(err.detail) ? err.detail.map((e: { msg: string }) => e.msg).join("; ")
                 : (typeof err.detail === "string" ? err.detail : detail);
        } else {
          const err = await response.json().catch(() => ({}));
          detail = Array.isArray(err.detail) ? err.detail.map((e: { msg: string }) => e.msg).join("; ")
                 : (typeof err.detail === "string" ? err.detail : detail);
        }
      } catch { /* 保留默认 detail */ }
      throw new ApiError(response.status, detail);
    }
    if (response.status === 204) return undefined as T;
    if (isEncrypted && K) {
      const enc = new Uint8Array(await response.arrayBuffer());
      const dec = await decryptBody(K, enc);
      return JSON.parse(new TextDecoder().decode(dec)) as T;
    }
    return response.json() as Promise<T>;
  }

  private async tryRefreshToken(): Promise<boolean> {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return false;
      const result = await this.request<RefreshTokenResponse>(
        "POST", "/auth/refresh-token",
        { refresh_token: refreshToken } satisfies RefreshTokenRequest, true,
      );
      await updateTokens(result.access_token, result.refresh_token);
      return true;
    } catch { return false; }
  }

  // ── Auth 端点 ────────────────────────────────────

  async sendCode(req: SendCodeRequest): Promise<SendCodeResponse> { return this.request("POST", "/auth/send-code", req, true); }
  async registerEmail(req: RegisterEmailRequest): Promise<RegisterResponse> { return this.request("POST", "/auth/register/email", req, true); }
  async registerPhone(req: RegisterPhoneRequest): Promise<RegisterResponse> { return this.request("POST", "/auth/register/phone", req, true); }
  async registerGoogle(req: RegisterGoogleRequest): Promise<RegisterResponse> { return this.request("POST", "/auth/register/google", req, true); }
  async getSalt(email?: string, phone?: string): Promise<SaltResponse> {
    const params = new URLSearchParams();
    if (email) params.set("email", email);
    if (phone) params.set("phone", phone);
    return this.request("GET", `/auth/salt?${params.toString()}`, undefined, true);
  }
  async loginSrpChallenge(req: SRPChallengeRequest): Promise<SRPChallengeResponse> { return this.request("POST", "/auth/login/srp/challenge", req, true); }
  async loginSrpVerify(req: SRPVerifyRequest): Promise<LoginResponse> { return this.request("POST", "/auth/login/srp/verify", req, true); }
  async loginGoogle(req: LoginGoogleRequest): Promise<LoginResponse> { return this.request("POST", "/auth/login/google", req, true); }
  async changePassword(req: ChangePasswordRequest): Promise<ChangePasswordResponse> { return this.request("POST", "/auth/change-password", req); }

  // ── 设备管理 ──

  async listDevices(): Promise<DeviceInfo[]> { return this.request("GET", "/auth/devices"); }
  async deauthorizeDevice(deviceId: string): Promise<void> { await this.request("DELETE", `/auth/devices/${deviceId}`); }

  // ── Sync 端点 ────────────────────────────────────

  async pull(since: string, sinceId?: string | null, limit = 100): Promise<SyncPullResponse> {
    const params = new URLSearchParams({ since, limit: String(limit) });
    if (sinceId) params.set("since_id", sinceId);
    return this.request("GET", `/sync/pull?${params.toString()}`);
  }
  async push(req: SyncPushRequest): Promise<SyncPushResponse> { return this.request("POST", "/sync/push", req); }
  async delete(req: SyncDeleteRequest): Promise<SyncDeleteResponse> { return this.request("POST", "/sync/delete", req); }

  // ── 账号管理 ──

  async deleteAccount(req: DeleteAccountRequest): Promise<void> { await this.request("DELETE", "/auth/account", req); }
  async logout(): Promise<void> { await this.request("POST", "/auth/logout", {}); }
}

export const apiClient = new ApiClient();
export { ApiError };
