/**
 * AutoLockOverlay — 自动锁定倒计时浮层
 *
 * 全屏 fixed 遮罩，后台页面不可操作。用户点击按钮重置计时。
 */
import { useTranslation } from "react-i18next";
import { useAuth } from "../../context/AuthContext";

export function AutoLockOverlay() {
  const { t } = useTranslation();
  const { countdown } = useAuth();

  if (countdown <= 0) return null;

  return (
    <div style={{
      position: "fixed",
      top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
    }}>
      <div style={{
        background: "#fff",
        borderRadius: 16,
        padding: "2rem",
        maxWidth: 320,
        width: "100%",
        textAlign: "center",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>⏰</div>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#333", margin: "0 0 0.75rem" }}>
          {t("appLayout.autoLockTitle")}
        </h2>
        <div style={{
          fontSize: "2rem", fontWeight: 700, color: "#e74c3c",
          marginBottom: "1.25rem",
        }}>
          {countdown}
        </div>
        <button
          onClick={() => window.dispatchEvent(new Event("mousedown"))}
          style={{
            width: "100%", padding: "0.75rem",
            background: "#0f3460", color: "#fff",
            border: "none", borderRadius: 8,
            fontSize: "0.95rem", fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("appLayout.autoLockContinue")}
        </button>
      </div>
    </div>
  );
}
