import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { keyManager } from "../../services/keyManager";
import { useAuth } from "../../context/AuthContext";
import { getSession, saveSession } from "../../db/sessionStore";
import { apiClient } from "../../services/api";
import { generateSalt, deriveKeyHash, deriveKey } from "../../crypto/pbkdf2";
import { aesEncrypt } from "../../crypto/aes";

export function RecoveryPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const handleRecover = async () => {
    if (!recoveryCode.trim()) {
      setToast({ message: "请输入恢复码", type: "error" });
      return;
    }
    setLoading(true);
    try {
      // 从 IndexedDB 读取 recoveryWrapped
      const session = await getSession();
      if (!session.recoveryWrapped) {
        setToast({ message: "本地无密钥材料，请先在已注册设备上登录", type: "error" });
        setLoading(false);
        return;
      }

      const ok = await keyManager.unlockWithRecoveryCode(recoveryCode, session.recoveryWrapped);
      if (!ok) {
        setToast({ message: "恢复码无效", type: "error" });
        setLoading(false);
        return;
      }

      // 加载 RSA 密钥
      const rsaLoaded = await keyManager.loadRsaKeys(session.encryptedPrivate, session.rsaPublicKey);
      if (!rsaLoaded) {
        setToast({ message: "密钥恢复失败", type: "error" });
        setLoading(false);
        return;
      }

      // 如果有新密码，重新生成密钥材料并更新
      if (newPassword && session.accessToken) {
        const newSalt = generateSalt();
        const newDerivedKey = await deriveKey(newPassword, newSalt);
        const masterRaw = await crypto.subtle.exportKey("raw", (keyManager as any).masterKey);
        const newPasswordWrapped = await aesEncrypt(newDerivedKey, new Uint8Array(masterRaw));
        const newPasswordHash = await deriveKeyHash(newPassword, newSalt);
        const saltBase64 = btoa(String.fromCharCode(...newSalt));

        await apiClient.resetPassword({
          target: "email",
          value: "",
          verification_code: "",
          new_password_hash: newPasswordHash,
          new_password_salt: saltBase64,
          new_password_wrapped: newPasswordWrapped,
        });
        await saveSession({ passwordSalt: saltBase64, passwordWrapped: newPasswordWrapped });
      }

      await login(session.accessToken, session.refreshToken, session.serverUserId);
      navigate("/");
    } catch (e: any) {
      setToast({ message: e.message || "恢复失败", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="恢复账号" subtitle="输入 12 词恢复码">
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>恢复码</label>
        <textarea
          value={recoveryCode}
          onChange={(e) => setRecoveryCode(e.target.value)}
          placeholder="输入 12 个英文单词，用空格分隔"
          rows={3}
          style={{
            width: "100%", padding: "0.6rem 0.75rem",
            border: "1px solid #ddd", borderRadius: 8,
            fontSize: "0.95rem", fontFamily: "monospace",
            boxSizing: "border-box", resize: "vertical",
          }}
        />
      </div>

      <PasswordInput
        label="新密码（可选）"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="留空则不修改密码"
      />

      <button
        onClick={handleRecover}
        disabled={loading}
        style={{
          width: "100%", padding: "0.75rem", marginTop: "0.5rem",
          background: loading ? "#95a5a6" : "#e74c3c", color: "#fff",
          border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "恢复中…" : "恢复账号"}
      </button>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AuthLayout>
  );
}
