/**
 * 加密层单元测试 — PBKDF2 / AES-256-GCM / RSA-4096-OAEP / BIP39
 */
import { describe, it, expect } from "vitest";
import {
  generateSalt,
  deriveKey,
  deriveAuthKey,
} from "../crypto/kdf";
import {
  aesEncrypt,
  aesDecrypt,
  aesEncryptString,
  aesDecryptString,
  generateAesKey,
  exportAesKey,
  importAesKey,
  bytesToBase64,
  base64ToBytes,
} from "../crypto/aes";
import {
  generateRsaKeyPair,
  encodePublicKey,
  encodePrivateKey,
  decodePublicKey,
  decodePrivateKey,
  rsaEncrypt,
  rsaDecrypt,
} from "../crypto/rsa";

// ── Base64 工具 ──────────────────────────────────

describe("Base64 utils", () => {
  it("bytesToBase64 / base64ToBytes roundtrip", () => {
    const original = new Uint8Array([0, 1, 2, 255, 128, 64, 32]);
    const encoded = bytesToBase64(original);
    const decoded = base64ToBytes(encoded);
    expect(decoded).toEqual(original);
  });

  it("empty array roundtrip", () => {
    const original = new Uint8Array(0);
    const encoded = bytesToBase64(original);
    const decoded = base64ToBytes(encoded);
    expect(decoded).toEqual(original);
  });

  it("base64 output is valid string", () => {
    const data = new Uint8Array(32);
    crypto.getRandomValues(data);
    const encoded = bytesToBase64(data);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);
    // Base64 不应包含非 ASCII 字符
    expect(/^[A-Za-z0-9+/=]+$/.test(encoded)).toBe(true);
  });
});

// ── PBKDF2 ───────────────────────────────────────

describe("PBKDF2", () => {
  it("generateSalt produces 32 bytes", () => {
    const salt = generateSalt();
    expect(salt.length).toBe(32);
  });

  it("generateSalt produces different values", () => {
    const s1 = generateSalt();
    const s2 = generateSalt();
    expect(s1).not.toEqual(s2);
  });

  it("deriveKey produces same key for same inputs", async () => {
    const password = "test-password-123";
    const salt = generateSalt();
    const key1 = await deriveKey(password, salt);
    const key2 = await deriveKey(password, salt);
    // CryptoKey 不能直接比较，但两次推导应该都能加解密
    const plaintext = new TextEncoder().encode("hello");
    const ct1 = await aesEncrypt(key1, plaintext);
    const pt2 = await aesDecrypt(key2, ct1);
    expect(new TextDecoder().decode(pt2!)).toBe("hello");
  });

  it("deriveKey produces different key for different passwords", async () => {
    const salt = generateSalt();
    const key1 = await deriveKey("password1", salt);
    const key2 = await deriveKey("password2", salt);
    const plaintext = new TextEncoder().encode("test");
    const ct = await aesEncrypt(key1, plaintext);
    const pt = await aesDecrypt(key2, ct);
    expect(pt).toBeNull(); // 不同密钥应该解密失败
  });

  it("deriveAuthKey produces base64 string", async () => {
    const salt = generateSalt();
    const hash = await deriveAuthKey("password", salt);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
    expect(/^[A-Za-z0-9+/=]+$/.test(hash)).toBe(true);
  });

  it("deriveAuthKey is deterministic", async () => {
    const salt = generateSalt();
    const h1 = await deriveAuthKey("test", salt);
    const h2 = await deriveAuthKey("test", salt);
    expect(h1).toBe(h2);
  });
});

// ── AES-256-GCM ──────────────────────────────────

describe("AES-256-GCM", () => {
  it("generateAesKey creates usable key", async () => {
    const key = await generateAesKey();
    expect(key).toBeDefined();
    expect(key.algorithm.name).toBe("AES-GCM");
  });

  it("exportAesKey / importAesKey roundtrip", async () => {
    const key = await generateAesKey();
    const exported = await exportAesKey(key);
    const imported = await importAesKey(exported);

    const plaintext = new TextEncoder().encode("roundtrip test");
    const ct = await aesEncrypt(key, plaintext);
    const pt = await aesDecrypt(imported, ct);
    expect(new TextDecoder().decode(pt!)).toBe("roundtrip test");
  });

  it("encrypt produces Base64(nonce + ciphertext)", async () => {
    const key = await generateAesKey();
    const plaintext = new TextEncoder().encode("hello world");
    const encoded = await aesEncrypt(key, plaintext);

    // 解码验证格式: nonce(12) + ciphertext
    const data = base64ToBytes(encoded);
    expect(data.length).toBeGreaterThan(12); // 至少 nonce + ciphertext
  });

  it("encrypt/decrypt roundtrip (bytes)", async () => {
    const key = await generateAesKey();
    const plaintext = new TextEncoder().encode("Hello, AES-256-GCM!");
    const ct = await aesEncrypt(key, plaintext);
    const pt = await aesDecrypt(key, ct);
    expect(new TextDecoder().decode(pt!)).toBe("Hello, AES-256-GCM!");
  });

  it("encrypt/decrypt roundtrip (string)", async () => {
    const key = await generateAesKey();
    const plaintext = "你好，世界！🔐";
    const ct = await aesEncryptString(key, plaintext);
    const pt = await aesDecryptString(key, ct);
    expect(pt).toBe(plaintext);
  });

  it("decrypt with wrong key returns null", async () => {
    const k1 = await generateAesKey();
    const k2 = await generateAesKey();
    const ct = await aesEncryptString(k1, "secret");
    const pt = await aesDecryptString(k2, ct);
    expect(pt).toBeNull();
  });

  it("decrypt invalid base64 returns null", async () => {
    const key = await generateAesKey();
    const pt = await aesDecryptString(key, "!!!invalid-base64!!!");
    expect(pt).toBeNull();
  });

  it("decrypt too-short data returns null", async () => {
    const key = await generateAesKey();
    const pt = await aesDecryptString(key, bytesToBase64(new Uint8Array([1, 2, 3])));
    expect(pt).toBeNull();
  });

  it("empty string roundtrip", async () => {
    const key = await generateAesKey();
    const ct = await aesEncryptString(key, "");
    const pt = await aesDecryptString(key, ct);
    expect(pt).toBe("");
  });

  it("large data roundtrip (100KB)", async () => {
    const key = await generateAesKey();
    const plaintext = "x".repeat(100_000);
    const ct = await aesEncryptString(key, plaintext);
    const pt = await aesDecryptString(key, ct);
    expect(pt).toBe(plaintext);
  });

  it("each encryption produces different ciphertext", async () => {
    const key = await generateAesKey();
    const plaintext = "same text";
    const ct1 = await aesEncryptString(key, plaintext);
    const ct2 = await aesEncryptString(key, plaintext);
    expect(ct1).not.toBe(ct2); // 不同 nonce
    // 但都能解密
    expect(await aesDecryptString(key, ct1)).toBe(plaintext);
    expect(await aesDecryptString(key, ct2)).toBe(plaintext);
  });
});

// ── RSA-4096 OAEP ────────────────────────────────

describe("RSA-4096 OAEP", () => {
  it("generateRsaKeyPair creates valid 4096-bit key", async () => {
    const pair = await generateRsaKeyPair();
    expect(pair.publicKey).toBeDefined();
    expect(pair.privateKey).toBeDefined();
    expect(pair.publicKey.algorithm.name).toBe("RSA-OAEP");
  });

  it("encodePublicKey / decodePublicKey roundtrip", async () => {
    const pair = await generateRsaKeyPair();
    const encoded = await encodePublicKey(pair.publicKey);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(500); // 4096-bit key should be >500 chars

    const decoded = await decodePublicKey(encoded);
    expect(decoded).not.toBeNull();
  });

  it("encodePrivateKey / decodePrivateKey roundtrip", async () => {
    const pair = await generateRsaKeyPair();
    const encoded = await encodePrivateKey(pair.privateKey);
    expect(typeof encoded).toBe("string");

    const decoded = await decodePrivateKey(encoded);
    expect(decoded).not.toBeNull();
  });

  it("rsaEncrypt / rsaDecrypt roundtrip (short text)", async () => {
    const pair = await generateRsaKeyPair();
    const plaintext = "Hello RSA!";
    const ct = await rsaEncrypt(pair.publicKey, plaintext);
    expect(ct).not.toBeNull();
    const pt = await rsaDecrypt(pair.privateKey, ct!);
    expect(pt).toBe(plaintext);
  });

  it("rsaEncrypt / rsaDecrypt roundtrip (with emoji)", async () => {
    const pair = await generateRsaKeyPair();
    const plaintext = "密码🔐测试";
    const ct = await rsaEncrypt(pair.publicKey, plaintext);
    expect(ct).not.toBeNull();
    const pt = await rsaDecrypt(pair.privateKey, ct!);
    expect(pt).toBe(plaintext);
  });

  it("rsaEncrypt / rsaDecrypt roundtrip (long text, chunked)", async () => {
    const pair = await generateRsaKeyPair();
    // 超过 446 字节的单块限制，测试分块加解密
    const plaintext = "A".repeat(2000); // ~2KB
    const ct = await rsaEncrypt(pair.publicKey, plaintext);
    expect(ct).not.toBeNull();
    const pt = await rsaDecrypt(pair.privateKey, ct!);
    expect(pt).toBe(plaintext);
  });

  it("rsaEncrypt / rsaDecrypt roundtrip (JSON data)", async () => {
    const pair = await generateRsaKeyPair();
    const data = JSON.stringify({
      username: "user@example.com",
      password: "correct-horse-battery-staple",
      url: "https://example.com/login",
    });
    const ct = await rsaEncrypt(pair.publicKey, data);
    expect(ct).not.toBeNull();
    const pt = await rsaDecrypt(pair.privateKey, ct!);
    expect(JSON.parse(pt!)).toEqual({
      username: "user@example.com",
      password: "correct-horse-battery-staple",
      url: "https://example.com/login",
    });
  });

  it("decrypt with wrong key returns null", async () => {
    const pair1 = await generateRsaKeyPair();
    const pair2 = await generateRsaKeyPair();
    const ct = await rsaEncrypt(pair1.publicKey, "secret");
    const pt = await rsaDecrypt(pair2.privateKey, ct!);
    expect(pt).toBeNull();
  });

  it("decodePublicKey with invalid input returns null", async () => {
    const key = await decodePublicKey("not-a-valid-key");
    expect(key).toBeNull();
  });

  it("decodePrivateKey with invalid input returns null", async () => {
    const key = await decodePrivateKey("not-a-valid-key");
    expect(key).toBeNull();
  });
});

// ── BIP39 恢复码 ─────────────────────────────────
// 恢复码由服务端生成（POST /auth/recovery/generate），Web 端不持有词表。
// 词表标准性校验见 server/tests/test_bip39.py。

// ── 跨模块集成测试 ───────────────────────────────

describe("Cross-module integration (matching Android KeyManager flow)", () => {
  it("full key hierarchy: password → derivedKey → AES wrap → RSA encrypt", async () => {
    // Step 1: 用户注册 — 生成密钥
    const password = "user-password-123";
    const salt = generateSalt();
    const derivedKey = await deriveKey(password, salt);
    const masterKey = await generateAesKey();
    const rsaPair = await generateRsaKeyPair();

    // Step 2: 用派生密钥包装主密钥
    const masterRaw = await crypto.subtle.exportKey("raw", masterKey);
    const passwordWrapped = await aesEncrypt(derivedKey, new Uint8Array(masterRaw as ArrayBuffer));
    expect(passwordWrapped).toBeTruthy();

    // Step 3: 用主密钥加密 RSA 私钥
    const rsaPrivEncoded = await encodePrivateKey(rsaPair.privateKey);
    const encryptedPrivate = await aesEncryptString(masterKey, rsaPrivEncoded);

    // Step 4: RSA 公钥
    const rsaPubEncoded = await encodePublicKey(rsaPair.publicKey);

    // ── 模拟用户重新登录 ─────────────────────────

    // Step 5: 用密码解锁主密钥
    const reDerivedKey = await deriveKey(password, salt);
    const masterRaw2 = await aesDecrypt(reDerivedKey, passwordWrapped);
    expect(masterRaw2).not.toBeNull();
    const reMasterKey = await crypto.subtle.importKey(
      "raw",
      masterRaw2! as BufferSource,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );

    // Step 6: 解密 RSA 私钥
    const rsaPrivDecrypted = await aesDecryptString(reMasterKey, encryptedPrivate);
    expect(rsaPrivDecrypted).not.toBeNull();
    const rePrivateKey = await decodePrivateKey(rsaPrivDecrypted!);
    expect(rePrivateKey).not.toBeNull();

    // Step 7: 用 RSA 加密/解密条目数据
    const itemData = JSON.stringify({ username: "alice", password: "s3cret!" });
    const encrypted = await rsaEncrypt(rsaPair.publicKey, itemData);
    expect(encrypted).not.toBeNull();
    const decrypted = await rsaDecrypt(rePrivateKey!, encrypted!);
    expect(JSON.parse(decrypted!)).toEqual({ username: "alice", password: "s3cret!" });
  });
});
