/**
 * AuthContext — 认证状态管理
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { keyManager } from "../services/keyManager";
import { hasSession, clearSession, saveSession, getSession } from "../db/sessionStore";
import { isIndexedDBAvailable } from "../db/database";
import { apiClient } from "../services/api";

interface AuthState {
  isLoggedIn: boolean;
  isUnlocked: boolean;
  isLoading: boolean;
  userId: string;
  dbUnavailable: boolean;
}

interface AuthContextType extends AuthState {
  login: (accessToken: string, refreshToken: string, userId: string) => Promise<void>;
  logout: () => Promise<void>;
  lock: () => void;
  checkSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isLoggedIn: false,
    isUnlocked: false,
    isLoading: true,
    userId: "",
    dbUnavailable: false,
  });

  const checkSession = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true }));
    if (!isIndexedDBAvailable()) {
      setState({
        isLoggedIn: false,
        isUnlocked: false,
        isLoading: false,
        userId: "",
        dbUnavailable: true,
      });
      return;
    }
    const has = await hasSession();
    const session = has ? await getSession() : null;
    setState({
      isLoggedIn: has && keyManager.isUnlocked,
      isUnlocked: keyManager.isUnlocked,
      isLoading: false,
      userId: session?.serverUserId || "",
      dbUnavailable: false,
    });
  }, []);

  const login = useCallback(async (accessToken: string, refreshToken: string, userId: string) => {
    await saveSession({ accessToken, refreshToken, serverUserId: userId });
    setState({
      isLoggedIn: true,
      isUnlocked: true,
      isLoading: false,
      userId,
      dbUnavailable: false,
    });
  }, []);

  const logout = useCallback(async () => {
    keyManager.lock();
    await clearSession();
    setState({
      isLoggedIn: false,
      isUnlocked: false,
      isLoading: false,
      userId: "",
      dbUnavailable: false,
    });
  }, []);

  const lock = useCallback(() => {
    keyManager.lock();
    setState((s) => ({ ...s, isUnlocked: false, isLoggedIn: false, dbUnavailable: false }));
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    apiClient.setOnAuthFailure(() => {
      logout();
    });
  }, [logout]);

  // 自动锁定计时器（20 分钟无操作，到期前 30 秒警告）
  useEffect(() => {
    const LOCK_TIMEOUT = 20 * 60 * 1000;  // 20 分钟
    const WARNING_BEFORE = 30 * 1000;     // 提前 30 秒警告
    let lockTimer: ReturnType<typeof setTimeout>;
    let warnTimer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(lockTimer);
      clearTimeout(warnTimer);
      if (state.isUnlocked) {
        warnTimer = setTimeout(() => {
          if (confirm("即将因长时间无操作而锁定，是否继续保持登录？")) {
            resetTimer();
          }
        }, LOCK_TIMEOUT - WARNING_BEFORE);
        lockTimer = setTimeout(() => lock(), LOCK_TIMEOUT);
      }
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      clearTimeout(lockTimer);
      clearTimeout(warnTimer);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [state.isUnlocked, lock]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, lock, checkSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
