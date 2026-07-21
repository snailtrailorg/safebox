/**
 * KDF 统一接口
 *
 * 支持 PBKDF2 / Argon2id，参数可配置、跟随账户存储。
 * 加密路径: deriveKey -> PBKDF2(password, salt) -> 包裹/解包 User Key、本地缓存 K、mnemonic 缓存
 *
 * 认证走 SRP-6a（crypto/srp.ts），不再使用 deriveAuthKey/bcrypt。
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
  // Argon2id - 暂未实现，fallback 到 PBKDF2
  throw new Error("argon2id KDF not yet supported");
}

/** deriveKey - 派生 AES-256 加密密钥（用于包裹/解包 User Key、本地缓存 K、mnemonic 缓存） */
export async function deriveKey(
  password: string, salt: Uint8Array, settings: KdfSettings = DEFAULT_KDF,
): Promise<CryptoKey> {
  const bits = await deriveBits(password, salt, settings, 256);
  return crypto.subtle.importKey("raw", bits.buffer.slice(bits.byteOffset, bits.byteOffset + bits.byteLength) as ArrayBuffer, "AES-GCM", true, ["encrypt", "decrypt"]);
}
