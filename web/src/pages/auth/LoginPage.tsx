import { useState, useEffect, useRef } from "react";
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
import {
  generatePrivateEphemeral, computeClientPublic, computeU, computeClientS,
  computeK, computeM1, verifyM2, deriveX,
  bigIntToHex, hexToBigInt, hexToBytes, bytesToHex,
} from "../../crypto/srp";
import { GOOGLE_CLIENT_ID } from "../../config/constants";
import type { LoginResponse } from "../../types/api";

type LoginTab = "email" | "phone" | "google";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (el: HTMLElement, config: Record<string, unknown>) => void;
          prompt: (callback?: (n: { isNotDisplayed: () => boolean }) => void) => void;
        };
      };
    };
  }
}

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

  const [googlePassword, setGooglePassword] = useState("");
  const [googleIdToken, setGoogleIdToken] = useState("");
  const [googleAuthed, setGoogleAuthed] = useState(false);
  const googleInitRef = useRef(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleTimeout, setGoogleTimeout] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  // ── Google SDK 初始化（只执行一次，面板始终在 DOM 中）──
  useEffect(() => {
    if (googleInitRef.current || !GOOGLE_CLIENT_ID) return;
    const timer = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(timer);
        googleInitRef.current = true;
        setGoogleReady(true);
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (resp: { credential: string }) => {
            setGoogleIdToken(resp.credential);
            setGoogleAuthed(true);
            setToast({ message: t("auth.login.googleSuccess"), type: "success" });
          },
        });
      }
    }, 200);
    const timeout = setTimeout(() => setGoogleTimeout(true), 15000);
    return () => { clearInterval(timer); clearTimeout(timeout); };
  }, []);

  // SDK 就绪 + 面板可见时渲染按钮
  useEffect(() => {
    if (googleBtnRef.current && googleReady) {
      window.google?.accounts.id.renderButton(googleBtnRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
        width: 300,
      });
    }
  }, [googleReady]);

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
  const srpLogin = async (targetType: "email" | "phone", target: string, pw: string) => {
    // 1. 拿 srp_salt/local_salt
    const salt = targetType === "email"
      ? await apiClient.getSalt(target)
      : await apiClient.getSalt(undefined, target);
    // 2. 从本地缓存解出 mnemonic（同设备登录算 SRP x 用）
    const session = await getSession();
    if (!session.mnemonic_encrypted || !session.cached_K) {
      throw new Error(t("auth.login.needRecovery"));
    }
    const mnemonic = await keyChain.getMnemonicFromCache(pw, salt.local_salt, session.mnemonic_encrypted);
    if (!mnemonic) {
      throw new Error(t("auth.login.unlockFailed"));
    }
    // 3. challenge: A -> B
    const a = generatePrivateEphemeral();
    const A = computeClientPublic(a);
    const chal = await apiClient.loginSrpChallenge({
      target_type: targetType, target, A: bigIntToHex(A),
    });
    const B = hexToBigInt(chal.B);
    // 4. 算 x/S/K/M1
    const x = await deriveX(pw, mnemonic, hexToBytes(salt.srp_salt), target);
    const u = await computeU(A, B);
    const S = await computeClientS(B, a, u, x);
    const K = await computeK(S);
    const M1 = await computeM1(A, B, K);
    // 5. verify: M1 -> M2 + token
    const resp = await apiClient.loginSrpVerify({ session_id: chal.session_id, M1: bytesToHex(M1) });
    // 6. 验证服务端 M2
    if (!await verifyM2(A, M1, K, resp.M2)) {
      throw new Error(t("auth.login.loginFailed"));
    }
    return resp;
  };

  const handleEmailLogin = async () => {
    if (!email || !password) {
      setToast({ message: t("auth.login.fillEmailAndPassword"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      const response = await srpLogin("email", email, password);
      await saveSession({
        email,
        localSalt: response.local_salt,
        encrypted_user_key: response.encrypted_user_key,
        mnemonic_salt: response.mnemonic_salt,
        // cached_K / mnemonic_encrypted 保留（merge）
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
      const response = await srpLogin("phone", phone, phonePassword);
      await saveSession({
        email: phone,
        localSalt: response.local_salt,
        encrypted_user_key: response.encrypted_user_key,
        mnemonic_salt: response.mnemonic_salt,
      });
      await handleLoginResponse(response, phonePassword);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : t("auth.login.loginFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleGooglePasswordLogin = async () => {
    if (!googlePassword) {
      setToast({ message: t("auth.login.enterPassword"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      const response = await apiClient.loginGoogle({ google_id_token: googleIdToken });
      await saveSession({
        email: "google",
        localSalt: response.local_salt,
        encrypted_user_key: response.encrypted_user_key,
        mnemonic_salt: response.mnemonic_salt,
      });
      await handleLoginResponse(response, googlePassword);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : t("auth.login.loginFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const tabs: { key: LoginTab; label: string }[] = [
    { key: "email", label: t("auth.login.emailTab") },
    { key: "phone", label: t("auth.login.phoneTab") },
    { key: "google", label: t("auth.login.googleTab") },
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

      {/* Google tab - 始终在 DOM 中，只隐藏不销毁 */}
      <div style={{ display: tab === "google" ? "block" : "none" }}>
        {!googleAuthed ? (
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "1rem" }}>
              {t("auth.login.googleDesc")}
            </p>
            {!googleReady ? (
              <div style={{ padding: "0.75rem", color: "#999", fontSize: "0.85rem" }}>
                {googleTimeout ? t("auth.login.googleTimeout") : t("auth.login.googleLoading")}
              </div>
            ) : (
              <div ref={googleBtnRef} style={{ display: "flex", justifyContent: "center" }} />
            )}
            {!GOOGLE_CLIENT_ID && (
              <p style={{ fontSize: "0.8rem", color: "#e74c3c", marginTop: "0.75rem" }}>
                {t("auth.login.googleNotConfigured")}
              </p>
            )}
          </div>
        ) : (
          <>
            <div style={{ marginBottom: "1rem", padding: "0.5rem 0.75rem", background: "#f0fff0", borderRadius: 8, border: "1px solid #27ae60", fontSize: "0.85rem", color: "#27ae60", textAlign: "center" }}>
              {t("auth.login.googleVerified")}
            </div>
            <PasswordInput label={t("auth.login.passwordLabel")} value={googlePassword} onChange={(e) => setGooglePassword(e.target.value)} placeholder={t("auth.login.googlePasswordPlaceholder")} />
            <button onClick={handleGooglePasswordLogin} disabled={loading}
              style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? t("common.loggingIn") : t("auth.login.submitBtn")}
            </button>
          </>
        )}
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
