/**
 * ChangePasswordPage - 修改密码（fresh SRP token + 验证码 + 新 SRP 材料）
 *
 * email/phone 用户：先用旧密码走 SRP 登录拿 fresh token，再改密。
 * Google 用户：用当前 token（OAuth 登录无 SRP 路径）。
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "../../components/layout/AppLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { SendCodeButton } from "../../components/ui/SendCodeButton";
import { apiClient } from "../../services/api";
import { keyChain } from "../../keychain/keyChain";
import { getSession, saveSession } from "../../db/sessionStore";
import { bytesToHex } from "../../crypto/srp";
import { performSrpLogin } from "../../services/srpAuth";
import { checkPasswordStrength } from "../../config/constants";

export function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [changing, setChanging] = useState(false);

  const handleSendVerifyCode = async () => {
    const session = await getSession();
    const ok = await keyChain.unlockWithPassword(currentPassword, session.localSalt, session.encrypted_user_key, session.cached_K);
    if (!ok) throw new Error("wrong password");
    const contact = session.email || "";
    if (!contact || contact === "google") throw new Error("no contact");
    await apiClient.sendCode({ target: contact.includes("@") ? "email" : "phone", value: contact });
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !verifyCode || !mnemonic.trim()) {
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
      const contact = session.email || "";
      const isGoogle = contact === "google";
      const targetType = contact.includes("@") ? "email" : "phone";
      const identifier = contact;

      // 1. 用当前主密码解锁（载入 UserKey 到内存，changeMasterPassword 需要）
      const unlocked = await keyChain.unlockWithPassword(
        currentPassword, session.localSalt, session.encrypted_user_key, session.cached_K,
      );
      if (!unlocked) {
        setToast({ message: t("settings.currentPasswordWrong"), type: "error" });
        return;
      }

      // 2. fresh token（email/phone: SRP 登录验旧密码；Google: 用当前 token）
      if (!isGoogle) {
        const salt = targetType === "email"
          ? await apiClient.getSalt(contact)
          : await apiClient.getSalt(undefined, contact);
        // 同设备传 device_id（验未 revoked）；fresh SRP 建 K 续用（改密不重握手，session_K 保留直到重登）
        const { resp, K } = await performSrpLogin(targetType, contact, currentPassword, mnemonic, salt, session.device_id);
        await saveSession({ accessToken: resp.access_token, refreshToken: resp.refresh_token, session_K: bytesToHex(K) });
      }

      // 3. 新盐 + 助记词+新主密码重派生 K + 重包裹 encrypted_user_key + 新 SRP verifier
      const newSalt = new Uint8Array(32);
      crypto.getRandomValues(newSalt);
      const saltBase64 = btoa(String.fromCharCode(...newSalt));

      const { new_encrypted_user_key, new_cached_K, new_srp_verifier, new_srp_salt, new_mnemonic_encrypted } =
        await keyChain.changeMasterPassword(mnemonic, identifier, session.mnemonic_salt, newPassword, saltBase64);

      // 4. 提交（服务端验 fresh token + 验证码，写新 verifier/salt/encrypted_user_key）
      const resp = await apiClient.changePassword({
        target: targetType,
        value: contact,
        verification_code: verifyCode,
        new_srp_verifier,
        new_srp_salt,
        new_local_salt: saltBase64,
        new_encrypted_user_key,
      });

      // 5. 本地落库：新盐 + 新 cached_K + 新 encrypted_user_key + 新 mnemonic_encrypted + 新 token
      await saveSession({
        localSalt: saltBase64,
        cached_K: new_cached_K,
        encrypted_user_key: new_encrypted_user_key,
        mnemonic_encrypted: new_mnemonic_encrypted,
        ...(resp.access_token && resp.refresh_token
          ? { accessToken: resp.access_token, refreshToken: resp.refresh_token }
          : {}),
      });

      setToast({ message: t("settings.passwordChanged"), type: "success" });
      setCurrentPassword("");
      setNewPassword("");
      setVerifyCode("");
      setMnemonic("");
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
          <div style={{ marginTop: "0.5rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>
              {t("settings.mnemonicLabel")}
            </label>
            <textarea value={mnemonic} onChange={(e) => setMnemonic(e.target.value)}
              placeholder={t("settings.mnemonicPlaceholder")} rows={3}
              style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", fontFamily: "monospace", boxSizing: "border-box", resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", marginTop: "0.5rem" }}>
            <input
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              placeholder={t("settings.verifyCodePlaceholder")}
              maxLength={6}
              style={{ flex: 1, padding: "0.6rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem" }}
            />
            <SendCodeButton onClick={handleSendVerifyCode} onError={(e: any) => setToast({ message: e instanceof Error ? e.message : t("settings.sendFailed"), type: "error" })} />
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
