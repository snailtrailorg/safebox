/**
 * PBKDF2-HMAC-SHA256 密钥派生
 * 与 Android CryptoManager.deriveKey() 完全一致
 */
import { PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, SALT_LENGTH } from "../config/constants";

/** 生成随机盐 (32 字节) */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return salt;
}

/** PBKDF2-HMAC-SHA256 派生 AES-256 密钥 */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  // 1. importKey 为 PBKDF2 raw 格式
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  // 2. deriveBits 获取原始 256 位（与 Android PBEKeySpec 一致）
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH,
  );
  // 3. importKey 为 AES-GCM
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(bits as ArrayBuffer) as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

/** 计算 PBKDF2 哈希的 Base64 字符串（用于发送给服务器的 password_hash） */
export async function deriveKeyHash(
  password: string,
  salt: Uint8Array,
): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH,
  );
  return bytesToBase64(new Uint8Array(bits as ArrayBuffer));
}

// Base64 工具（内联，避免循环依赖）
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
