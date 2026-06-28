import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
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
          prompt: (callback?: (n: { isNotDisplayed: () => boolean }) => void) => void;
        };
      };
    };
  }
}

export function LoginPage() {
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

  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  // ── Google One Tap 初始化 ─────────────────────────
  useEffect(() => {
    if (tab !== "google" || googleInitRef.current || !GOOGLE_CLIENT_ID) return;
    const timer = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(timer);
        googleInitRef.current = true;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (resp: { credential: string }) => {
            setGoogleIdToken(resp.credential);
            setGoogleAuthed(true);
            setToast({ message: "Google 验证成功，请输入密码", type: "success" });
          },
        });
      }
    }, 200);
    return () => clearInterval(timer);
  }, [tab]);

  // ── 通用登录响应处理 ─────────────────────────────
  const handleLoginResponse = async (response: LoginResponse, pw: string) => {
    const actualSalt = response.password_salt || "";
    const ok = await keyManager.unlockWithPassword(pw, actualSalt, response.password_wrapped ?? "");
    if (!ok) {
      setToast({ message: "密钥解锁失败，请检查密码", type: "error" });
      return;
    }
    const rsaLoaded = await keyManager.loadRsaKeys(
      response.encrypted_private,
      response.rsa_public_key,
    );
    if (!rsaLoaded) {
      setToast({ message: "RSA 密钥加载失败", type: "error" });
      return;
    }
    await login(response.access_token, response.refresh_token, "");
    navigate("/");
  };

  // ── Email 登录 ──────────────────────────────────

  const handleEmailLogin = async () => {
    if (!email || !password) {
      setToast({ message: "请输入邮箱和密码", type: "error" });
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
      setToast({ message: e.message || "登录失败", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // ── 手机登录 ─────────────────────────────────────

  const handleSendCode = async () => {
    if (!phone) return;
    setLoading(true);
    try {
      await apiClient.sendCode({ target: "phone", value: phone });
      setCodeSent(true);
      setToast({ message: "验证码已发送", type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || "发送失败", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneLogin = async () => {
    if (!phone || !code || !phonePassword) {
      setToast({ message: "请填写完整", type: "error" });
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
      setToast({ message: e.message || "登录失败", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // ── Google 登录 ──────────────────────────────────

  const handleGoogleLogin = () => {
    if (!GOOGLE_CLIENT_ID) {
      setToast({ message: "Google 登录未配置", type: "error" });
      return;
    }
    window.google?.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed()) {
        setToast({ message: "Google 登录弹窗被阻止，请允许弹窗后重试", type: "error" });
      }
    });
  };

  const handleGooglePasswordLogin = async () => {
    if (!googlePassword) {
      setToast({ message: "请输入密码", type: "error" });
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
      setToast({ message: e.message || "登录失败", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // ── Tab 标签 ─────────────────────────────────────
  const tabs: { key: LoginTab; label: string }[] = [
    { key: "email", label: "📧 邮箱" },
    { key: "phone", label: "📱 手机" },
    { key: "google", label: "𝐆 Google" },
  ];

  return (
    <AuthLayout title="登录" subtitle="端到端加密密码管理器">
      <div style={{ display: "flex", marginBottom: "1.5rem", borderRadius: 8, overflow: "hidden", border: "1px solid #ddd" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: "0.5rem", border: "none",
              background: tab === t.key ? "#0f3460" : "#f5f5f5",
              color: tab === t.key ? "#fff" : "#333",
              cursor: "pointer", fontSize: "0.85rem", fontWeight: 500,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "email" ? (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>邮箱</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com"
              style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
          </div>
          <PasswordInput label="密码" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="输入密码" />
          <button onClick={handleEmailLogin} disabled={loading} style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "登录中…" : "登录"}
          </button>
        </>
      ) : tab === "phone" ? (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>手机号</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+8613800138000"
                style={{ flex: 1, padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
              <button onClick={handleSendCode} disabled={loading || !phone}
                style={{ padding: "0.6rem 1rem", background: codeSent ? "#27ae60" : "#3498db", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem", whiteSpace: "nowrap" }}>
                {codeSent ? "已发送" : "发送验证码"}
              </button>
            </div>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>验证码</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6位数字" maxLength={6}
              style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
          </div>
          <PasswordInput label="密码" value={phonePassword} onChange={(e) => setPhonePassword(e.target.value)} placeholder="输入密码" />
          <button onClick={handlePhoneLogin} disabled={loading} style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "登录中…" : "登录"}
          </button>
        </>
      ) : (
        <>
          {!googleAuthed ? (
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "1rem" }}>
                使用 Google 账号登录，密码用于解密密钥材料
              </p>
              <button onClick={handleGoogleLogin} disabled={loading}
                style={{ padding: "0.75rem 2rem", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
                {loading ? "登录中…" : "🔐 使用 Google 账号登录"}
              </button>
              {!GOOGLE_CLIENT_ID && (
                <p style={{ fontSize: "0.8rem", color: "#e74c3c", marginTop: "0.75rem" }}>
                  Google 登录未配置。请在 config/constants.ts 中设置 GOOGLE_CLIENT_ID。
                </p>
              )}
            </div>
          ) : (
            <>
              <div style={{ marginBottom: "1rem", padding: "0.5rem 0.75rem", background: "#f0fff0", borderRadius: 8, border: "1px solid #27ae60", fontSize: "0.85rem", color: "#27ae60", textAlign: "center" }}>
                ✅ Google 账号已验证
              </div>
              <PasswordInput label="密码" value={googlePassword} onChange={(e) => setGooglePassword(e.target.value)} placeholder="输入密码解锁密钥" />
              <button onClick={handleGooglePasswordLogin} disabled={loading}
                style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
                {loading ? "登录中…" : "登录"}
              </button>
            </>
          )}
        </>
      )}

      <div style={{ marginTop: "1.5rem", textAlign: "center", fontSize: "0.85rem", color: "#666" }}>
        <Link to="/register" style={{ color: "#0f3460", textDecoration: "none", fontWeight: 500 }}>注册新账号</Link>
        <span style={{ margin: "0 0.75rem" }}>|</span>
        <Link to="/recovery" style={{ color: "#0f3460", textDecoration: "none", fontWeight: 500 }}>恢复码登录</Link>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}
