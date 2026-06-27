/**
 * RSA-4096 OAEP-SHA256 加解密
 * 与 Android CryptoManager.rsaEncrypt/rsaDecrypt 完全一致
 *
 * 加密: 分块 RSA-OAEP (每块 470 字节) → 拼接 → Base64
 * 解密: Base64 解码 → 分块解密 (每块 512 字节) → 拼接 → UTF-8
 */
import { RSA_KEY_LENGTH, RSA_CHUNK_SIZE, RSA_DECRYPT_CHUNK } from "../config/constants";
import { bytesToBase64, base64ToBytes } from "./aes";

/** 生成 RSA-4096 密钥对 */
export async function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: RSA_KEY_LENGTH,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true, // extractable — 需要导出
    ["encrypt", "decrypt"],
  );
}

/** 导出公钥为 SPKI Base64 */
export async function encodePublicKey(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", key);
  return bytesToBase64(new Uint8Array(spki as ArrayBuffer));
}

/** 导出私钥为 PKCS8 Base64 */
export async function encodePrivateKey(key: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", key);
  return bytesToBase64(new Uint8Array(pkcs8 as ArrayBuffer));
}

/** 从 SPKI Base64 导入公钥 */
export async function decodePublicKey(encoded: string): Promise<CryptoKey | null> {
  try {
    const bytes = base64ToBytes(encoded);
    return crypto.subtle.importKey(
      "spki",
      bytes as BufferSource,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false, // 不需要 extractable
      ["encrypt"],
    );
  } catch {
    return null;
  }
}

/** 从 PKCS8 Base64 导入私钥 */
export async function decodePrivateKey(encoded: string): Promise<CryptoKey | null> {
  try {
    const bytes = base64ToBytes(encoded);
    return crypto.subtle.importKey(
      "pkcs8",
      bytes as BufferSource,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false, // 私钥不可提取
      ["decrypt"],
    );
  } catch {
    return null;
  }
}

/**
 * RSA-OAEP 加密（分块）
 * 与 Android rsaEncrypt 一致: 每块 470 字节
 */
export async function rsaEncrypt(
  publicKey: CryptoKey,
  plaintext: string,
): Promise<string | null> {
  try {
    const data = new TextEncoder().encode(plaintext);
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (offset < data.length) {
      const chunkSize = Math.min(RSA_CHUNK_SIZE, data.length - offset);
      const chunk = data.slice(offset, offset + chunkSize);
      const encrypted = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        publicKey,
        chunk as BufferSource,
      );
      chunks.push(new Uint8Array(encrypted as ArrayBuffer));
      offset += RSA_CHUNK_SIZE;
    }
    // 拼接所有块
    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      result.set(c, pos);
      pos += c.length;
    }
    return bytesToBase64(result);
  } catch {
    return null;
  }
}

/**
 * RSA-OAEP 解密（分块）
 * 与 Android rsaDecrypt 一致: 每块 512 字节
 */
export async function rsaDecrypt(
  privateKey: CryptoKey,
  encoded: string,
): Promise<string | null> {
  try {
    const data = base64ToBytes(encoded);
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (offset < data.length) {
      const len = Math.min(RSA_DECRYPT_CHUNK, data.length - offset);
      const chunk = data.slice(offset, offset + len);
      const decrypted = await crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        privateKey,
        chunk as BufferSource,
      );
      chunks.push(new Uint8Array(decrypted as ArrayBuffer));
      offset += RSA_DECRYPT_CHUNK;
    }
    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      result.set(c, pos);
      pos += c.length;
    }
    return new TextDecoder().decode(result);
  } catch {
    return null;
  }
}
