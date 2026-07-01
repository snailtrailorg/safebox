import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { apiClient } from "../../services/api";
import { keyManager } from "../../services/keyManager";
import { saveSession } from "../../db/sessionStore";
import { GOOGLE_CLIENT_ID } from "../../config/constants";

type RegisterTab = "email" | "phone" | "google";

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

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<RegisterTab>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const [googleIdToken, setGoogleIdToken] = useState("");
  const [googleAuthed, setGoogleAuthed] = useState(false);
  const googleInitRef = useRef(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleTimeout, setGoogleTimeout] = useState(false);

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
            setToast({ message: t("auth.register.googleSuccess"), type: "success" });
          },
        });
      }
    }, 200);
    const timeout = setTimeout(() => setGoogleTimeout(true), 15000);
    return () => { clearInterval(timer); clearTimeout(timeout); };
  }, []);

  // SDK 就绪时渲染按钮（面板始终在 DOM 中）
  useEffect(() => {
    if (googleBtnRef.current && googleReady) {
      window.google?.accounts.id.renderButton(googleBtnRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signup_with",
        shape: "rectangular",
        width: 300,
      });
    }
  }, [googleReady]);

  const handleRegister = async () => {
    if (tab === "email" && (!email || !code || !password)) {
      setToast({ message: t("auth.register.fillAllFields"), type: "error" });
      return;
    }
    if (tab === "phone" && (!phone || !code || !password)) {
      setToast({ message: t("auth.register.fillAll"), type: "error" });
      return;
    }
    if (tab === "google" && (!googleIdToken || !password)) {
      setToast({ message: t("auth.register.fillGoogleAndPassword"), type: "error" });
      return;
    }

    setLoading(true);
    try {
      const keys = await keyManager.generateKeys(password);

      if (tab === "email") {
        const response = await apiClient.registerEmail({
          email, verification_code: code,
          password_hash: keys.passwordHash, password_salt: keys.passwordSalt,
          password_wrapped: keys.passwordWrapped, recovery_wrapped: keys.recoveryWrapped,
          encrypted_private: keys.encryptedPrivate, rsa_public_key: keys.rsaPublicKey,
          device_name: "Web Browser", device_public_key: "web", device_wrapped: "web",
        });
        await saveSession({
          email, passwordSalt: keys.passwordSalt, passwordWrapped: keys.passwordWrapped,
          recoveryWrapped: keys.recoveryWrapped, encryptedPrivate: keys.encryptedPrivate,
          rsaPublicKey: keys.rsaPublicKey,
        });
      } else if (tab === "phone") {
        const response = await apiClient.registerPhone({
          phone, verification_code: code,
          password_hash: keys.passwordHash, password_salt: keys.passwordSalt,
          password_wrapped: keys.passwordWrapped, recovery_wrapped: keys.recoveryWrapped,
          encrypted_private: keys.encryptedPrivate, rsa_public_key: keys.rsaPublicKey,
        } as any);
        await saveSession({
          email: phone, passwordSalt: keys.passwordSalt, passwordWrapped: keys.passwordWrapped,
          recoveryWrapped: keys.recoveryWrapped, encryptedPrivate: keys.encryptedPrivate,
          rsaPublicKey: keys.rsaPublicKey,
        });
      } else {
        const response = await apiClient.registerGoogle({
          google_id_token: googleIdToken,
          password_hash: keys.passwordHash, password_salt: keys.passwordSalt,
          password_wrapped: keys.passwordWrapped, recovery_wrapped: keys.recoveryWrapped,
          encrypted_private: keys.encryptedPrivate, rsa_public_key: keys.rsaPublicKey,
          device_name: "Web Browser", device_public_key: "web", device_wrapped: "web",
        });
        await saveSession({
          email: "google", passwordSalt: keys.passwordSalt, passwordWrapped: keys.passwordWrapped,
          recoveryWrapped: keys.recoveryWrapped, encryptedPrivate: keys.encryptedPrivate,
          rsaPublicKey: keys.rsaPublicKey,
        });
      }

      navigate("/register/recovery");
    } catch (e: any) {
      setToast({ message: e.message || t("auth.register.registerFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async (target: "email" | "phone") => {
    const value = target === "email" ? email : phone;
    if (!value) return;
    setSendingCode(true);
    try {
      await apiClient.sendCode({ target, value });
      setCodeSent(true);
      setToast({ message: t("auth.register.codeSent"), type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || t("auth.register.sendFailed"), type: "error" });
    } finally {
      setSendingCode(false);
    }
  };

  const tabs: { key: RegisterTab; label: string }[] = [
    { key: "email", label: t("auth.register.emailTab") },
    { key: "phone", label: t("auth.register.phoneTab") },
    { key: "google", label: t("auth.register.googleTab") },
  ];

  return (
    <AuthLayout title={t("auth.register.title")} subtitle={t("app.createAccount")}>
      <div style={{ display: "flex", marginBottom: "1.5rem", borderRadius: 8, overflow: "hidden", border: "1px solid #ddd" }}>
        {tabs.map((tk) => (
          <button key={tk.key} onClick={() => setTab(tk.key)}
            style={{ flex: 1, padding: "0.5rem", border: "none", background: tab === tk.key ? "#0f3460" : "#f5f5f5", color: tab === tk.key ? "#fff" : "#333", cursor: "pointer", fontSize: "0.85rem", fontWeight: 500 }}>
            {tk.label}
          </button>
        ))}
      </div>

      {/* Email tab */}
      <div style={{ display: tab === "email" ? "block" : "none" }}>
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.register.emailLabel")}</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.register.emailPlaceholder")}
              style={{ flex: 1, padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
            <button onClick={() => handleSendCode("email")} disabled={sendingCode || !email}
              style={{ padding: "0.6rem 1rem", background: codeSent ? "#27ae60" : "#3498db", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem", whiteSpace: "nowrap" }}>
              {sendingCode ? t("common.sending") : codeSent ? t("common.sent") : t("auth.register.sendCode")}
            </button>
          </div>
        </div>
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.register.codeLabel")}</label>
          <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("auth.register.codePlaceholder")} maxLength={6}
            style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
        </div>
        <PasswordInput label={t("auth.register.passwordLabel")} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.register.passwordPlaceholder")} />
      </div>

      {/* Phone tab */}
      <div style={{ display: tab === "phone" ? "block" : "none" }}>
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.register.phoneLabel")}</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("auth.register.phonePlaceholder")}
              style={{ flex: 1, padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
            <button onClick={() => handleSendCode("phone")} disabled={sendingCode || !phone}
              style={{ padding: "0.6rem 1rem", background: codeSent ? "#27ae60" : "#3498db", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem", whiteSpace: "nowrap" }}>
              {sendingCode ? t("common.sending") : codeSent ? t("common.sent") : t("auth.register.sendCode")}
            </button>
          </div>
        </div>
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>{t("auth.register.codeLabel")}</label>
          <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("auth.register.codePlaceholder")} maxLength={6}
            style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
        </div>
        <PasswordInput label={t("auth.register.passwordLabel")} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.register.passwordPlaceholder")} />
      </div>

      {/* Google tab — 始终在 DOM 中，只隐藏不销毁 */}
      <div style={{ display: tab === "google" ? "block" : "none" }}>
        {!googleAuthed ? (
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "1rem" }}>
              {t("auth.register.googleDesc")}
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
                {t("auth.register.googleNotConfigured")}
              </p>
            )}
          </div>
        ) : (
          <>
            <div style={{ marginBottom: "1rem", padding: "0.5rem 0.75rem", background: "#f0fff0", borderRadius: 8, border: "1px solid #27ae60", fontSize: "0.85rem", color: "#27ae60", textAlign: "center" }}>
              {t("auth.register.googleVerified")}
            </div>
            <PasswordInput label={t("auth.register.passwordLabel")} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.register.passwordPlaceholder")} />
          </>
        )}
      </div>

      <button onClick={handleRegister} disabled={loading}
        style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
        {loading ? t("common.registering") : t("auth.register.submitBtn")}
      </button>

      <div style={{ marginTop: "1.5rem", textAlign: "center", fontSize: "0.85rem", color: "#666" }}>
        {t("auth.register.hasAccount")}
        <Link to="/login" style={{ color: "#0f3460", textDecoration: "none", fontWeight: 500 }}>{t("auth.register.loginLink")}</Link>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}
