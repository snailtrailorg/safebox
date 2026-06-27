import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  type?: "info" | "error" | "success";
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type = "info", onClose, duration = 3000 }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const bgColor =
    type === "error" ? "#e74c3c" :
    type === "success" ? "#27ae60" : "#3498db";

  return (
    <div style={{
      position: "fixed",
      bottom: 24,
      left: "50%",
      transform: `translateX(-50%) translateY(${visible ? 0 : 20}px)`,
      opacity: visible ? 1 : 0,
      transition: "all 0.3s ease",
      background: bgColor,
      color: "#fff",
      padding: "0.75rem 1.5rem",
      borderRadius: 8,
      fontSize: "0.9rem",
      boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
      zIndex: 1000,
      whiteSpace: "nowrap",
    }}>
      {message}
    </div>
  );
}
