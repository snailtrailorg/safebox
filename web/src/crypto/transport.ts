/**
 * SRP K 通信加密（对标 1Password SRP+GCM 传输层）
 *
 * K = H(S)（SRP 握手派生，32 字节）。AES-256-GCM。
 * 格式：nonce(12) + ciphertext + tag(16)，与后端 transport_crypto.py 一致。
 */

/** K（32 字节 Uint8Array）-> CryptoKey（AES-GCM，加解密用） */
async function importK(K: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", K as unknown as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** 加密 plaintext -> nonce(12) + ciphertext+tag（Uint8Array，与后端一致） */
export async function encryptBody(K: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const key = await importK(K);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, plaintext as BufferSource);
  const result = new Uint8Array(nonce.length + ct.byteLength);
  result.set(nonce, 0);
  result.set(new Uint8Array(ct), nonce.length);
  return result;
}

/** 解密 nonce(12) + ciphertext+tag -> plaintext。失败抛异常。 */
export async function decryptBody(K: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await importK(K);
  const nonce = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, ct as BufferSource);
  return new Uint8Array(pt);
}

/** hex 字符串 <-> Uint8Array */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
