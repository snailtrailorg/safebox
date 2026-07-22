import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { SendCodeButton } from "../../components/ui/SendCodeButton";
import { apiClient } from "../../services/api";
import { keyChain } from "../../keychain/keyChain";
import { useAuth } from "../../context/AuthContext";
import { saveSession, getSession } from "../../db/sessionStore";
import { bytesToHex } from "../../crypto/srp";
import { performSrpLogin } from "../../services/srpAuth";
import type { LoginResponse } from "../../types/api";

type LoginTab = "email" | "phone";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [tab, setTab] = useState<LoginTab>("email");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [phone, setPhone] = useState("");
  const [phonePassword, setPhonePassword] = useState("");
  const [code, setCode] = useState("");

  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  // ── 通用登录响应处理 ─────────────────────────────
  const handleLoginResponse = async (response: LoginResponse, pw: string) => {
    // cached_K 在本地 session（注册时存），不在服务器响应里
    const session = await getSession();
    const ok = await keyChain.unlockWithPassword(
      pw, response.local_salt || "", response.encrypted_user_key, session.cached_K || "");
    if (!ok) {
      setToast({ message: t("auth.login.unlockFailed"), type: "error" });
      return;
    }
    await login(response.access_token, response.refresh_token, response.user_id || "");
    navigate("/");
  };

  // ── SRP 两步登录（email/phone 共用）─────────────────
  const srpLogin = async (targetType: "email" | "phone", target: string, pw: string): Promise<{ resp: LoginResponse; K: Uint8Array }> => {
    // 1. 拿 srp_salt/local_salt
    const salt = targetType === "email"
      ? await apiClient.getSalt(target)
      : await apiClient.getSalt(undefined, target);
    // 2. 从本地缓存解出 mnemonic（同设备登录算 SRP x 用）；无缓存（logout 后/换设备）-> 引导 RecoveryPage
    const session = await getSession();
    if (!session.mnemonic_encrypted || !session.cached_K) {
      throw new Error(t("auth.login.needRecovery"));
    }
    const mnemonic = await keyChain.getMnemonicFromCache(pw, salt.local_salt, session.mnemonic_encrypted);
    if (!mnemonic) {
      throw new Error(t("auth.login.unlockFailed"));
    }
    // 3. SRP challenge + verify + 派生 K（同设备传 device_id，新设备传 device_name 建 UserDevice）
    return performSrpLogin(targetType, target, pw, mnemonic, salt, session.device_id);
  };

  const handleEmailLogin = async () => {
    if (!email || !password) {
      setToast({ message: t("auth.login.fillEmailAndPassword"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      const { resp: response, K } = await srpLogin("email", email, password);
      await saveSession({
        email,
        localSalt: response.local_salt,
        encrypted_user_key: response.encrypted_user_key,
        mnemonic_salt: response.mnemonic_salt,
        device_id: response.device_id,
        session_K: bytesToHex(K),
        // cached_K / mnemonic_encrypted 保留（merge，同设备登录用）
      });
      await handleLoginResponse(response, password);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : t("auth.login.loginFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    if (!phone) return;
    await apiClient.sendCode({ target: "phone", value: phone });
    setToast({ message: t("auth.login.codeSent"), type: "success" });
  };

  const handlePhoneLogin = async () => {
    if (!phone || !code || !phonePassword) {
      setToast({ message: t("auth.login.fillAll"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      const { resp: response, K } = await srpLogin("phone", phone, phonePassword);
      await saveSession({
        email: phone,
        localSalt: response.local_salt,
        encrypted_user_key: response.encrypted_user_key,
        mnemonic_salt: response.mnemonic_salt,
        device_id: response.device_id,
        session_K: bytesToHex(K),
      });
      await handleLoginResponse(response, phonePassword);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : t("auth.login.loginFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const tabs: { key: LoginTab; label: string }[] = [
    { key: "email", label: t("auth.login.emailTab") },
    { key: "phone", label: t("auth.login.phoneTab") },
  ];

  return (
    <AuthLayout title={t("auth.login.title")} subtitle={t("app.tagline")}>
      <div style={{ display: "flex", marginBottom: "1.5rem", borderRadius: 8, overflow: "hidden", border: "1px solid #ddd" }}>
        {tabs.map((tk) => (
          <button
            key={tk.key}
            onClick={() => setTab(tk.key)}
            style={{
              flex: 1, padding: "0.5rem", border: "none",
              background: tab === tk.key ? "#0f3460" : "#f5f5f5",
              color: tab === tk.key ? "#fff" : "#333",
              cursor: "pointer", fontSize: "0.85rem", fontWeight: 500,
            }}
          >
            {tk.label}
          </button>
        ))}
      </div>

      {/* Email tab */}
      <div style={{ display: tab === "email" ? "block" : "none" }}>
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.login.emailLabel")}</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.login.emailPlaceholder")}
            style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
        </div>
        <PasswordInput label={t("auth.login.passwordLabel")} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.login.passwordPlaceholder")} />
        <button onClick={handleEmailLogin} disabled={loading} style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? t("common.loggingIn") : t("auth.login.submitBtn")}
        </button>
      </div>

      {/* Phone tab */}
      <div style={{ display: tab === "phone" ? "block" : "none" }}>
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.login.phoneLabel")}</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("auth.login.phonePlaceholder")}
              style={{ flex: 1, padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
            <SendCodeButton onClick={handleSendCode} disabled={!phone} />
          </div>
        </div>
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.login.codeLabel")}</label>
          <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("auth.login.codePlaceholder")} maxLength={6}
            style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
        </div>
        <PasswordInput label={t("auth.login.passwordLabel")} value={phonePassword} onChange={(e) => setPhonePassword(e.target.value)} placeholder={t("auth.login.passwordPlaceholder")} />
        <button onClick={handlePhoneLogin} disabled={loading} style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? t("common.loggingIn") : t("auth.login.submitBtn")}
        </button>
      </div>

      <div style={{ marginTop: "1.5rem", textAlign: "center", fontSize: "0.85rem", color: "#666" }}>
        <Link to="/register" style={{ color: "#0f3460", textDecoration: "none", fontWeight: 500 }}>{t("auth.login.registerLink")}</Link>
        <span style={{ margin: "0 0.75rem" }}>|</span>
        <Link to="/recovery" style={{ color: "#0f3460", textDecoration: "none", fontWeight: 500 }}>{t("auth.login.recoveryLink")}</Link>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}
