/**
 * AppLayout — 全局布局：顶栏 + 离线提示 + 主内容区
 */
import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../context/AuthContext";
import { useVault } from "../../context/VaultContext";
import { getSession } from "../../db/sessionStore";
import type { ReactNode } from "react";

interface AppLayoutProps {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}

export function AppLayout({ title, children, actions }: AppLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const { syncNow: vaultSyncNow, isSyncing } = useVault();
  const [offline, setOffline] = useState(!navigator.onLine);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 加载用户邮箱
  useEffect(() => {
    getSession().then((s) => setUserEmail(s.email || ""));
  }, []);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 关闭下拉并导航
  const navigateAndClose = (path: string) => {
    setDropdownOpen(false);
    navigate(path);
  };

  const handleLogout = async () => {
    setDropdownOpen(false);
    if (!confirm(t("settings.logoutConfirm"))) return;
    await logout();
    navigate("/login");
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "#f5f5f5",
    }}>
      {offline && (
        <div style={{
          background: "#e74c3c", color: "#fff", textAlign: "center",
          padding: "0.4rem", fontSize: "0.8rem", fontWeight: 500,
        }}>
          {t("appLayout.offline")}
        </div>
      )}
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
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button
            onClick={() => {
              if (location.pathname.includes("/edit")) {
                if (!confirm(t("appLayout.discardEdit"))) return;
              }
              navigate("/");
            }}
            title={t("appLayout.home")}
            style={{
              background: "none", border: "none", color: "#fff",
              fontSize: "1.3rem", cursor: "pointer", padding: 0,
              lineHeight: 1,
            }}
          >
            🏠
          </button>
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
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", position: "relative" }}>
          {actions}
          {location.pathname === "/" && (
            <>
              <button
                onClick={() => vaultSyncNow()}
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
                {isSyncing ? t("common.syncing") : t("appLayout.sync")}
              </button>
              {/* 下拉菜单里的同步按钮 */}
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  vaultSyncNow();
                }}
                disabled={isSyncing}
                style={menuBtnStyle(t("appLayout.sync"))}
              >
                {t("appLayout.sync")}
              </button>
            </>
          )}
          {/* 用户头像 + 下拉菜单 */}
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              title={t("appLayout.userMenu")}
              style={{
                background: dropdownOpen ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.15)",
                border: "none",
                color: "#fff",
                padding: "0.35rem 0.6rem",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: "0.95rem",
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!dropdownOpen) e.currentTarget.style.background = "rgba(255,255,255,0.25)";
              }}
              onMouseLeave={(e) => {
                if (!dropdownOpen) e.currentTarget.style.background = "rgba(255,255,255,0.15)";
              }}
            >
              👤
            </button>

            {dropdownOpen && (
              <div style={{
                position: "absolute",
                top: "calc(100% + 0.5rem)",
                right: 0,
                background: "#fff",
                borderRadius: 10,
                boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                minWidth: 220,
                overflow: "hidden",
                zIndex: 200,
              }}>
                {/* 用户信息区 */}
                {userEmail && (
                  <div style={{
                    padding: "0.75rem 1rem",
                    background: "#f8f9fa",
                    borderBottom: "1px solid #eee",
                    fontSize: "0.8rem",
                    color: "#666",
                    wordBreak: "break-all",
                  }}>
                    {userEmail}
                  </div>
                )}

                {/* 修改密码 */}
                <button
                  onClick={() => navigateAndClose("/settings/change-password")}
                  style={menuBtnStyle(t("settings.changePassword"))}
                >
                  {t("settings.changePassword")}
                </button>

                {/* 导出备份 */}
                <button
                  onClick={() => navigateAndClose("/settings/export")}
                  style={menuBtnStyle(t("settings.exportBackup"))}
                >
                  {t("settings.exportBackup")}
                </button>

                {/* 导入备份 */}
                <button
                  onClick={() => navigateAndClose("/settings/import")}
                  style={menuBtnStyle(t("settings.importBackup"))}
                >
                  {t("settings.importBackup")}
                </button>

                {/* 分割线 */}
                <div style={{ height: 1, background: "#eee" }} />

                {/* 退出登录 */}
                <button
                  onClick={handleLogout}
                  style={{
                    ...menuBtnStyle(t("settings.logout")),
                    color: "#e74c3c",
                  }}
                >
                  {t("settings.logout")}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 内容 */}
      <main style={{ flex: 1, padding: "1rem", maxWidth: 768, width: "100%", margin: "0 auto" }}>
        {children}
      </main>
    </div>
  );
}

function menuBtnStyle(label: string): React.CSSProperties {
  return {
    width: "100%",
    padding: "0.65rem 1rem",
    background: "none",
    border: "none",
    fontSize: "0.9rem",
    textAlign: "left",
    cursor: "pointer",
    color: "#333",
    transition: "background 0.1s",
  };
}
