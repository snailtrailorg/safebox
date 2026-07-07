/**
 * AuthContext — 认证状态管理
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { keyChain } from "../keychain/keyChain";
import { hasSession, clearSession, saveSession, getSession, getAccessToken } from "../db/sessionStore";
import { isIndexedDBAvailable } from "../db/database";
import { apiClient } from "../services/api";
import { useAutoLock } from "../hooks/useAutoLock";

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

  const lock = useCallback(() => {
    keyChain.lock();
    setState((s) => ({ ...s, status: "locked", countdown: 0 }));
  }, []);

  const { countdown } = useAutoLock(state.status === "ready", lock);

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
    const isNewSession = !sessionStorage.getItem("sb_auth");
    if (isNewSession && has && tokenValid) {
      sessionStorage.setItem("sb_auth", "1");
    }
    const status: AuthStatus = has && tokenValid && !isNewSession
      ? (keyChain.isUnlocked ? "ready" : "locked")
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
    keyChain.lock();
    await clearSession();
    setState({ status: "guest", userId: "", dbUnavailable: false, countdown: 0 });
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

  return (
    <AuthContext.Provider value={{ ...state, countdown, login, logout, lock, unlock, checkSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}