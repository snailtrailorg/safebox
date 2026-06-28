import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { apiClient } from "../../services/api";
import { keyManager } from "../../services/keyManager";
import { useAuth } from "../../context/AuthContext";
import { saveSession } from "../../db/sessionStore";
import { GOOGLE_CLIENT_ID } from "../../config/constants";

type RegisterTab = "email" | "phone" | "google";

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

export function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [tab, setTab] = useState<RegisterTab>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  // Google
  const [googleIdToken, setGoogleIdToken] = useState("");
  const [googleAuthed, setGoogleAuthed] = useState(false);
  const googleInitRef = useRef(false);

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
            setToast({ message: "Google 验证成功，请设置密码", type: "success" });
          },
        });
      }
    }, 200);
    return () => clearInterval(timer);
  }, [tab]);

  const handleRegister = async () => {
    if (tab === "email" && (!email || !code || !password)) {
      setToast({ message: "请输入邮箱、验证码和密码", type: "error" });
      return;
    }
    if (tab === "phone" && (!phone || !code || !password)) {
      setToast({ message: "请填写完整", type: "error" });
      return;
    }
    if (tab === "google" && (!googleIdToken || !password)) {
      setToast({ message: "请先完成 Google 验证并设置密码", type: "error" });
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
        await login(response.access_token, response.refresh_token, response.user_id);
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
        await login(response.access_token, response.refresh_token, response.user_id);
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
        await login(response.access_token, response.refresh_token, response.user_id);
      }

      setRecoveryCode(keys.recoveryCode);
    } catch (e: any) {
      setToast({ message: e.message || "注册失败", type: "error" });
      setLoading(false);
    }
  };

  const handleSendCode = async (target: "email" | "phone") => {
    const value = target === "email" ? email : phone;
    if (!value) return;
    try {
      await apiClient.sendCode({ target, value });
      setCodeSent(true);
      setToast({ message: "验证码已发送", type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || "发送失败", type: "error" });
    }
  };

  const handleGoogleRegister = () => {
    if (!GOOGLE_CLIENT_ID) {
      setToast({ message: "Google 注册未配置", type: "error" });
      return;
    }
    window.google?.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed()) {
        setToast({ message: "Google 弹窗被阻止，请允许弹窗后重试", type: "error" });
      }
    });
  };

  if (recoveryCode) {
    return (
      <AuthLayout title="注册成功" subtitle="请保存你的恢复码">
        <div style={{ background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
          <p style={{ fontSize: "0.85rem", color: "#856404", marginBottom: "0.5rem", fontWeight: 600 }}>
            ⚠️ 恢复码仅在此时显示一次，关闭页面后无法再次查看！
          </p>
          <p style={{ fontSize: "0.8rem", color: "#856404", marginBottom: "0.75rem" }}>
            请立即复制并保存在安全的地方（建议打印或手写）。丢失密码和恢复码将导致数据永久无法恢复。
          </p>
          <div style={{ background: "#fff", border: "1px solid #ffc107", borderRadius: 6, padding: "0.75rem", fontFamily: "monospace", fontSize: "1.1rem", fontWeight: 700, textAlign: "center", wordBreak: "break-word", color: "#333" }}>
            {recoveryCode}
          </div>
        </div>
        <button onClick={() => { navigator.clipboard.writeText(recoveryCode); setToast({ message: "已复制到剪贴板", type: "success" }); }}
          style={{ width: "100%", padding: "0.5rem", marginBottom: "0.75rem", background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8, cursor: "pointer", fontSize: "0.9rem" }}>
          📋 复制恢复码
        </button>
        <button onClick={() => navigate("/")}
          style={{ width: "100%", padding: "0.75rem", background: "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: "pointer" }}>
          我已保存，进入 SafeBox
        </button>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AuthLayout>
    );
  }

  const tabs: { key: RegisterTab; label: string }[] = [
    { key: "email", label: "📧 邮箱" },
    { key: "phone", label: "📱 手机" },
    { key: "google", label: "𝐆 Google" },
  ];

  return (
    <AuthLayout title="注册" subtitle="创建端到端加密账号">
      <div style={{ display: "flex", marginBottom: "1.5rem", borderRadius: 8, overflow: "hidden", border: "1px solid #ddd" }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ flex: 1, padding: "0.5rem", border: "none", background: tab === t.key ? "#0f3460" : "#f5f5f5", color: tab === t.key ? "#fff" : "#333", cursor: "pointer", fontSize: "0.85rem", fontWeight: 500 }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "email" ? (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>邮箱</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com"
                style={{ flex: 1, padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
              <button onClick={() => handleSendCode("email")} disabled={!email}
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
          <PasswordInput label="密码" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少8位" />
        </>
      ) : tab === "phone" ? (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>手机号</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+8613800138000"
                style={{ flex: 1, padding: "0.6rem 0.75rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }} />
              <button onClick={() => handleSendCode("phone")} disabled={!phone}
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
          <PasswordInput label="密码" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少8位" />
        </>
      ) : (
        <>
          {!googleAuthed ? (
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "1rem" }}>
                使用 Google 账号注册，仍需设置密码用于加密
              </p>
              <button onClick={handleGoogleRegister} disabled={loading}
                style={{ padding: "0.75rem 2rem", background: "#fff", color: "#333", border: "1px solid #ddd", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
                {loading ? "验证中…" : "🔐 使用 Google 账号注册"}
              </button>
              {!GOOGLE_CLIENT_ID && (
                <p style={{ fontSize: "0.8rem", color: "#e74c3c", marginTop: "0.75rem" }}>
                  Google 注册未配置。请在 config/constants.ts 中设置 GOOGLE_CLIENT_ID。
                </p>
              )}
            </div>
          ) : (
            <>
              <div style={{ marginBottom: "1rem", padding: "0.5rem 0.75rem", background: "#f0fff0", borderRadius: 8, border: "1px solid #27ae60", fontSize: "0.85rem", color: "#27ae60", textAlign: "center" }}>
                ✅ Google 账号已验证
              </div>
              <PasswordInput label="密码" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少8位" />
            </>
          )}
        </>
      )}

      <button onClick={handleRegister} disabled={loading}
        style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: loading ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
        {loading ? "注册中…" : "注册"}
      </button>

      <div style={{ marginTop: "1.5rem", textAlign: "center", fontSize: "0.85rem", color: "#666" }}>
        已有账号？
        <Link to="/login" style={{ color: "#0f3460", textDecoration: "none", fontWeight: 500 }}>登录</Link>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}
