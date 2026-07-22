/**
 * transport.ts K 通信加密测试（AES-256-GCM，与后端 transport_crypto.py 一致）
 */
import { describe, it, expect } from "vitest";
import { encryptBody, decryptBody } from "../crypto/transport";

describe("transport K 通信加密", () => {
  const K = new Uint8Array(32);
  for (let i = 0; i < 32; i++) K[i] = i;

  it("encryptBody/decryptBody round-trip（含中文/emoji）", async () => {
    const plaintext = new TextEncoder().encode("hello safebox 🔐 密文");
    const enc = await encryptBody(K, plaintext);
    const dec = await decryptBody(K, enc);
    expect(dec).toEqual(plaintext);
  });

  it("decryptBody 篡改密文 throw（GCM tag 认证）", async () => {
    const plaintext = new TextEncoder().encode("secret");
    const enc = await encryptBody(K, plaintext);
    const tampered = new Uint8Array(enc);
    tampered[tampered.length - 1] ^= 0xff;  // 篡改 tag
    await expect(decryptBody(K, tampered)).rejects.toThrow();
  });

  it("decryptBody 错 K throw", async () => {
    const plaintext = new TextEncoder().encode("secret");
    const enc = await encryptBody(K, plaintext);
    const wrongK = new Uint8Array(32);  // 全 0
    await expect(decryptBody(wrongK, enc)).rejects.toThrow();
  });

  it("encryptBody 每次不同 nonce（防重放）", async () => {
    const plaintext = new TextEncoder().encode("same");
    const enc1 = await encryptBody(K, plaintext);
    const enc2 = await encryptBody(K, plaintext);
    expect(enc1).not.toEqual(enc2);
    expect(await decryptBody(K, enc1)).toEqual(plaintext);
    expect(await decryptBody(K, enc2)).toEqual(plaintext);
  });
});
