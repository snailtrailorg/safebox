/** 密码生成器 — 对应 Android ItemEditViewModel 的 generatePassword */

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SPECIALS = "!@#$%^&*()-_=+[]{}|;:,.<>?";

export interface PasswordOptions {
  length: number;
  includeLower: boolean;
  includeUpper: boolean;
  includeDigits: boolean;
  includeSpecials: boolean;
}

const DEFAULT_OPTIONS: PasswordOptions = {
  length: 16,
  includeLower: true,
  includeUpper: true,
  includeDigits: true,
  includeSpecials: true,
};

export function generatePassword(opts?: Partial<PasswordOptions>): string {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  let pool = "";
  if (options.includeLower) pool += LOWERCASE;
  if (options.includeUpper) pool += UPPERCASE;
  if (options.includeDigits) pool += DIGITS;
  if (options.includeSpecials) pool += SPECIALS;
  if (pool.length === 0) pool = LOWERCASE + DIGITS;

  // 用 Uint32Array + 取模 避免 Uint8Array % pool.length 的微小模偏差
  const chars = new Uint32Array(options.length);
  crypto.getRandomValues(chars);
  let result = "";
  for (let i = 0; i < options.length; i++) {
    result += pool[chars[i] % pool.length];
  }
  return result;
}
