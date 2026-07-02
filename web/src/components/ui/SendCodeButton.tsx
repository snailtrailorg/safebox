/**
 * SendCodeButton — 带倒计时的发送验证码按钮
 *
 * 点击发送后显示倒计时（默认 60s），倒计结束显示"重新发送"
 */
import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface SendCodeButtonProps {
  onClick: () => Promise<void>;
  disabled?: boolean;
  /** 倒计时秒数，默认 60 */
  countdown?: number;
}

export function SendCodeButton({ onClick, disabled, countdown = 60 }: SendCodeButtonProps) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleClick = async () => {
    if (sending || remaining > 0) return;
    setSending(true);
    setRemaining(countdown);
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    try {
      await onClick();
    } catch {
      if (timerRef.current) clearInterval(timerRef.current);
      setRemaining(0);
    } finally {
      setSending(false);
    }
  };

  const btnText = () => {
    if (sending) return t("common.sending");
    if (remaining > 0) return t("common.resendIn", { s: remaining });
    return t("common.sendCode");
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || sending || remaining > 0}
      style={{
        padding: "0.6rem 1rem",
        background: remaining > 0 ? "#27ae60" : "#3498db",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        cursor: sending || remaining > 0 ? "not-allowed" : "pointer",
        fontSize: "0.85rem",
        whiteSpace: "nowrap",
      }}
    >
      {btnText()}
    </button>
  );
}
