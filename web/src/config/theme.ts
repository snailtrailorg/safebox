/** 全局主题常量 */

export const COLORS = {
  primary: "#0f3460",
  primaryLight: "#1a5276",
  headerBg: "linear-gradient(135deg, #1a1a2e, #16213e)",
  danger: "#e74c3c",
  success: "#27ae60",
  info: "#3498db",
  warning: "#ffc107",
  warningBg: "#fff3cd",
  warningText: "#856404",
  text: "#333",
  textSecondary: "#666",
  textMuted: "#999",
  border: "#ddd",
  bg: "#f5f5f5",
  cardBg: "#fff",
  disabled: "#95a5a6",
  white: "#fff",
} as const;

export const RADIUS = {
  sm: 6,
  md: 8,
  lg: 10,
  pill: 20,
  full: "50%",
} as const;

export const SHADOW = {
  card: "0 1px 3px rgba(0,0,0,0.1)",
  popup: "0 4px 16px rgba(0,0,0,0.15)",
  fab: "0 4px 12px rgba(0,0,0,0.3)",
} as const;

export const FONT = {
  xs: "0.8rem",
  sm: "0.85rem",
  md: "0.95rem",
  lg: "1rem",
  xl: "1.1rem",
} as const;
