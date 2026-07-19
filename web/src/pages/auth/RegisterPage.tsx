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
import { saveSession } from "../../db/sessionStore";
import { GOOGLE_CLIENT_ID, checkPasswordStrength } from "../../config/constants";
import { generateMnemonic } from "../../crypto/bip39";

function generateMnemonicSalt(): string {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("");
}

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
  const { login } = useAuth();
  const [tab, setTab] = useState<RegisterTab>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passphrase, setMasterPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const [googleIdToken, setGoogleIdToken] = useState("");
  const [googleAuthed, setGoogleAuthed] = useState(false);
  const googleInitRef = useRef(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleTimeout, setGoogleTimeout] = useState(false);
  const [mnemonic, setMnemonic] = useState("");
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [pendingTokens, setPendingTokens] = useState<{ access_token: string; refresh_token: string; user_id: string } | null>(null);

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

    const pwCheck = checkPasswordStrength(password);
    if (!pwCheck.ok) {
      setToast({ message: pwCheck.reason || t("auth.register.passwordTooWeak"), type: "error" });
      return;
    }

    setLoading(true);
    try {
      // 生成助记词（BIP39 12 词）+ salt，用于派生 K
      const mnemonic = generateMnemonic();
      const mnemonicHmacSalt = generateMnemonicSalt();
      const keys = await keyChain.generateKeys(mnemonic, passphrase, password);
      let tokens: { access_token: string; refresh_token: string; user_id: string } | null = null;
      if (tab === "email") {
        const response = await apiClient.registerEmail({
          email, verification_code: code,
          local_password_hash: keys.localPasswordHash, local_salt: keys.localSalt,
          encrypted_user_key: keys.encrypted_user_key,
          kdf_settings: keys.kdfSettings,
          mnemonic_salt: keys.mnemonic_salt, mnemonic: mnemonic, mnemonic_hmac_salt: mnemonicHmacSalt,
          device_name: "Web Browser", device_public_key: "web", device_wrapped: "web",
        });
        tokens = response;
        await saveSession({
          email, localSalt: keys.localSalt, encrypted_user_key: keys.encrypted_user_key,
          mnemonic_salt: keys.mnemonic_salt, cached_K: keys.cached_K,
          has_passphrase: !!passphrase, local_password_version: 0,
        });
      } else if (tab === "phone") {
        const response = await apiClient.registerPhone({
          phone, verification_code: code,
          local_password_hash: keys.localPasswordHash, local_salt: keys.localSalt,
          encrypted_user_key: keys.encrypted_user_key,
          kdf_settings: keys.kdfSettings,
          mnemonic_salt: keys.mnemonic_salt, mnemonic: mnemonic, mnemonic_hmac_salt: mnemonicHmacSalt,
          device_name: "Web Browser", device_public_key: "web", device_wrapped: "web",
        });
        tokens = response;
        await saveSession({
          email: phone, localSalt: keys.localSalt, encrypted_user_key: keys.encrypted_user_key,
          mnemonic_salt: keys.mnemonic_salt, cached_K: keys.cached_K,
          has_passphrase: !!passphrase, local_password_version: 0,
        });
      } else {
        const response = await apiClient.registerGoogle({
          google_id_token: googleIdToken,
          local_password_hash: keys.localPasswordHash, local_salt: keys.localSalt,
          encrypted_user_key: keys.encrypted_user_key,
          kdf_settings: keys.kdfSettings,
          mnemonic_salt: keys.mnemonic_salt, mnemonic: mnemonic, mnemonic_hmac_salt: mnemonicHmacSalt,
          device_name: "Web Browser", device_public_key: "web", device_wrapped: "web",
        });
        tokens = response;
        await saveSession({
          email: "google", localSalt: keys.localSalt, encrypted_user_key: keys.encrypted_user_key,
          mnemonic_salt: keys.mnemonic_salt, cached_K: keys.cached_K,
          has_passphrase: !!passphrase, local_password_version: 0,
        });
      }

      // 展示助记词（仅一次，提示用户保存）
      // 不立即 login()，否则 GuestGuard 会重定向走，模态框看不到
      setMnemonic(mnemonic);
      setPendingTokens(tokens);
      setShowMnemonic(true);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : t("auth.register.registerFailed"), type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async (target: "email" | "phone") => {
    const value = target === "email" ? email : phone;
    if (!value) return;
    await apiClient.sendCode({ target, value });
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
              <SendCodeButton onClick={() => handleSendCode("email")} disabled={!email} />
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
            <SendCodeButton onClick={() => handleSendCode("phone")} disabled={!phone} />
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

      {/* 可选Passphrase - 与助记词一起派生 K，加强加密；永久不可改 */}
      <div style={{ marginTop: "0.75rem", padding: "0.75rem", background: "#f9f9f9", borderRadius: 8, border: "1px solid #eee" }}>
        <PasswordInput label={t("auth.register.passphraseLabel")} value={passphrase} onChange={(e) => setMasterPassword(e.target.value)} placeholder={t("auth.register.passphrasePlaceholder")} />
        <p style={{ fontSize: "0.75rem", color: "#999", marginTop: "0.4rem", lineHeight: 1.4 }}>
          {t("auth.register.passphraseHint")}
        </p>
      </div>

      <button onClick={handleRegister} disabled={loading}
        style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
        {loading ? t("common.registering") : t("auth.register.submitBtn")}
      </button>

      <div style={{ marginTop: "1.5rem", textAlign: "center", fontSize: "0.85rem", color: "#666" }}>
        {t("auth.register.hasAccount")}
        <Link to="/login" style={{ color: "#0f3460", textDecoration: "none", fontWeight: 500 }}>{t("auth.register.loginLink")}</Link>
      </div>

      {showMnemonic && mnemonic && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "2rem", maxWidth: 480, width: "90%", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>
            <h2 style={{ color: "#0f3460", marginBottom: "0.5rem" }}>🔐 助记词</h2>
            <p style={{ fontSize: "0.85rem", color: "#666", marginBottom: "1rem" }}>
              请妥善保存以下 12 个词，这是您忘记本地密码后恢复数据的唯一途径。此助记词仅显示一次，无法再次查看。
            </p>
            <div style={{ background: "#f5f5f5", borderRadius: 8, padding: "1rem", fontFamily: "monospace", fontSize: "1rem", lineHeight: 1.8, wordBreak: "break-all", marginBottom: "1rem" }}>
              {mnemonic}
            </div>
            <button onClick={() => { navigator.clipboard.writeText(mnemonic); setToast({ message: t("auth.register.copied"), type: "success" }); }}
              style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem", background: "#0f3460", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem" }}>
              {t("auth.register.copyMnemonic")}
            </button>
            <p style={{ fontSize: "0.8rem", color: "#e74c3c", marginBottom: "1rem" }}>
              ⚠️ 丢失助记词 + 忘记本地密码 = 数据永久丢失
            </p>
            {passphrase && (
              <p style={{ fontSize: "0.8rem", color: "#e74c3c", marginBottom: "1rem" }}>
                ⚠️ 您设置了Passphrase，恢复数据时需同时输入助记词和Passphrase。请一并妥善保存Passphrase（永久不可改）。
              </p>
            )}
            <button onClick={() => {
              if (pendingTokens) {
                login(pendingTokens.access_token, pendingTokens.refresh_token, pendingTokens.user_id);
              }
              setShowMnemonic(false);
              navigate("/");
            }}
              style={{ width: "100%", padding: "0.75rem", background: "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: "pointer" }}>
              我已保存，进入密码库
            </button>
          </div>
        </div>
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}
