/**
 * AES-256-GCM 加解密
 * 与 Android CryptoManager.aesEncrypt/aesDecrypt 完全一致
 * 格式：nonce(12) + ciphertext → Base64
 *
 * 所有加密操作绑定上下文 AAD，防止密文被移动到其他字段解密。
 */
import { GCM_NONCE_LENGTH, GCM_TAG_LENGTH } from "../config/constants";

const AES_AAD = new TextEncoder().encode("safebox-aes");

/**
 * AES-256-GCM 加密
 * 输出格式: Base64(nonce + ciphertext)
 */
export async function aesEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<string> {
  const nonce = new Uint8Array(GCM_NONCE_LENGTH);
  crypto.getRandomValues(nonce);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, tagLength: GCM_TAG_LENGTH, additionalData: AES_AAD },
    key,
    plaintext as BufferSource,
  );
  // nonce + ciphertext
  const ct = new Uint8Array(ciphertext as ArrayBuffer);
  const result = new Uint8Array(nonce.length + ct.length);
  result.set(nonce, 0);
  result.set(ct, nonce.length);
  return bytesToBase64(result);
}

/**
 * AES-256-GCM 解密
 * 输入: Base64(nonce + ciphertext)
 * 失败返回 null
 */
export async function aesDecrypt(
  key: CryptoKey,
  encoded: string,
): Promise<Uint8Array | null> {
  try {
    const data = base64ToBytes(encoded);
    if (data.length < GCM_NONCE_LENGTH + 1) return null;
    const nonce = data.slice(0, GCM_NONCE_LENGTH) as BufferSource;
    const ciphertext = data.slice(GCM_NONCE_LENGTH) as BufferSource;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, tagLength: GCM_TAG_LENGTH, additionalData: AES_AAD },
      key,
      ciphertext as BufferSource,
    );
    return new Uint8Array(plaintext as ArrayBuffer);
  } catch {
    return null;
  }
}

/** AES-256-GCM 加密字符串 */
export async function aesEncryptString(
  key: CryptoKey,
  plaintext: string,
): Promise<string> {
  return aesEncrypt(key, new TextEncoder().encode(plaintext));
}

/** AES-256-GCM 解密字符串 */
export async function aesDecryptString(
  key: CryptoKey,
  encoded: string,
): Promise<string | null> {
  const bytes = await aesDecrypt(key, encoded);
  if (!bytes) return null;
  return new TextDecoder().decode(bytes);
}

/** 生成随机 AES-256 密钥 */
export async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable — 需要导出为 raw 进行 wrap
    ["encrypt", "decrypt"],
  );
}

/** 导出 AES 密钥为 raw bytes → Base64 */
export async function exportAesKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToBase64(new Uint8Array(raw as ArrayBuffer));
}

/** 从 raw bytes Base64 导入 AES 密钥 */
export async function importAesKey(base64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64);
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    "AES-GCM",
    false, // 不可提取 — 密钥仅存内存
    ["encrypt", "decrypt"],
  );
}

// ── 字段级 AAD 加密（v2 新增）─────────────────────────

/** AAD 拼接规则：itemType:fieldName（如 login:name, credit_card:data）。
 *  不同 itemType 的 data 字段 AAD 不同，防止密文跨类型移动。 */
export function makeFieldAAD(fieldName: string, itemType?: string): Uint8Array {
  const ctx = itemType ? `safebox:v2:item:${fieldName}:${itemType}`
                       : `safebox:v2:item:${fieldName}`;
  return new TextEncoder().encode(ctx);
}

/**
 * AES-256-GCM 加密（字段级 AAD）
 * 输出格式: Base64(nonce(12) + ciphertext)
 */
export async function aesEncryptField(
  key: CryptoKey,
  plaintext: Uint8Array,
  fieldName: string,
  itemType?: string,
): Promise<string> {
  const aad = makeFieldAAD(fieldName, itemType);
  const nonce = new Uint8Array(GCM_NONCE_LENGTH);
  crypto.getRandomValues(nonce);
  const iv = nonce.buffer.slice(nonce.byteOffset, nonce.byteOffset + nonce.byteLength) as ArrayBuffer;
  const ad = aad.buffer.slice(aad.byteOffset, aad.byteOffset + aad.byteLength) as ArrayBuffer;
  const pt = plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv, tagLength: GCM_TAG_LENGTH, additionalData: ad },
    key,
    pt,
  ) as ArrayBuffer;
  const ct = new Uint8Array(ciphertext);
  const result = new Uint8Array(nonce.length + ct.length);
  result.set(nonce, 0);
  result.set(ct, nonce.length);
  return bytesToBase64(result);
}

/**
 * AES-256-GCM 解密（字段级 AAD）
 * 失败返回 null（GCM 标签校验失败或格式不匹配）
 */
export async function aesDecryptField(
  key: CryptoKey,
  encoded: string,
  fieldName: string,
  itemType?: string,
): Promise<Uint8Array | null> {
  try {
    const aad = makeFieldAAD(fieldName, itemType);
    const data = base64ToBytes(encoded);
    if (data.length < GCM_NONCE_LENGTH + 1) return null;
    const nonce = data.slice(0, GCM_NONCE_LENGTH);
    const ciphertext = data.slice(GCM_NONCE_LENGTH);
    const iv = nonce.buffer.slice(nonce.byteOffset, nonce.byteOffset + nonce.byteLength) as ArrayBuffer;
    const ct = ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer;
    const ad = aad.buffer.slice(aad.byteOffset, aad.byteOffset + aad.byteLength) as ArrayBuffer;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv, tagLength: GCM_TAG_LENGTH, additionalData: ad },
      key,
      ct,
    ) as ArrayBuffer;
    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}

// ── Base64 工具 ────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
