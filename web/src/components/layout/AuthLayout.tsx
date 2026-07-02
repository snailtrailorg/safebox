import type { ReactNode } from "react";

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
      padding: "1rem",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 400,
        background: "#fff",
        borderRadius: 16,
        padding: "2rem",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      }}>
        <h1 style={{
          textAlign: "center",
          fontSize: "1.75rem",
          fontWeight: 700,
          color: "#0f3460",
          marginBottom: "0.25rem",
        }}>
          SafeBox
        </h1>
        <h2 style={{
          textAlign: "center",
          fontSize: "1.1rem",
          fontWeight: 600,
          color: "#333",
          marginBottom: subtitle ? "0.25rem" : "1.5rem",
        }}>
          {title}
        </h2>
        {subtitle && (
          <p style={{
            textAlign: "center",
            fontSize: "0.85rem",
            color: "#666",
            marginBottom: "1.5rem",
          }}>
            {subtitle}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
