import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "../../components/layout/AppLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { useAuth } from "../../context/AuthContext";
import { useVault } from "../../context/VaultContext";
import { apiClient } from "../../services/api";
import { keyManager } from "../../services/keyManager";
import { getSession, saveSession } from "../../db/sessionStore";
import { deriveKeyHash, generateSalt, deriveKey } from "../../crypto/pbkdf2";
import { aesEncrypt } from "../../crypto/aes";
import { exportBackup, importBackup } from "../../utils/backup";

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { syncNow, isSyncing } = useVault();
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showChangePw, setShowChangePw] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [changing, setChanging] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleLogout = async () => {
    if (!confirm(t("settings.logoutConfirm"))) return;
    await logout();
    navigate("/login");
  };

  const handleSendVerifyCode = async () => {
    if (!currentPassword) {
      setToast({ message: t("settings.enterCurrentPassword"), type: "error" });
      return;
    }
    setSendingCode(true);
    try {
      const session = await getSession();

      const ok = await keyManager.unlockWithPassword(currentPassword, session.passwordSalt, session.passwordWrapped);
      if (!ok) {
        setToast({ message: t("settings.wrongPassword"), type: "error" });
        return;
      }

      const email = session.email || "";
      if (!email) {
        setToast({ message: t("settings.noEmail"), type: "error" });
        return;
      }
      await apiClient.sendCode({ target: "email", value: email });
      setCodeSent(true);
      setToast({ message: t("settings.codeSent"), type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || t("settings.sendFailed"), type: "error" });
    } finally {
      setSendingCode(false);
    }
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
      setShowChangePw(false);
      setCurrentPassword("");
      setNewPassword("");
      setVerifyCode("");
      setCodeSent(false);
    } catch (e: any) {
      setToast({ message: e.message || t("settings.changeFailed"), type: "error" });
    } finally {
      setChanging(false);
    }
  };

  const handleExport = async () => {
    const pw = prompt(t("settings.backupPasswordPrompt"));
    if (!pw) return;
    setExporting(true);
    try {
      await exportBackup(pw);
      setToast({ message: t("settings.backupDownloaded"), type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || t("settings.exportFailed"), type: "error" });
    } finally {
      setExporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const pw = prompt(t("settings.importPasswordPrompt"));
    if (!pw) return;
    setImporting(true);
    try {
      const count = await importBackup(pw, file);
      setToast({ message: t("settings.imported", { count }), type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || t("settings.importFailed"), type: "error" });
    } finally {
      setImporting(false);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <AppLayout title={t("settings.title")}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <section style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#333", marginBottom: "1rem" }}>{t("settings.security")}</h3>

          <div style={{
            width: "100%", padding: "0.75rem", marginBottom: "0.5rem",
            background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8,
            fontSize: "0.85rem", color: "#666", lineHeight: 1.6,
          }}>
            <p style={{ margin: 0, fontWeight: 500, color: "#333" }}>{t("settings.recoveryCode")}</p>
            <p style={{ margin: "0.25rem 0 0 0" }}>
              {t("settings.recoveryCodeNote")}
            </p>
          </div>

          <button
            onClick={() => setShowChangePw(!showChangePw)}
            style={{
              width: "100%", padding: "0.75rem", marginBottom: "0.5rem",
              background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8,
              cursor: "pointer", fontSize: "0.9rem", textAlign: "left",
            }}
          >
            {t("settings.changePassword")}
          </button>

          {showChangePw && (
            <div style={{ marginBottom: "0.5rem" }}>
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
                <button
                  onClick={handleSendVerifyCode}
                  disabled={sendingCode || codeSent}
                  style={{
                    padding: "0.5rem 0.75rem", background: codeSent ? "#27ae60" : "#3498db",
                    color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
                    fontSize: "0.85rem", whiteSpace: "nowrap",
                  }}
                >
                  {sendingCode ? t("common.sending") : codeSent ? t("common.sent") : t("auth.login.sendCode")}
                </button>
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
                  width: "100%", padding: "0.5rem",
                  background: changing ? "#95a5a6" : "#0f3460", color: "#fff",
                  border: "none", borderRadius: 6, fontSize: "0.9rem", fontWeight: 600,
                  cursor: changing ? "not-allowed" : "pointer",
                }}
              >
                {changing ? t("common.changing") : t("settings.confirmChange")}
              </button>
            </div>
          )}

          <button
            onClick={() => setToast({ message: t("settings.autoLockInfo"), type: "info" })}
            style={{
              width: "100%", padding: "0.75rem",
              background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8,
              cursor: "pointer", fontSize: "0.9rem", textAlign: "left",
            }}
          >
            {t("settings.autoLock")}
          </button>
        </section>

        <section style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#333", marginBottom: "1rem" }}>{t("settings.dataManagement")}</h3>

          <button
            onClick={syncNow}
            disabled={isSyncing}
            style={{
              width: "100%", padding: "0.75rem", marginBottom: "0.5rem",
              background: isSyncing ? "#e0e0e0" : "#f5f5f5",
              border: "1px solid #ddd", borderRadius: 8,
              cursor: isSyncing ? "not-allowed" : "pointer",
              fontSize: "0.9rem", textAlign: "left",
            }}
          >
            {isSyncing ? t("common.syncing") : t("settings.syncNow")}
          </button>

          <button
            onClick={handleExport}
            disabled={exporting}
            style={{
              width: "100%", padding: "0.75rem", marginBottom: "0.5rem",
              background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8,
              cursor: exporting ? "not-allowed" : "pointer", fontSize: "0.9rem", textAlign: "left",
            }}
          >
            {exporting ? t("common.exporting") : t("settings.exportBackup")}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".safebox"
            onChange={handleImportFile}
            style={{ display: "none" }}
          />
          <button
            onClick={handleImportClick}
            disabled={importing}
            style={{
              width: "100%", padding: "0.75rem",
              background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8,
              cursor: importing ? "not-allowed" : "pointer", fontSize: "0.9rem", textAlign: "left",
            }}
          >
            {importing ? t("common.importing") : t("settings.importBackup")}
          </button>
        </section>

        <section style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#333", marginBottom: "1rem" }}>{t("settings.account")}</h3>

          <button
            onClick={handleLogout}
            style={{
              width: "100%", padding: "0.75rem",
              background: "#fff", border: "1px solid #e74c3c", borderRadius: 8,
              color: "#e74c3c", cursor: "pointer", fontSize: "0.9rem",
            }}
          >
            {t("settings.logout")}
          </button>
        </section>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AppLayout>
  );
}
