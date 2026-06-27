/**
 * AuthContext — 认证状态管理
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { keyManager } from "../services/keyManager";
import { hasSession, clearSession, saveSession } from "../db/sessionStore";
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
    setState({
      isLoggedIn: has && keyManager.isUnlocked,
      isUnlocked: keyManager.isUnlocked,
      isLoading: false,
      userId: "",
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

  // 自动锁定计时器（5 分钟无操作）
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const resetTimer = () => {
      clearTimeout(timer);
      if (state.isUnlocked) {
        timer = setTimeout(() => lock(), 5 * 60 * 1000);
      }
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      clearTimeout(timer);
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
