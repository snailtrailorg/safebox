/** 加密常量 — 与 Android CryptoManager.kt 完全一致 */

export const PBKDF2_ITERATIONS = 100_000;
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

// Google OAuth — 在 Google Cloud Console 创建 Web 应用 OAuth 2.0 客户端 ID
// https://console.cloud.google.com/apis/credentials
export const GOOGLE_CLIENT_ID = "1081355276099-7vt4a4rbvshbf48ga4nj9vpitc6ap2tp.apps.googleusercontent.com";
