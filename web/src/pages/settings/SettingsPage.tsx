import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "../../components/layout/AppLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { useAuth } from "../../context/AuthContext";
import { useVault } from "../../context/VaultContext";
import { apiClient } from "../../services/api";
import { keyManager } from "../../services/keyManager";
import { getSession, saveSession } from "../../db/sessionStore";
import { deriveKeyHash, generateSalt, deriveKey } from "../../crypto/pbkdf2";
import { aesEncrypt } from "../../crypto/aes";

export function SettingsPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { syncNow, isSyncing } = useVault();
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  // 修改密码
  const [showChangePw, setShowChangePw] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [changing, setChanging] = useState(false);

  const handleLogout = async () => {
    if (!confirm("确定退出登录？密钥将从内存中清除。")) return;
    await logout();
    navigate("/login");
  };

  const handleSendVerifyCode = async () => {
    if (!currentPassword) {
      setToast({ message: "请先输入当前密码", type: "error" });
      return;
    }
    try {
      const session = await getSession();

      // 验证当前密码
      const ok = await keyManager.unlockWithPassword(currentPassword, session.passwordSalt, session.passwordWrapped);
      if (!ok) {
        setToast({ message: "当前密码错误", type: "error" });
        return;
      }

      // 获取用户邮箱发送验证码
      const email = session.email || "";
      if (!email) {
        setToast({ message: "无法获取邮箱", type: "error" });
        return;
      }
      await apiClient.sendCode({ target: "email", value: email });
      setCodeSent(true);
      setToast({ message: "验证码已发送到邮箱", type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || "发送失败", type: "error" });
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || !verifyCode) {
      setToast({ message: "请输入新密码和验证码", type: "error" });
      return;
    }
    if (newPassword.length < 8) {
      setToast({ message: "密码至少 8 位", type: "error" });
      return;
    }
    setChanging(true);
    try {
      const session = await getSession();
      const email = session.email || "";

      // 重新派生密钥
      const newSalt = generateSalt();
      const newDerivedKey = await deriveKey(newPassword, newSalt);
      const newPasswordHash = await deriveKeyHash(newPassword, newSalt);

      // 用新密钥重新包裹 masterKey
      const masterRaw = await crypto.subtle.exportKey("raw", (keyManager as any).masterKey);
      const newPasswordWrapped = await aesEncrypt(newDerivedKey, new Uint8Array(masterRaw));
      const saltBase64 = btoa(String.fromCharCode(...newSalt));

      // 调用 API
      await apiClient.resetPassword({
        target: "email",
        value: email,
        verification_code: verifyCode,
        new_password_hash: newPasswordHash,
        new_password_salt: saltBase64,
        new_password_wrapped: newPasswordWrapped,
      });

      // 更新本地 session
      await saveSession({
        passwordSalt: saltBase64,
        passwordWrapped: newPasswordWrapped,
      });

      setToast({ message: "密码已修改", type: "success" });
      setShowChangePw(false);
      setCurrentPassword("");
      setNewPassword("");
      setVerifyCode("");
      setCodeSent(false);
    } catch (e: any) {
      setToast({ message: e.message || "修改失败", type: "error" });
    } finally {
      setChanging(false);
    }
  };

  return (
    <AppLayout title="设置">
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* 安全 */}
        <section style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#333", marginBottom: "1rem" }}>🔐 安全</h3>

          <div style={{
            width: "100%", padding: "0.75rem", marginBottom: "0.5rem",
            background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8,
            fontSize: "0.85rem", color: "#666", lineHeight: 1.6,
          }}>
            <p style={{ margin: 0, fontWeight: 500, color: "#333" }}>🔑 恢复码</p>
            <p style={{ margin: "0.25rem 0 0 0" }}>
              恢复码仅在注册时显示一次，无法再次查看。如已丢失密码和恢复码，账号数据将永久无法恢复。
            </p>
          </div>

          <button
            onClick={() => setShowChangePw(!showChangePw)}
            style={{
              width: "100%", padding: "0.75rem", marginBottom: "0.5rem",
              background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8,
              cursor: "pointer", fontSize: "0.9rem", textAlign: "left",
            }}
          >
            🔒 修改密码
          </button>

          {showChangePw && (
            <div style={{ marginBottom: "0.5rem" }}>
              <PasswordInput
                label="当前密码"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="输入当前密码"
              />
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder="邮箱验证码"
                  maxLength={6}
                  style={{ flex: 1, padding: "0.5rem", border: "1px solid #ddd", borderRadius: 6, fontSize: "0.95rem", boxSizing: "border-box" }}
                />
                <button
                  onClick={handleSendVerifyCode}
                  disabled={codeSent}
                  style={{
                    padding: "0.5rem 0.75rem", background: codeSent ? "#27ae60" : "#3498db",
                    color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
                    fontSize: "0.85rem", whiteSpace: "nowrap",
                  }}
                >
                  {codeSent ? "已发送" : "发送验证码"}
                </button>
              </div>
              <PasswordInput
                label="新密码"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 8 位"
              />
              <button
                onClick={handleChangePassword}
                disabled={changing}
                style={{
                  width: "100%", padding: "0.5rem",
                  background: changing ? "#95a5a6" : "#0f3460", color: "#fff",
                  border: "none", borderRadius: 6, fontSize: "0.9rem", fontWeight: 600,
                  cursor: changing ? "not-allowed" : "pointer",
                }}
              >
                {changing ? "修改中…" : "确认修改"}
              </button>
            </div>
          )}

          <button
            onClick={() => setToast({ message: "自动锁定：5 分钟无操作", type: "info" })}
            style={{
              width: "100%", padding: "0.75rem",
              background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8,
              cursor: "pointer", fontSize: "0.9rem", textAlign: "left",
            }}
          >
            ⏱️ 自动锁定（5 分钟）
          </button>
        </section>

        {/* 数据 */}
        <section style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#333", marginBottom: "1rem" }}>💾 数据管理</h3>

          <button
            onClick={syncNow}
            disabled={isSyncing}
            style={{
              width: "100%", padding: "0.75rem", marginBottom: "0.5rem",
              background: isSyncing ? "#e0e0e0" : "#f5f5f5",
              border: "1px solid #ddd", borderRadius: 8,
              cursor: isSyncing ? "not-allowed" : "pointer",
              fontSize: "0.9rem", textAlign: "left",
            }}
          >
            {isSyncing ? "⏳ 同步中…" : "🔄 立即同步"}
          </button>

          <button
            onClick={() => setToast({ message: "导出功能即将上线", type: "info" })}
            style={{
              width: "100%", padding: "0.75rem", marginBottom: "0.5rem",
              background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8,
              cursor: "pointer", fontSize: "0.9rem", textAlign: "left",
            }}
          >
            📤 导出加密备份
          </button>

          <button
            onClick={() => setToast({ message: "导入功能即将上线", type: "info" })}
            style={{
              width: "100%", padding: "0.75rem",
              background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8,
              cursor: "pointer", fontSize: "0.9rem", textAlign: "left",
            }}
          >
            📥 导入备份
          </button>
        </section>

        {/* 账号 */}
        <section style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#333", marginBottom: "1rem" }}>👤 账号</h3>

          <button
            onClick={handleLogout}
            style={{
              width: "100%", padding: "0.75rem",
              background: "#fff", border: "1px solid #e74c3c", borderRadius: 8,
              color: "#e74c3c", cursor: "pointer", fontSize: "0.9rem",
            }}
          >
            🚪 退出登录
          </button>
        </section>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AppLayout>
  );
}
