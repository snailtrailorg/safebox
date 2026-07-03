/**
 * AutoLockOverlay — 自动锁定倒计时浮层
 *
 * 当 AuthContext.countdown > 0 时渲染，显示剩余秒数和"继续保持"按钮。
 * 任何鼠标/键盘/触摸操作也会重置计时（由 AuthContext 的事件监听处理）。
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
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#333", margin: "0 0 0.25rem" }}>
          {t("appLayout.autoLockTitle")}
        </h2>
        <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "0.75rem" }}>
          {t("appLayout.autoLockHint")}
        </p>
        <div style={{
          fontSize: "2rem", fontWeight: 700, color: "#e74c3c",
          marginBottom: "1.25rem",
        }}>
          {countdown}s
        </div>
      </div>
    </div>
  );
}
