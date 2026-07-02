/**
 * ChangePasswordPage — 修改密码
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
import { keyManager } from "../../services/keyManager";
import { getSession, saveSession } from "../../db/sessionStore";
import { deriveKeyHash, generateSalt, deriveKey } from "../../crypto/pbkdf2";
import { aesEncrypt } from "../../crypto/aes";

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

    const ok = await keyManager.unlockWithPassword(currentPassword, session.passwordSalt, session.passwordWrapped);
    if (!ok) {
      throw new Error("wrong password");
    }

    const email = session.email || "";
    if (!email) {
      throw new Error("no email");
    }
    await apiClient.sendCode({ target: "email", value: email });
  };

  const handleChangePassword = async () => {
    if (!newPassword || !verifyCode) {
      setToast({ message: t("settings.enterNewPwAndCode"), type: "error" });
      return;
    }
    if (newPassword.length < 8) {
      setToast({ message: t("settings.passwordMinLength"), type: "error" });
      return;
    }
    setChanging(true);
    try {
      const session = await getSession();
      const email = session.email || "";

      const newSalt = generateSalt();
      const newDerivedKey = await deriveKey(newPassword, newSalt);
      const newPasswordHash = await deriveKeyHash(newPassword, newSalt);

      const masterRaw = await crypto.subtle.exportKey("raw", (keyManager as any).masterKey);
      const newPasswordWrapped = await aesEncrypt(newDerivedKey, new Uint8Array(masterRaw));
      const saltBase64 = btoa(String.fromCharCode(...newSalt));

      await apiClient.resetPassword({
        target: "email",
        value: email,
        verification_code: verifyCode,
        new_password_hash: newPasswordHash,
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

          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <input
              type="text"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              placeholder={t("settings.emailCodePlaceholder")}
              maxLength={6}
              style={{ flex: 1, padding: "0.5rem", border: "1px solid #ddd", borderRadius: 6, fontSize: "0.95rem", boxSizing: "border-box" }}
            />
            <SendCodeButton onClick={async () => {
              try {
                await handleSendVerifyCode();
                setToast({ message: t("settings.codeSent"), type: "success" });
              } catch (e: any) {
                setToast({ message: e.message || t("settings.sendFailed"), type: "error" });
                throw e;
              }
            }} disabled={!currentPassword} />
          </div>

          <PasswordInput
            label={t("settings.newPassword")}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t("settings.newPasswordPlaceholder")}
          />

          <button
            onClick={handleChangePassword}
            disabled={changing}
            style={{
              width: "100%", padding: "0.75rem",
              background: changing ? "#95a5a6" : "#0f3460", color: "#fff",
              border: "none", borderRadius: 8, fontSize: "0.95rem", fontWeight: 600,
              cursor: changing ? "not-allowed" : "pointer",
            }}
          >
            {changing ? t("common.changing") : t("settings.confirmChange")}
          </button>
        </section>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AppLayout>
  );
}
