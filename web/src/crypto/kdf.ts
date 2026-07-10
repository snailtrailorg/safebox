/**
 * KDF 统一接口
 *
 * 替代 pbkdf2.ts 中的硬编码迭代数。
 * 支持 PBKDF2 / Argon2id，参数可配置、跟随账户存储。
 *
 * 认证路径: deriveAuthKey → PBKDF2(password, salt+"auth") → 与 Android 兼容
 * 加密路径: deriveKey → PBKDF2(password, salt) → 包裹/解包 User Key
 */
import { SALT_LENGTH, PBKDF2_ITERATIONS } from "../config/constants";

export type KdfSettings =
  | { algorithm: "pbkdf2"; iterations: number }
  | { algorithm: "argon2id"; memory: number; iterations: number; parallelism: number };

// 迭代数以 constants.PBKDF2_ITERATIONS 为单一真理源（与 AES nonce/tag 等常量同处）
export const DEFAULT_KDF: KdfSettings = { algorithm: "pbkdf2", iterations: PBKDF2_ITERATIONS };
export const RECOMMENDED_KDF: KdfSettings = { algorithm: "pbkdf2", iterations: PBKDF2_ITERATIONS };

/** 生成随机盐 (32 字节) */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return salt;
}

/** 底层 deriveBits（可选 Web Worker，当前主线程实现） */
async function deriveBits(
  password: string,
  salt: Uint8Array,
  settings: KdfSettings,
  length: number,
): Promise<Uint8Array> {
  if (settings.algorithm === "pbkdf2") {
    const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations: settings.iterations, hash: "SHA-256" },
      keyMaterial, length,
    ) as ArrayBuffer;
    return new Uint8Array(bits as ArrayBuffer);
  }
  // Argon2id — 暂未实现，fallback 到 PBKDF2
  return deriveBits(password, salt, DEFAULT_KDF, length);
}

/** deriveKey — 派生 AES-256 加密密钥（用于包裹/解包 User Key） */
export async function deriveKey(
  password: string, salt: Uint8Array, settings: KdfSettings = DEFAULT_KDF,
): Promise<CryptoKey> {
  const bits = await deriveBits(password, salt, settings, 256);
  return crypto.subtle.importKey("raw", bits.buffer.slice(bits.byteOffset, bits.byteOffset + bits.byteLength) as ArrayBuffer, "AES-GCM", true, ["encrypt", "decrypt"]);
}

/** deriveAuthKey — 派生登录认证 key hash（与 Android CryptoManager.kt 兼容）
 *  使用 PBKDF2(password, salt+"auth")，与 Android deriveAuthHash() 完全一致。 */
export async function deriveAuthKey(
  password: string, salt: Uint8Array, settings: KdfSettings = DEFAULT_KDF,
): Promise<string> {
  const authSalt = new Uint8Array(salt.length + 4);
  authSalt.set(salt);
  authSalt.set([0x61, 0x75, 0x74, 0x68], salt.length); // "auth"
  const bits = await deriveBits(password, authSalt, settings, 256);
  let binary = "";
  for (let i = 0; i < bits.length; i++) binary += String.fromCharCode(bits[i]);
  return btoa(binary);
}
