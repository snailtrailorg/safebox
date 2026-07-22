import i18n from "../i18n";
/** 加密常量 — 与 Android CryptoManager.kt 完全一致 */

export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_KEY_LENGTH = 256;
export const SALT_LENGTH = 32;

export const AES_KEY_LENGTH = 256;
export const GCM_NONCE_LENGTH = 12;
export const GCM_TAG_LENGTH = 128;

export const RSA_KEY_LENGTH = 4096;
// OAEP SHA-256 最大荷载: 512 (模长) - 2*32 (SHA256 双哈希) - 2 (编码) = 446 字节
export const RSA_CHUNK_SIZE = 446;
export const RSA_DECRYPT_CHUNK = 512;

export const DEVICE_KEY_ALIAS = "safebox_device_key";

// ── 密码强度校验 ──────────────────────────────────

export function checkPasswordStrength(password: string): { ok: boolean; reason?: string } {
  if (password.length < 12) return { ok: false, reason: i18n.t("password.minLength") };
  if (!/[A-Z]/.test(password)) return { ok: false, reason: i18n.t("password.needUpper") };
  if (!/[a-z]/.test(password)) return { ok: false, reason: i18n.t("password.needLower") };
  if (!/[0-9]/.test(password)) return { ok: false, reason: i18n.t("password.needDigit") };
  const SPECIAL_CHARS = `~!@#$%^&*()_+{}[]:;<>,./?'"`;
  if (!password.split('').some(c => SPECIAL_CHARS.includes(c)))
    return { ok: false, reason: i18n.t("password.needSpecial") };
  if (hasSequentialPattern(password))
    return { ok: false, reason: i18n.t("password.sequential") };
  return { ok: true };
}

function hasSequentialPattern(password: string): boolean {
  for (let i = 0; i < password.length - 2; i++) {
    const a = password.charCodeAt(i);
    const b = password.charCodeAt(i + 1);
    const c = password.charCodeAt(i + 2);
    if (b === a + 1 && c === a + 2) return true;
    if (b === a - 1 && c === a - 2) return true;
  }
  return false;
}
