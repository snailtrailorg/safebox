/**
 * AccelerateRecoveryPage - 加速恢复（邮件"我是本人"链接落地页）
 *
 * 从 URL ?token= 读 signed_token，用户输入注册邮箱收验证码，
 * 调 POST /auth/recovery/accelerate 解除冷却（需验证码二次确认）。
 */
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Toast } from "../../components/ui/Toast";
import { SendCodeButton } from "../../components/ui/SendCodeButton";
import { apiClient } from "../../services/api";

type ToastState = { message: string; type: "info" | "error" | "success" } | null;

export function AccelerateRecoveryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  if (!token) {
    return (
      <AuthLayout title={t("auth.recovery.accelerateTitle")}>
        <p style={{ textAlign: "center", padding: "2rem", color: "#666" }}>{t("auth.recovery.invalidToken")}</p>
      </AuthLayout>
    );
  }

  const handleSendCode = async () => {
    if (!email.trim()) return;
    try {
      await apiClient.sendCode({ target: "email", value: email.trim() });
      setToast({ message: t("auth.recovery.codeSentToEmail"), type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || t("auth.recovery.sendFailed"), type: "error" });
    }
  };

  const handleAccelerate = async () => {
    if (!email.trim()) {
      setToast({ message: t("auth.recovery.enterEmail"), type: "error" });
      return;
    }
    if (!code || code.length !== 6) {
      setToast({ message: t("auth.recovery.enterNewPwAndCode"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      await apiClient.accelerateRecovery({ signed_token: token, verification_code: code });
      setDone(true);
      setToast({ message: t("auth.recovery.accelerated"), type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || t("auth.recovery.recoverFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthLayout title={t("auth.recovery.accelerateTitle")}>
        <p style={{ textAlign: "center", padding: "2rem 0", color: "#27ae60", fontSize: "0.95rem" }}>{t("auth.recovery.accelerated")}</p>
        <button onClick={() => navigate("/login")}
          style={{ width: "100%", padding: "0.75rem", background: "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: "pointer" }}>
          {t("common.backToLogin")}
        </button>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("auth.recovery.accelerateTitle")} subtitle={t("app.recoverAccount")}>
      <p style={{ fontSize: "0.85rem", color: "#666", marginBottom: "1rem" }}>{t("auth.recovery.accelerateDesc")}</p>
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.recovery.emailLabel")}</label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.recovery.emailPlaceholder")}
            style={{ flex: 1, padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
          <SendCodeButton onClick={handleSendCode} disabled={!email.trim()} />
        </div>
      </div>
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.login.codeLabel")}</label>
        <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("auth.login.codePlaceholder")} maxLength={6}
          style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
      </div>
      <button onClick={handleAccelerate} disabled={loading}
        style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
        {loading ? t("common.loading") : t("auth.recovery.accelerateBtn")}
      </button>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}
