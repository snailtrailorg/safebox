import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { apiClient } from "../../services/api";
import { deriveKey, deriveAuthKey, DEFAULT_KDF } from "../../crypto/kdf";
import { aesEncrypt, aesDecrypt, base64ToBytes } from "../../crypto/aes";
import type { KdfSettings } from "../../crypto/kdf";

export function RecoveryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const handleInitiateRecovery = async () => {
    if (!email.trim()) {
      setToast({ message: t("auth.recovery.enterEmail"), type: "error" });
      return;
    }
    if (!recoveryCode.trim()) {
      setToast({ message: t("auth.recovery.enterRecoveryCode"), type: "error" });
      return;
    }
    if (!newPassword || newPassword.length < 12) {
      setToast({ message: t("auth.recovery.passwordMinLength"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      // 1. 用新密码派生密钥
      const newSalt = new Uint8Array(32);
      crypto.getRandomValues(newSalt);
      const newDerivedKey = await deriveKey(newPassword, newSalt);
      const newAuthKeyHash = await deriveAuthKey(newPassword, newSalt);
      const newKdf: KdfSettings = DEFAULT_KDF;
      const saltBase64 = btoa(String.fromCharCode(...newSalt));

      // 2. 步骤1：验证恢复码，拿 recovery_wrapped + initiate_token
      const step1 = await apiClient.initiateRecovery({
        target: "email",
        value: email,
        recovery_code: recoveryCode,
        new_auth_key_hash: newAuthKeyHash,
        new_password_salt: saltBase64,
        new_kdf_settings: newKdf,
      });

      // 3. 用恢复码派生密钥解 recovery_wrapped 拿【旧 User Key】（零知识：服务端拿不到）
      const recoverySaltBytes = base64ToBytes(step1.recovery_salt);
      const recoveryDerivedKey = await deriveKey(recoveryCode, recoverySaltBytes);
      const oldUserKeyRaw = await aesDecrypt(recoveryDerivedKey, step1.recovery_wrapped);
      if (!oldUserKeyRaw) {
        throw new Error(t("auth.recovery.recoverFailed"));
      }

      // 4. 用新密码重新包裹【旧 User Key】（User Key 不换，数据不动）
      const newWrappedUserKey = await aesEncrypt(newDerivedKey, oldUserKeyRaw);

      // 5. 步骤2：confirm 提交重包结果（写正式 + 进冷却 + 吊销旧 token）
      const step2 = await apiClient.confirmRecovery({
        initiate_token: step1.initiate_token,
        new_wrapped_user_key: newWrappedUserKey,
      });

      setCooldownUntil(step2.cooldown_until);
      setToast({
        message: t("auth.recovery.cooldownStarted"),
        type: "success",
      });
    } catch (e: any) {
      setToast({ message: e.message || t("auth.recovery.recoverFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  if (cooldownUntil) {
    const expiry = new Date(cooldownUntil);
    const formatTime = (d: Date) => {
      const now = new Date();
      const diff = Math.max(0, d.getTime() - now.getTime());
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      return `${h}h ${m}m ${s}s`;
    };

    return (
      <AuthLayout title={t("auth.recovery.title")} subtitle={t("auth.recovery.cooldownTitle")}>
        <div style={{ textAlign: "center", padding: "2rem 0" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⏳</div>
          <p style={{ fontSize: "1rem", color: "#333", marginBottom: "0.5rem" }}>
            {t("auth.recovery.cooldownDesc")}
          </p>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0f3460", marginBottom: "1.5rem" }}>
            {formatTime(expiry)}
          </div>
          <p style={{ fontSize: "0.85rem", color: "#666" }}>
            {t("auth.recovery.cooldownHint")}
          </p>
          <button onClick={() => navigate("/login")}
            style={{ marginTop: "1.5rem", padding: "0.6rem 2rem", background: "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "0.95rem", fontWeight: 600, cursor: "pointer" }}>
            {t("common.backToLogin")}
          </button>
        </div>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("auth.recovery.title")} subtitle={t("app.recoverAccount")}>
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>
          {t("auth.recovery.emailLabel")}
        </label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder={t("auth.recovery.emailPlaceholder")}
          style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
      </div>
      <div style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>
          {t("auth.recovery.recoveryCodeLabel")}
        </label>
        <textarea value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)}
          placeholder={t("auth.recovery.recoveryCodePlaceholder")} rows={3}
          style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", fontFamily: "monospace", boxSizing: "border-box", resize: "vertical" }} />
      </div>
      <PasswordInput label={t("auth.recovery.newPasswordLabel")} value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)} placeholder={t("auth.recovery.newPasswordPlaceholder")} />
      <button onClick={handleInitiateRecovery} disabled={loading}
        style={{ width: "100%", padding: "0.75rem", marginTop: "0.75rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
        {loading ? t("common.loading") : t("auth.recovery.verifyBtn")}
      </button>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}