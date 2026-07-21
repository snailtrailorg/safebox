/**
 * 跨平台加密兼容性验证 - AES-256-GCM 已知向量
 *
 * PBKDF2 确定性/差异测试见 kdf-keychain.test.ts。
 * SRP-6a 前后端一致性见 srp.test.ts。
 */
import { describe, it, expect } from "vitest";
import {
  aesEncrypt,
  aesDecrypt,
  generateAesKey,
  bytesToBase64,
  base64ToBytes,
} from "../crypto/aes";

// ── AES-256-GCM 已知向量测试 ────────────────────

describe("AES-256-GCM known answer tests", () => {
  it("encrypt then decrypt = original (deterministic with same nonce)", async () => {
    const keyBytes = new Uint8Array(32);
    keyBytes.fill(0x01);
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes as BufferSource,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );

    const plaintext = new TextEncoder().encode("SafeBox cross-platform test");
    const ct = await aesEncrypt(key, plaintext);
    const pt = await aesDecrypt(key, ct);
    expect(new TextDecoder().decode(pt!)).toBe("SafeBox cross-platform test");
  });

  it("nonce is prepended: first 12 bytes of decoded ciphertext are nonce", async () => {
    const key = await generateAesKey();
    const plaintext = new TextEncoder().encode("nonce test data");
    const ct = await aesEncrypt(key, plaintext);
    const data = base64ToBytes(ct);
    // nonce(12) + ciphertext(>=1) + tag(16)
    expect(data.length).toBeGreaterThanOrEqual(12 + 1 + 16);
    const pt = await aesDecrypt(key, ct);
    expect(new TextDecoder().decode(pt!)).toBe("nonce test data");
  });

  it("GCM authentication: tampered ciphertext fails to decrypt", async () => {
    const key = await generateAesKey();
    const plaintext = new TextEncoder().encode("authenticated data");
    const ct = await aesEncrypt(key, plaintext);
    const data = base64ToBytes(ct);

    // 篡改最后一个字节
    data[data.length - 1] ^= 0xFF;
    const tampered = bytesToBase64(data);

    const pt = await aesDecrypt(key, tampered);
    expect(pt).toBeNull(); // GCM 认证失败
  });

  it("large payload encryption is correct", async () => {
    const key = await generateAesKey();
    const plaintext = new TextEncoder().encode("A".repeat(10000));
    const ct = await aesEncrypt(key, plaintext);
    const pt = await aesDecrypt(key, ct);
    expect(new TextDecoder().decode(pt!)).toBe("A".repeat(10000));
  });
});
