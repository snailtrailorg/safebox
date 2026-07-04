/**
 * AuthContext — 认证状态管理
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { keyManager } from "../services/keyManager";
import { hasSession, clearSession, saveSession, getSession, getAccessToken } from "../db/sessionStore";
import { isIndexedDBAvailable } from "../db/database";
import { apiClient } from "../services/api";

export type AuthStatus = "loading" | "guest" | "locked" | "ready";

interface AuthState {
  status: AuthStatus;
  userId: string;
  dbUnavailable: boolean;
  countdown: number;
}

interface AuthContextType extends AuthState {
  login: (accessToken: string, refreshToken: string, userId: string) => Promise<void>;
  logout: () => Promise<void>;
  lock: () => void;
  unlock: () => void;
  checkSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    userId: "",
    dbUnavailable: false,
    countdown: 0,
  });

  const checkSession = useCallback(async () => {
    setState((s) => ({ ...s, status: "loading" }));
    if (!isIndexedDBAvailable()) {
      setState({ status: "guest", userId: "", dbUnavailable: true, countdown: 0 });
      return;
    }
    const has = await hasSession();
    const session = has ? await getSession() : null;
    let tokenValid = false;
    if (has) {
      const token = await getAccessToken();
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1]));
          tokenValid = payload.exp * 1000 > Date.now();
        } catch {
          tokenValid = false;
        }
      }
    }
    // sessionStorage 在关闭浏览器或新开 tab 时自动清除，
    // F5 刷新保留。关闭重开视为新用户，必须重新登录。
    const isNewSession = !sessionStorage.getItem("sb_auth");
    if (isNewSession && has && tokenValid) {
      sessionStorage.setItem("sb_auth", "1");
    }
    const status: AuthStatus = has && tokenValid && !isNewSession
      ? (keyManager.isUnlocked ? "ready" : "locked")
      : "guest";
    setState({
      status,
      userId: session?.serverUserId || "",
      dbUnavailable: false,
      countdown: 0,
    });
  }, []);

  const login = useCallback(async (accessToken: string, refreshToken: string, userId: string) => {
    await saveSession({ accessToken, refreshToken, serverUserId: userId });
    setState({ status: "ready", userId, dbUnavailable: false, countdown: 0 });
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.logout();
    } catch {
      // 网络错误不影响本地登出
    }
    keyManager.lock();
    await clearSession();
    setState({ status: "guest", userId: "", dbUnavailable: false, countdown: 0 });
  }, []);

  const lock = useCallback(() => {
    keyManager.lock();
    setState((s) => ({ ...s, status: "locked", countdown: 0 }));
  }, []);

  const unlock = useCallback(() => {
    setState((s) => ({ ...s, status: "ready" }));
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    apiClient.setOnAuthFailure(() => {
      logout();
    });
  }, [logout]);

  // 自动锁定计时器：20 分钟无操作后锁定，到期前 60 秒倒计时
  useEffect(() => {
    const INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;
    const WARN_COUNTDOWN_MS    = 60 * 1000;
    const WARN_AT_MS           = INACTIVITY_TIMEOUT_MS - WARN_COUNTDOWN_MS;
    let lockTimer: ReturnType<typeof setTimeout>;
    let countdownTimer: ReturnType<typeof setInterval>;

    const cancelTimers = () => {
      clearTimeout(lockTimer);
      clearInterval(countdownTimer);
      setState((s) => (s.countdown > 0 ? { ...s, countdown: 0 } : s));
    };

    const startCountdown = () => {
      setState((s) => ({ ...s, countdown: WARN_COUNTDOWN_MS / 1000 }));
      countdownTimer = setInterval(() => {
        setState((prev) => {
          const next = prev.countdown - 1;
          if (next <= 0) {
            clearInterval(countdownTimer);
            // 异步调度 lock()，避免在 setState updater 中触发副作用
            setTimeout(() => lock(), 0);
            return { ...prev, countdown: 0 };
          }
          return { ...prev, countdown: next };
        });
      }, 1000);
    };

    const resetTimer = () => {
      cancelTimers();
      if (state.status === "ready") {
        lockTimer = setTimeout(startCountdown, WARN_AT_MS);
      }
    };

    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      cancelTimers();
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [state.status, lock]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, lock, unlock, checkSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
