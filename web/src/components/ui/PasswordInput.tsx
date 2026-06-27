import { useState, type InputHTMLAttributes } from "react";

interface PasswordInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function PasswordInput({ label, ...props }: PasswordInputProps) {
  const [show, setShow] = useState(false);

  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.25rem", color: "#333" }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          type={show ? "text" : "password"}
          {...props}
          style={{
            width: "100%",
            padding: "0.6rem 2.5rem 0.6rem 0.75rem",
            border: "1px solid #ddd",
            borderRadius: 8,
            fontSize: "0.95rem",
            boxSizing: "border-box",
            ...props.style,
          }}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "0.85rem",
            color: "#666",
            padding: "0.25rem",
          }}
        >
          {show ? "🙈" : "👁️"}
        </button>
      </div>
    </div>
  );
}
