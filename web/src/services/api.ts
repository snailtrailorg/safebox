/**
 * API 客户端 — fetch 封装 + JWT 注入 + 401 自动刷新
 * 对应 Android ApiService.kt + AuthInterceptor.kt
 */
import type {
  SendCodeRequest,
  SendCodeResponse,
  RegisterEmailRequest,
  RegisterPhoneRequest,
  RegisterGoogleRequest,
  RegisterResponse,
  LoginEmailRequest,
  LoginPhoneRequest,
  LoginGoogleRequest,
  LoginResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncPullResponse,
  SyncDeleteRequest,
  SyncDeleteResponse,
} from "../types/api";
import { getAccessToken, getRefreshToken, updateTokens, clearSession } from "../db/sessionStore";

const API_BASE = "/api/v1";

function getLang(): string {
  return navigator.language.startsWith("zh") ? "zh" : "en";
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

class ApiClient {
  private onAuthFailure: (() => void) | null = null;

  setOnAuthFailure(cb: () => void): void {
    this.onAuthFailure = cb;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    skipAuth = false,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept-Language": getLang(),
    };

    if (!skipAuth || path.startsWith("/auth/register-device")) {
      const token = await getAccessToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    const url = `${API_BASE}${path}`;
    let response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // 401 自动刷新 token（仅当服务端返回 401 时才触发，网络错误跳过）
    if (response.status === 401 && !skipAuth) {
      let refreshed = false;
      try {
        refreshed = await this.tryRefreshToken();
      } catch {
        // 网络错误不触发登出
      }
      if (refreshed) {
        const newToken = await getAccessToken();
        if (newToken) {
          headers["Authorization"] = `Bearer ${newToken}`;
          response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });
        }
      } else {
        this.onAuthFailure?.();
        throw new ApiError(401, "Authentication failed");
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      let message = `Request failed: ${response.status}`;
      if (Array.isArray(error.detail)) {
        message = error.detail.map((e: { msg: string }) => e.msg).join("; ");
      } else if (typeof error.detail === "string") {
        message = error.detail;
      }
      throw new ApiError(response.status, message);
    }

    return response.json();
  }

  private async tryRefreshToken(): Promise<boolean> {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return false;
      const result = await this.request<RefreshTokenResponse>(
        "POST",
        "/auth/refresh-token",
        { refresh_token: refreshToken } satisfies RefreshTokenRequest,
        true, // skip auth
      );
      await updateTokens(result.access_token, result.refresh_token);
      return true;
    } catch {
      return false;
    }
  }

  // ── Auth 端点 ────────────────────────────────────

  async sendCode(req: SendCodeRequest): Promise<SendCodeResponse> {
    return this.request("POST", "/auth/send-code", req, true);
  }

  async registerEmail(req: RegisterEmailRequest): Promise<RegisterResponse> {
    return this.request("POST", "/auth/register/email", req, true);
  }

  async registerPhone(req: RegisterPhoneRequest): Promise<RegisterResponse> {
    return this.request("POST", "/auth/register/phone", req, true);
  }

  async registerGoogle(req: RegisterGoogleRequest): Promise<RegisterResponse> {
    return this.request("POST", "/auth/register/google", req, true);
  }

  async getSalt(email?: string, phone?: string): Promise<{ password_salt: string; recovery_wrapped?: string; encrypted_private?: string; rsa_public_key?: string }> {
    const params = new URLSearchParams();
    if (email) params.set("email", email);
    if (phone) params.set("phone", phone);
    return this.request("GET", `/auth/salt?${params.toString()}`, undefined, true);
  }

  async loginEmail(req: LoginEmailRequest): Promise<LoginResponse> {
    return this.request("POST", "/auth/login/email", req, true);
  }

  async loginPhone(req: LoginPhoneRequest): Promise<LoginResponse> {
    return this.request("POST", "/auth/login/phone", req, true);
  }

  async loginGoogle(req: LoginGoogleRequest): Promise<LoginResponse> {
    return this.request("POST", "/auth/login/google", req, true);
  }

  async resetPassword(req: ResetPasswordRequest): Promise<ResetPasswordResponse> {
    return this.request("POST", "/auth/reset-password", req, true);
  }

  async registerDevice(req: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
    return this.request("POST", "/auth/register-device", req);
  }

  // ── Sync 端点 ────────────────────────────────────

  async pull(since: string, limit = 100): Promise<SyncPullResponse> {
    return this.request(
      "GET",
      `/sync/pull?since=${encodeURIComponent(since)}&limit=${limit}`,
    );
  }

  async push(req: SyncPushRequest): Promise<SyncPushResponse> {
    return this.request("POST", "/sync/push", req);
  }

  async delete(req: SyncDeleteRequest): Promise<SyncDeleteResponse> {
    return this.request("POST", "/sync/delete", req);
  }

  // ── 账号管理 ────────────────────────────────────

  async deleteAccount(): Promise<void> {
    await this.request("DELETE", "/auth/account");
  }

  async logout(): Promise<void> {
    await this.request("POST", "/auth/logout", {});
  }
}

export const apiClient = new ApiClient();
export { ApiError };
