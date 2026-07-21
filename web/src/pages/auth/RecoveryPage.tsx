/**
 * RecoveryPage - 换设备登录（SRP-6a + 合并主密码模型）
 *
 * 流程（对应 1Password 换设备）：
 * 1. GET /auth/salt -> srp_salt + local_salt + mnemonic_salt
 * 2. SRP 两步登录（助记词 + 主密码派生 x）-> token + encrypted_user_key + M2
 * 3. recoverAndRewrap：助记词 + 主密码派生 K -> 解 UserKey + 建本地缓存（cached_K + mnemonic_encrypted）
 *
 * SRP 的 x 含助记词，故 SRP 登录同时验主密码 + 助记词。
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { apiClient } from "../../services/api";
import { keyChain } from "../../keychain/keyChain";
import { saveSession } from "../../db/sessionStore";
import { useAuth } from "../../context/AuthContext";
import { bytesToHex } from "../../crypto/srp";
import { performSrpLogin } from "../../services/srpAuth";

export function RecoveryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const handleRecover = async () => {
    if (!email.trim()) {
      setToast({ message: t("auth.recovery.enterEmail"), type: "error" });
      return;
    }
    const words = mnemonic.trim().split(/\s+/).filter(Boolean);
    if (words.length !== 12) {
      setToast({ message: t("auth.recovery.mnemonicWordCount"), type: "error" });
      return;
    }
    if (!masterPassword) {
      setToast({ message: t("auth.recovery.enterPassword"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      // 1. 取 salt
      const salt = await apiClient.getSalt(email);

      // 2. SRP 两步登录（用输入的助记词 + 主密码派生 x；新设备无 device_id -> 建 UserDevice）
      const { resp, K } = await performSrpLogin("email", email, masterPassword, mnemonic, salt);

      // 3. 助记词 + 主密码派生 K -> 解 UserKey + 建本地缓存（换设备无 cached_K/mnemonic_encrypted）
      const rec = await keyChain.recoverAndRewrap(
        mnemonic, masterPassword, resp.mnemonic_salt, resp.encrypted_user_key, resp.local_salt,
      );
      if (!rec.ok || !rec.newCachedK || !rec.mnemonicEncrypted) {
        throw new Error(t("auth.recovery.recoverFailed"));
      }

      // 4. 落库 + 登录（device_id + session_K 建，cached_K + mnemonic_encrypted 重建）
      await saveSession({
        email,
        accessToken: resp.access_token,
        refreshToken: resp.refresh_token,
        serverUserId: resp.user_id,
        localSalt: resp.local_salt,
        encrypted_user_key: resp.encrypted_user_key,
        mnemonic_salt: resp.mnemonic_salt,
        cached_K: rec.newCachedK,
        mnemonic_encrypted: rec.mnemonicEncrypted,
        device_id: resp.device_id,
        session_K: bytesToHex(K),
      });
      login(resp.access_token, resp.refresh_token, resp.user_id);
      navigate("/");
    } catch (e: any) {
      setToast({ message: e.message || t("auth.recovery.recoverFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={t("auth.recovery.title")} subtitle={t("auth.recovery.subtitle")}>
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
          {t("auth.recovery.mnemonicLabel")}
        </label>
        <textarea value={mnemonic} onChange={(e) => setMnemonic(e.target.value)}
          placeholder={t("auth.recovery.mnemonicPlaceholder")} rows={3}
          style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", fontFamily: "monospace", boxSizing: "border-box", resize: "vertical" }} />
      </div>
      <PasswordInput label={t("auth.recovery.masterPasswordLabel")} value={masterPassword}
        onChange={(e) => setMasterPassword(e.target.value)} placeholder={t("auth.recovery.masterPasswordPlaceholder")} />
      <p style={{ fontSize: "0.75rem", color: "#999", marginTop: "0.4rem", lineHeight: 1.4 }}>
        {t("auth.recovery.hint")}
      </p>
      <button onClick={handleRecover} disabled={loading}
        style={{ width: "100%", padding: "0.75rem", marginTop: "0.75rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
        {loading ? t("common.loading") : t("auth.recovery.recoverBtn")}
      </button>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}
