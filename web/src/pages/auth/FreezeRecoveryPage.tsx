/**
 * FreezeRecoveryPage - 冻结恢复（邮件"非本人"链接落地页）
 *
 * 从 URL ?token= 读 signed_token，确认后调 POST /auth/recovery/freeze
 * 回滚旧密码 + 解除冷却。无需验证码。
 */
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Toast } from "../../components/ui/Toast";
import { apiClient } from "../../services/api";

type ToastState = { message: string; type: "info" | "error" | "success" } | null;

export function FreezeRecoveryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  if (!token) {
    return (
      <AuthLayout title={t("auth.recovery.freezeTitle")}>
        <p style={{ textAlign: "center", padding: "2rem", color: "#666" }}>{t("auth.recovery.invalidToken")}</p>
      </AuthLayout>
    );
  }

  const handleFreeze = async () => {
    setLoading(true);
    try {
      await apiClient.freezeRecovery({ signed_token: token });
      setDone(true);
      setToast({ message: t("auth.recovery.frozen"), type: "success" });
    } catch (e: any) {
      const msg = e?.status === 409 ? t("auth.recovery.alreadyAccelerated") : (e?.message || t("auth.recovery.recoverFailed"));
      setToast({ message: msg, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthLayout title={t("auth.recovery.freezeTitle")}>
        <p style={{ textAlign: "center", padding: "2rem 0", color: "#27ae60", fontSize: "0.95rem" }}>{t("auth.recovery.frozen")}</p>
        <button onClick={() => navigate("/login")}
          style={{ width: "100%", padding: "0.75rem", background: "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: "pointer" }}>
          {t("common.backToLogin")}
        </button>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("auth.recovery.freezeTitle")} subtitle={t("app.recoverAccount")}>
      <p style={{ fontSize: "0.85rem", color: "#666", marginBottom: "1rem" }}>{t("auth.recovery.freezeDesc")}</p>
      <button onClick={handleFreeze} disabled={loading}
        style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#e74c3c", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
        {loading ? t("common.loading") : t("auth.recovery.freezeBtn")}
      </button>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}
