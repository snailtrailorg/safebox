import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { apiClient } from "../../services/api";
import { keyChain } from "../../keychain/keyChain";
import { deriveAuthKey } from "../../crypto/kdf";
import { saveSession } from "../../db/sessionStore";

export function RecoveryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [passphrase, setMasterPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  // 冷却倒计时每秒刷新
  useEffect(() => {
    if (!cooldownUntil) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const handleInitiateRecovery = async () => {
    if (!email.trim()) {
      setToast({ message: t("auth.recovery.enterEmail"), type: "error" });
      return;
    }
    if (!mnemonic.trim()) {
      setToast({ message: t("auth.recovery.enterMnemonic"), type: "error" });
      return;
    }
    const words = mnemonic.trim().split(/\s+/).filter(Boolean);
    if (words.length !== 12) {
      setToast({ message: t("auth.recovery.mnemonicWordCount"), type: "error" });
      return;
    }
    if (!newPassword || newPassword.length < 12) {
      setToast({ message: t("auth.recovery.passwordMinLength"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      // 1. 新盐 + 新 authKey（供服务端写正式 auth 字段）
      const newSalt = new Uint8Array(32);
      crypto.getRandomValues(newSalt);
      const newAuthKeyHash = await deriveAuthKey(newPassword, newSalt);
      const saltBase64 = btoa(String.fromCharCode(...newSalt));

      // 2. 步骤1：验证助记词，拿 encrypted_user_key + mnemonic_salt + initiate_token
      const step1 = await apiClient.initiateRecovery({
        target: "email",
        value: email,
        mnemonic: mnemonic,
        new_local_password_hash: newAuthKeyHash,
        new_local_salt: saltBase64,
      });

      // 3. 用助记词派生 K 解 User Key + 用新本地密码重包 cached_K（一次派生）
      //    模型 D：K 不变、User Key 不变，只把 K 换用新本地密码派生的 localDerivedKey 包裹
      const rec = await keyChain.recoverAndRewrap(
        mnemonic, passphrase, step1.mnemonic_salt, step1.encrypted_user_key,
        newPassword, saltBase64,
      );
      if (!rec.ok || !rec.newCachedK) {
        throw new Error(t("auth.recovery.recoverFailed"));
      }

      // 4. 步骤2：confirm 写正式 authKey+local_salt+local_password_version，进冷却
      const step2 = await apiClient.confirmRecovery({
        initiate_token: step1.initiate_token,
      });

      // 5. 本地落库新盐 + 新 cached_K，冷却结束后用新密码可离线解锁
      await saveSession({ localSalt: saltBase64, cached_K: rec.newCachedK });

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
          {t("auth.recovery.mnemonicLabel")}
        </label>
        <textarea value={mnemonic} onChange={(e) => setMnemonic(e.target.value)}
          placeholder={t("auth.recovery.mnemonicPlaceholder")} rows={3}
          style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", fontFamily: "monospace", boxSizing: "border-box", resize: "vertical" }} />
      </div>
      <PasswordInput label={t("auth.recovery.passphraseLabel")} value={passphrase}
        onChange={(e) => setMasterPassword(e.target.value)} placeholder={t("auth.recovery.passphrasePlaceholder")} />
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