import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Toast } from "../../components/ui/Toast";
import { keyManager } from "../../services/keyManager";
import { useAuth } from "../../context/AuthContext";
import { getSession } from "../../db/sessionStore";

export function RecoveryCodePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const recoveryCode = keyManager.currentRecoveryCode;

  // 没有恢复码——可能是直接访问 URL，重定向回注册页
  if (!recoveryCode) {
    return (
      <AuthLayout title={t("auth.register.title")} subtitle="">
        <p style={{ textAlign: "center", color: "#e74c3c", fontSize: "0.9rem", padding: "2rem 0" }}>
          {t("auth.register.noRecoveryCode")}
        </p>
        <button
          onClick={() => navigate("/register")}
          style={{
            width: "100%", padding: "0.75rem",
            background: "#0f3460", color: "#fff",
            border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("auth.register.goToRegister")}
        </button>
      </AuthLayout>
    );
  }

  const handleEnter = async () => {
    try {
      const session = await getSession();
      if (session.accessToken && session.refreshToken) {
        await login(session.accessToken, session.refreshToken, session.serverUserId);
      }
      navigate("/");
    } catch {
      setToast({ message: t("auth.login.loginFailed"), type: "error" });
    }
  };

  return (
    <AuthLayout title={t("auth.register.successTitle")} subtitle={t("auth.register.successSubtitle")}>
      <div style={{ background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
        <p style={{ fontSize: "0.85rem", color: "#856404", marginBottom: "0.5rem", fontWeight: 600 }}>
          {t("auth.register.recoveryWarning")}
        </p>
        <p style={{ fontSize: "0.8rem", color: "#856404", marginBottom: "0.75rem" }}>
          {t("auth.register.recoveryWarningDetail")}
        </p>
        <div style={{ background: "#fff", border: "1px solid #ffc107", borderRadius: 6, padding: "0.75rem", fontFamily: "monospace", fontSize: "1.1rem", fontWeight: 700, textAlign: "center", wordBreak: "break-word", color: "#333" }}>
          {recoveryCode}
        </div>
      </div>
      <button onClick={() => { navigator.clipboard.writeText(recoveryCode); setToast({ message: t("auth.register.copied"), type: "success" }); }}
        style={{ width: "100%", padding: "0.5rem", marginBottom: "0.75rem", background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8, cursor: "pointer", fontSize: "0.9rem" }}>
        {t("auth.register.copyRecoveryCode")}
      </button>
      <button onClick={handleEnter}
        style={{ width: "100%", padding: "0.75rem", background: "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: "pointer" }}>
        {t("auth.register.savedAndEnter")}
      </button>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}
