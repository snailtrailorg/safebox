/** 加密常量 — 与 Android CryptoManager.kt 完全一致 */

export const PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_KEY_LENGTH = 256;
export const SALT_LENGTH = 32;

export const AES_KEY_LENGTH = 256;
export const GCM_NONCE_LENGTH = 12;
export const GCM_TAG_LENGTH = 128;

export const RSA_KEY_LENGTH = 4096;
// OAEP SHA-256: 512 - 2*32 - 2 = 446 字节（理论最大值）
// Android BouncyCastle 可能允许更大值，待交叉验证
export const RSA_CHUNK_SIZE = 446;
export const RSA_DECRYPT_CHUNK = 512; // 解密分块

export const DEVICE_KEY_ALIAS = "safebox_device_key";
