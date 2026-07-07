/**
 * PBKDF2-HMAC-SHA256 密钥派生
 *
 * 派生两条不同的密钥材料：
 *   - deriveKey() → AES-256 密钥，用于加密 masterKey（passwordWrapped）
 *   - deriveKeyHash() → 发给服务器的 auth_key_hash（认证用）
 *
 * 两者使用不同的推导上下文，防止服务器 auth_key_hash 被用于解密 passwordWrapped。
 * 与 Android CryptoManager.deriveKey() / deriveAuthHash() 完全一致。
 */
import { PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, SALT_LENGTH } from "../config/constants";

/** 生成随机盐 (32 字节) */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return salt;
}

/** PBKDF2-HMAC-SHA256 派生 AES-256 密钥（用于加密 masterKey） */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const bits = await deriveBits(password, salt);
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(bits as ArrayBuffer) as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

/** 计算 PBKDF2 哈希的 Base64 字符串（用于发送给服务器的 auth_key_hash）。
 *  使用与 deriveKey 不同的 salt 域，防止服务器端的哈希被用于解密。 */
export async function deriveKeyHash(
  password: string,
  salt: Uint8Array,
): Promise<string> {
  // 认证用 salt = 原始 salt + "auth" 后缀，确保与加密密钥的推导路径不同
  const authSalt = new Uint8Array(salt.length + 4);
  authSalt.set(salt);
  authSalt.set([0x61, 0x75, 0x74, 0x68], salt.length); // "auth"
  const bits = await deriveBits(password, authSalt);
  return bytesToBase64(new Uint8Array(bits as ArrayBuffer));
}

/** 底层 PBKDF2 deriveBits */
async function deriveBits(
  password: string,
  salt: Uint8Array,
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH,
  );
}

// Base64 工具
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
