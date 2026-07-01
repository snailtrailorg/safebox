/**
 * DbErrorBoundary — 捕获 IndexedDB 运行时错误，防止白屏
 */
import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class DbErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <DbErrorFallback />;
    }
    return this.props.children;
  }
}

function DbErrorFallback() {
  const { t } = useTranslation();
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#f5f5f5",
      padding: "1rem",
    }}>
      <div style={{
        background: "#fff",
        borderRadius: 12,
        padding: "2rem",
        maxWidth: 400,
        textAlign: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      }}>
        <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⚠️</div>
        <h2 style={{ fontSize: "1.1rem", color: "#333", marginBottom: "0.75rem" }}>
          {t("app.dbErrorTitle")}
        </h2>
        <p style={{ fontSize: "0.9rem", color: "#666", lineHeight: 1.6, marginBottom: "1.5rem" }}>
          {t("app.dbErrorDetail")}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "0.6rem 2rem",
            background: "#0f3460",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: "0.95rem",
            cursor: "pointer",
          }}
        >
          {t("common.reload")}
        </button>
      </div>
    </div>
  );
}
