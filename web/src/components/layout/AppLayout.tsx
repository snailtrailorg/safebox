import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useVault } from "../../context/VaultContext";
import type { ReactNode } from "react";

interface AppLayoutProps {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}

export function AppLayout({ title, children, actions }: AppLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const { syncNow, isSyncing } = useVault();

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "#f5f5f5",
    }}>
      {/* 顶栏 */}
      <header style={{
        background: "linear-gradient(135deg, #1a1a2e, #16213e)",
        color: "#fff",
        padding: "0.75rem 1rem",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            onClick={() => navigate("/")}
            style={{
              background: "none",
              border: "none",
              color: "#fff",
              fontSize: "1.1rem",
              fontWeight: 700,
              cursor: "pointer",
              padding: 0,
            }}
          >
            SafeBox
          </button>
          <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>{title}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {actions}
          {location.pathname === "/" && (
            <button
              onClick={syncNow}
              disabled={isSyncing}
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "none",
                color: "#fff",
                padding: "0.4rem 0.8rem",
                borderRadius: 6,
                cursor: isSyncing ? "not-allowed" : "pointer",
                fontSize: "0.85rem",
              }}
            >
              {isSyncing ? "同步中…" : "🔄 同步"}
            </button>
          )}
          <button
            onClick={() => navigate("/settings")}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              color: "#fff",
              padding: "0.4rem 0.8rem",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* 内容 */}
      <main style={{ flex: 1, padding: "1rem", maxWidth: 768, width: "100%", margin: "0 auto" }}>
        {children}
      </main>
    </div>
  );
}
