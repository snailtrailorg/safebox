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

/** GCM nonce 长度，与 AES-GCM 默认一致；显式命名以免两端魔法数字漂移 */
const NONCE_LENGTH = 12;

/** 加密 plaintext -> nonce(12) + ciphertext+tag（Uint8Array，与后端一致） */
export async function encryptBody(K: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const key = await importK(K);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, plaintext as BufferSource);
  const result = new Uint8Array(nonce.length + ct.byteLength);
  result.set(nonce, 0);
  result.set(new Uint8Array(ct), nonce.length);
  return result;
}

/** 解密 nonce(12) + ciphertext+tag -> plaintext。失败抛异常。 */
export async function decryptBody(K: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // 显式长度校验：GCM 对 iv 长度有要求（12 字节），且密文体至少要有 1 字节
  // （16 字节 tag 是隐含下限，交给 WebCrypto 判）。这里先拦掉"根本不是密文"的输入，
  // 让错误信息能区分「传输体被截断」与「密钥不对」。
  if (data.length < NONCE_LENGTH + 1) {
    throw new Error(
      `transport_decrypt_body_too_short: got ${data.length} bytes, need >= ${NONCE_LENGTH + 1}`,
    );
  }
  const key = await importK(K);
  const nonce = data.slice(0, NONCE_LENGTH);
  const ct = data.slice(NONCE_LENGTH);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, ct as BufferSource);
  return new Uint8Array(pt);
}

/** hex 字符串 <-> Uint8Array */
export function hexToBytes(hex: string): Uint8Array {
  // 严格校验：奇数长度会被 parseInt 静默丢半字节；非 hex 字符会让 parseInt 返回 NaN，
  // 而 NaN 写入 Uint8Array 会静默变成 0 —— 两者都是"看着成功的错值"，
  // 在加密路径上尤其危险（错误的 K / nonce 不会报错，只会解出乱码）。
  if (hex.length % 2 !== 0) {
    throw new Error(`hex_to_bytes_odd_length: ${hex.length}`);
  }
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("hex_to_bytes_invalid_chars");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
