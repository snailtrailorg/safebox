/**
 * ChangePasswordPage — 修改密码（需验证码 + 当前密码）
 */
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "../../components/layout/AppLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { SendCodeButton } from "../../components/ui/SendCodeButton";
import { useAuth } from "../../context/AuthContext";
import { apiClient } from "../../services/api";
import { keyChain } from "../../keychain/keyChain";
import { getSession, saveSession } from "../../db/sessionStore";
import { deriveKey, deriveAuthKey, DEFAULT_KDF } from "../../crypto/kdf";
import { aesEncrypt } from "../../crypto/aes";
import { checkPasswordStrength } from "../../config/constants";
import type { KdfSettings } from "../../crypto/kdf";

export function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [changing, setChanging] = useState(false);

  const handleSendVerifyCode = async () => {
    const session = await getSession();
    const ok = await keyChain.unlockWithPassword(currentPassword, session.passwordSalt, session.passwordWrapped);
    if (!ok) throw new Error("wrong password");
    const email = session.email || "";
    if (!email) throw new Error("no email");
    await apiClient.sendCode({ target: "email", value: email });
  };

  const handleChangePassword = async () => {
    if (!newPassword || !verifyCode) {
      setToast({ message: t("settings.enterNewPwAndCode"), type: "error" });
      return;
    }
    const pwCheck = checkPasswordStrength(newPassword);
    if (!pwCheck.ok) {
      setToast({ message: pwCheck.reason || t("settings.passwordMinLength"), type: "error" });
      return;
    }
    setChanging(true);
    try {
      const session = await getSession();
      const email = session.email || "";

      const newSalt = new Uint8Array(32);
      crypto.getRandomValues(newSalt);
      const newDerivedKey = await deriveKey(newPassword, newSalt);
      const newAuthKeyHash = await deriveAuthKey(newPassword, newSalt);

      const masterRaw = await keyChain.exportUserKeyRaw();
      if (!masterRaw) {
        setToast({ message: t("settings.unlockFailed"), type: "error" });
        return;
      }
      const newPasswordWrapped = await aesEncrypt(newDerivedKey, masterRaw);
      const saltBase64 = btoa(String.fromCharCode(...newSalt));

      await apiClient.changePassword({
        target: "email",
        value: email,
        verification_code: verifyCode,
        new_auth_key_hash: newAuthKeyHash,
        new_password_salt: saltBase64,
        new_password_wrapped: newPasswordWrapped,
      });

      await saveSession({
        passwordSalt: saltBase64,
        passwordWrapped: newPasswordWrapped,
      });

      setToast({ message: t("settings.passwordChanged"), type: "success" });
      setCurrentPassword("");
      setNewPassword("");
      setVerifyCode("");
    } catch (e: any) {
      setToast({ message: e.message || t("settings.changeFailed"), type: "error" });
    } finally {
      setChanging(false);
    }
  };

  return (
    <AppLayout title={t("settings.changePassword")}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <section style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <PasswordInput
            label={t("settings.currentPassword")}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={t("settings.currentPasswordPlaceholder")}
          />
          <PasswordInput
            label={t("settings.newPassword")}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t("settings.newPasswordPlaceholder")}
          />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", marginTop: "0.5rem" }}>
            <input
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              placeholder={t("settings.verifyCodePlaceholder")}
              maxLength={6}
              style={{ flex: 1, padding: "0.6rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem" }}
            />
            <SendCodeButton onClick={handleSendVerifyCode} />
          </div>
          <button
            onClick={handleChangePassword}
            disabled={changing}
            style={{
              width: "100%", padding: "0.75rem", marginTop: "0.75rem",
              background: changing ? "#95a5a6" : "#0f3460", color: "#fff",
              border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600,
              cursor: changing ? "not-allowed" : "pointer",
            }}>
            {changing ? t("common.loading") : t("settings.changePassword")}
          </button>
        </section>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AppLayout>
  );
}