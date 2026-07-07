import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "../../components/layout/AuthLayout";

/**
 * RecoveryCodePage — 注册后不再在此展示恢复码。
 * 恢复码现在在安全设置页中单独生成。
 */
export function RecoveryCodePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <AuthLayout title={t("auth.register.successTitle")} subtitle={t("auth.register.successSubtitle")}>
      <div style={{ background: "#f0fff0", border: "1px solid #27ae60", borderRadius: 8, padding: "1rem", marginBottom: "1rem", textAlign: "center" }}>
        <p style={{ fontSize: "0.9rem", color: "#27ae60", fontWeight: 600 }}>
          {t("auth.register.registrationComplete")}
        </p>
        <p style={{ fontSize: "0.85rem", color: "#333", marginTop: "0.5rem" }}>
          {t("auth.register.recoveryCodeInSettings")}
        </p>
      </div>
      <button
        onClick={() => navigate("/")}
        style={{
          width: "100%", padding: "0.75rem",
          background: "#0f3460", color: "#fff",
          border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("auth.register.enterVault")}
      </button>
    </AuthLayout>
  );
}