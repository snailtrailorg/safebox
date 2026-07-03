import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { keyManager } from "../../services/keyManager";
import { useAuth } from "../../context/AuthContext";
import { saveSession } from "../../db/sessionStore";
import { apiClient } from "../../services/api";
import { generateSalt, deriveKeyHash, deriveKey } from "../../crypto/pbkdf2";
import { aesEncrypt } from "../../crypto/aes";

export function RecoveryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [recoveryVerified, setRecoveryVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const handleVerifyRecovery = async () => {
    if (!email.trim()) {
      setToast({ message: t("auth.recovery.enterEmail"), type: "error" });
      return;
    }
    if (!recoveryCode.trim()) {
      setToast({ message: t("auth.recovery.enterRecoveryCode"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      const keyData = await apiClient.getSalt(email);
      if (!keyData.recovery_wrapped) {
        setToast({ message: t("auth.recovery.emailNotRegistered"), type: "error" });
        setLoading(false);
        return;
      }

      const ok = await keyManager.unlockWithRecoveryCode(recoveryCode, keyData.recovery_wrapped);
      if (!ok) {
        setToast({ message: t("auth.recovery.invalidCode"), type: "error" });
        setLoading(false);
        return;
      }

      const rsaLoaded = await keyManager.loadRsaKeys(
        keyData.encrypted_private || "",
        keyData.rsa_public_key || "",
      );
      if (!rsaLoaded) {
        setToast({ message: t("auth.recovery.recoveryFailed"), type: "error" });
        setLoading(false);
        return;
      }

      setRecoveryVerified(true);
      setToast({ message: t("auth.recovery.codeVerified"), type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || t("auth.recovery.recoverFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    setSendingCode(true);
    try {
      await apiClient.sendCode({ target: "email", value: email });
      setCodeSent(true);
      setToast({ message: t("auth.recovery.codeSentToEmail"), type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || t("auth.recovery.sendFailed"), type: "error" });
    } finally {
      setSendingCode(false);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || !verifyCode) {
      setToast({ message: t("auth.recovery.enterNewPwAndCode"), type: "error" });
      return;
    }
    if (newPassword.length < 8) {
      setToast({ message: t("auth.recovery.passwordMinLength"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      const newSalt = generateSalt();
      const newDerivedKey = await deriveKey(newPassword, newSalt);
      const masterRaw = await crypto.subtle.exportKey("raw", (keyManager as any).masterKey);
      const newPasswordWrapped = await aesEncrypt(newDerivedKey, new Uint8Array(masterRaw));
      const newPasswordHash = await deriveKeyHash(newPassword, newSalt);
      const saltBase64 = btoa(String.fromCharCode(...newSalt));

      const resp = await apiClient.resetPassword({
        target: "email",
        value: email,
        verification_code: verifyCode,
        new_password_hash: newPasswordHash,
        new_password_salt: saltBase64,
        new_password_wrapped: newPasswordWrapped,
      });
      await saveSession({
        email,
        passwordSalt: saltBase64,
        passwordWrapped: newPasswordWrapped,
        recoveryWrapped: resp.recovery_wrapped ?? "",
        encryptedPrivate: resp.encrypted_private ?? "",
        rsaPublicKey: resp.rsa_public_key ?? "",
      });
      await login(resp.access_token ?? "", resp.refresh_token ?? "", "");
      navigate("/");
    } catch (e: any) {
      setToast({ message: e.message || t("auth.recovery.resetFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={t("auth.recovery.title")} subtitle={t("app.recoverAccount")}>
      {!recoveryVerified ? (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.recovery.emailLabel")}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.recovery.emailPlaceholder")}
              style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.recovery.recoveryCodeLabel")}</label>
            <textarea value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder={t("auth.recovery.recoveryCodePlaceholder")} rows={3}
              style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", fontFamily: "monospace", boxSizing: "border-box", resize: "vertical" }} />
          </div>
          <button onClick={handleVerifyRecovery} disabled={loading}
            style={{ width: "100%", padding: "0.75rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? t("common.loading") : t("auth.recovery.verifyBtn")}
          </button>
        </>
      ) : (
        <>
          <div style={{ marginBottom: "1rem", padding: "0.5rem 0.75rem", background: "#f0fff0", borderRadius: 8, border: "1px solid #27ae60", fontSize: "0.85rem", color: "#27ae60", textAlign: "center" }}>
            {t("auth.recovery.verified")}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <input type="text" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)}
              placeholder={t("auth.recovery.verifyCodePlaceholder")} maxLength={6}
              style={{ flex: 1, padding: "0.5rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
            <button onClick={handleSendCode} disabled={sendingCode || codeSent}
              style={{ padding: "0.5rem 0.75rem", background: codeSent ? "#27ae60" : "#3498db", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem", whiteSpace: "nowrap" }}>
              {sendingCode ? t("common.sending") : codeSent ? t("common.sent") : t("auth.login.sendCode")}
            </button>
          </div>
          <PasswordInput label={t("auth.recovery.newPasswordLabel")} value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)} placeholder={t("auth.recovery.newPasswordPlaceholder")} />
          <button onClick={handleResetPassword} disabled={loading}
            style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? t("common.loading") : t("auth.recovery.resetAndLoginBtn")}
          </button>
        </>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}
