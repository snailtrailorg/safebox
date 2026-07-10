/**
 * 路由守卫
 */
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { getSession } from "../db/sessionStore";
import { keyChain } from "../keychain/keyChain";
import { PasswordInput } from "../components/ui/PasswordInput";
import type { ReactNode } from "react";

/** 需要登录才能访问 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  if (status === "guest") {
    return <Navigate to="/login" replace />;
  }

  // 已登录但密钥锁定 → 显示解锁界面
  if (status === "locked") {
    return <UnlockScreen />;
  }

  return <>{children}</>;
}

/** 已登录则重定向到首页 */
export function GuestGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  if (status === "ready" || status === "locked") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function UnlockScreen() {
  const { t } = useTranslation();
  const { unlock, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const handleUnlock = async () => {
    if (!password) return;
    setUnlocking(true);
    setError("");
    try {
      const session = await getSession();
      const ok = await keyChain.unlockWithPassword(password, session.loginSalt, session.encrypted_user_key);
      if (!ok) {
        setError(t("auth.login.unlockFailed"));
        setUnlocking(false);
        return;
      }
      // 模型 D：无 RSA，直接解锁
      unlock();
    } catch {
      setError(t("auth.login.unlockFailed"));
      setUnlocking(false);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #1a1a2e, #16213e)",
      padding: "1rem",
    }}>
      <div style={{
        background: "#fff",
        borderRadius: 12,
        padding: "2rem",
        maxWidth: 360,
        width: "100%",
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
      }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔐</div>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#333", margin: 0 }}>
            {t("app.unlockTitle")}
          </h2>
        </div>

        <div style={{
          background: "#fef3cd", border: "1px solid #ffc107", borderRadius: 8,
          padding: "0.6rem 0.8rem", marginBottom: "1rem",
          fontSize: "0.8rem", color: "#856404", lineHeight: 1.5,
        }}>
          {t("app.unlockHint")}
        </div>

        <PasswordInput
          label={t("auth.login.passwordLabel")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("auth.login.passwordPlaceholder")}
        />

        {error && (
          <p style={{ color: "#e74c3c", fontSize: "0.85rem", margin: "0.5rem 0" }}>{error}</p>
        )}

        <button
          onClick={handleUnlock}
          disabled={unlocking}
          style={{
            width: "100%", padding: "0.75rem",
            background: unlocking ? "#95a5a6" : "#0f3460",
            color: "#fff", border: "none", borderRadius: 8,
            fontSize: "0.95rem", fontWeight: 600,
            cursor: unlocking ? "not-allowed" : "pointer",
          }}
        >
          {unlocking ? t("common.unlocking") : t("common.continue")}
        </button>

        <button
          onClick={handleLogout}
          style={{
            width: "100%", padding: "0.65rem",
            marginTop: "0.5rem",
            background: "none", border: "1px solid #e74c3c", borderRadius: 8,
            color: "#e74c3c", fontSize: "0.9rem",
            cursor: "pointer",
          }}
        >
          {t("settings.logout")}
        </button>
      </div>
    </div>
  );
}
