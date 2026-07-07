/**
 * useAutoLock — 自动锁定计时器
 *
 * 20 分钟无操作后锁定，到期前 60 秒倒计时告警。
 * 监听 mousedown / keydown / touchstart / scroll 事件。
 */
import { useEffect, useState, useCallback } from "react";

const INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;
const WARN_COUNTDOWN_MS = 60 * 1000;
const WARN_AT_MS = INACTIVITY_TIMEOUT_MS - WARN_COUNTDOWN_MS;

export function useAutoLock(isReady: boolean, onLock: () => void) {
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    let lockTimer: ReturnType<typeof setTimeout>;
    let countdownTimer: ReturnType<typeof setInterval>;

    const cancelTimers = () => {
      clearTimeout(lockTimer);
      clearInterval(countdownTimer);
      setCountdown((prev) => (prev > 0 ? 0 : prev));
    };

    const startCountdown = () => {
      setCountdown(WARN_COUNTDOWN_MS / 1000);
      countdownTimer = setInterval(() => {
        setCountdown((prev) => {
          const next = prev - 1;
          if (next <= 0) {
            clearInterval(countdownTimer);
            setTimeout(() => onLock(), 0);
            return 0;
          }
          return next;
        });
      }, 1000);
    };

    const resetTimer = () => {
      cancelTimers();
      if (isReady) {
        lockTimer = setTimeout(startCountdown, WARN_AT_MS);
      }
    };

    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      cancelTimers();
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [isReady, onLock]);

  return { countdown };
}