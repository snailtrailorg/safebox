import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "../../components/layout/AppLayout";
import { Toast } from "../../components/ui/Toast";
import { useAuth } from "../../context/AuthContext";
import { useVault } from "../../context/VaultContext";

export function SettingsPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { syncNow, isSyncing } = useVault();
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const handleLogout = async () => {
    if (!confirm("确定退出登录？密钥将从内存中清除。")) return;
    await logout();
    navigate("/login");
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
