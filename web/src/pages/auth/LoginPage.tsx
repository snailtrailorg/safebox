import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { apiClient } from "../../services/api";
import { keyManager } from "../../services/keyManager";
import { useAuth } from "../../context/AuthContext";
import { saveSession } from "../../db/sessionStore";
import { deriveKeyHash } from "../../crypto/pbkdf2";
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

  // Email
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Phone
  const [phone, setPhone] = useState("");
  const [phonePassword, setPhonePassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  // Google
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

  // ── Google SDK 初始化 ────────────────────────────
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

  // 切到 Google tab 或 SDK 就绪时渲染按钮
  useEffect(() => {
    if (tab === "google" && googleBtnRef.current && googleReady) {
      window.google?.accounts.id.renderButton(googleBtnRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
        width: 300,
      });
    }
  }, [tab, googleReady]);

  // ── 通用登录响应处理 ─────────────────────────────
  const handleLoginResponse = async (response: LoginResponse, pw: string) => {
    const actualSalt = response.password_salt || "";
    const ok = await keyManager.unlockWithPassword(pw, actualSalt, response.password_wrapped ?? "");
    if (!ok) {
      setToast({ message: t("auth.login.unlockFailed"), type: "error" });
      return;
    }
    const rsaLoaded = await keyManager.loadRsaKeys(
      response.encrypted_private,
      response.rsa_public_key,
    );
    if (!rsaLoaded) {
      setToast({ message: t("auth.login.rsaFailed"), type: "error" });
      return;
    }
    await login(response.access_token, response.refresh_token, "");
    navigate("/");
  };

  // ── Email 登录 ──────────────────────────────────

  const handleEmailLogin = async () => {
    if (!email || !password) {
      setToast({ message: t("auth.login.fillEmailAndPassword"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      const { password_salt: salt } = await apiClient.getSalt(email);
      const saltBytes = new Uint8Array(atob(salt).split("").map(c => c.charCodeAt(0)));
      const passwordHash = await deriveKeyHash(password, saltBytes);
      const response = await apiClient.loginEmail({ email, password_hash: passwordHash });

      await saveSession({
        email,
        passwordSalt: response.password_salt,
        passwordWrapped: response.password_wrapped ?? "",
        recoveryWrapped: response.recovery_wrapped,
        encryptedPrivate: response.encrypted_private,
        rsaPublicKey: response.rsa_public_key,
      });

      await handleLoginResponse(response, password);
    } catch (e: any) {
      setToast({ message: e.message || t("auth.login.loginFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // ── 手机登录 ─────────────────────────────────────

  const handleSendCode = async () => {
    if (!phone) return;
    setSendingCode(true);
    try {
      await apiClient.sendCode({ target: "phone", value: phone });
      setCodeSent(true);
      setToast({ message: t("auth.login.codeSent"), type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || t("auth.login.sendFailed"), type: "error" });
    } finally {
      setSendingCode(false);
    }
  };

  const handlePhoneLogin = async () => {
    if (!phone || !code || !phonePassword) {
      setToast({ message: t("auth.login.fillAll"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      const { password_salt: salt } = await apiClient.getSalt(undefined, phone);
      const saltBytes = new Uint8Array(atob(salt).split("").map(c => c.charCodeAt(0)));
      const passwordHash = await deriveKeyHash(phonePassword, saltBytes);
      const response = await apiClient.loginPhone({ phone, verification_code: code, password_hash: passwordHash });
      await saveSession({
        email: phone,
        passwordSalt: response.password_salt,
        passwordWrapped: response.password_wrapped ?? "",
        recoveryWrapped: response.recovery_wrapped,
        encryptedPrivate: response.encrypted_private,
        rsaPublicKey: response.rsa_public_key,
      });
      await handleLoginResponse(response, phonePassword);
    } catch (e: any) {
      setToast({ message: e.message || t("auth.login.loginFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // ── Google 登录 ──────────────────────────────────

  const handleGooglePasswordLogin = async () => {
    if (!googlePassword) {
      setToast({ message: t("auth.login.enterPassword"), type: "error" });
      return;
    }
    setLoading(true);
    try {
      const response = await apiClient.loginGoogle({ google_id_token: googleIdToken });
      // Google 登录不传 password_hash 到后端，后端只验证 id_token
      // 但客户端仍需要用密码解锁 masterKey
      await saveSession({
        email: "google",
        passwordSalt: response.password_salt,
        passwordWrapped: response.password_wrapped ?? "",
        recoveryWrapped: response.recovery_wrapped,
        encryptedPrivate: response.encrypted_private,
        rsaPublicKey: response.rsa_public_key,
      });
      await handleLoginResponse(response, googlePassword);
    } catch (e: any) {
      setToast({ message: e.message || t("auth.login.loginFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // ── Tab 标签 ─────────────────────────────────────
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

      {tab === "email" ? (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.login.emailLabel")}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.login.emailPlaceholder")}
              style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
          </div>
          <PasswordInput label={t("auth.login.passwordLabel")} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.login.passwordPlaceholder")} />
          <button onClick={handleEmailLogin} disabled={loading} style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? t("common.loggingIn") : t("auth.login.submitBtn")}
          </button>
        </>
      ) : tab === "phone" ? (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.login.phoneLabel")}</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("auth.login.phonePlaceholder")}
                style={{ flex: 1, padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
              <button onClick={handleSendCode} disabled={sendingCode || !phone}
                style={{ padding: "0.6rem 1rem", background: codeSent ? "#27ae60" : "#3498db", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem", whiteSpace: "nowrap" }}>
                {sendingCode ? t("common.sending") : codeSent ? t("common.sent") : t("auth.login.sendCode")}
              </button>
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
        </>
      ) : (
        <>
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
        </>
      )}

      <div style={{ marginTop: "1.5rem", textAlign: "center", fontSize: "0.85rem", color: "#666" }}>
        <Link to="/register" style={{ color: "#0f3460", textDecoration: "none", fontWeight: 500 }}>{t("auth.login.registerLink")}</Link>
        <span style={{ margin: "0 0.75rem" }}>|</span>
        <Link to="/recovery" style={{ color: "#0f3460", textDecoration: "none", fontWeight: 500 }}>{t("auth.login.recoveryLink")}</Link>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}
