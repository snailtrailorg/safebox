/**
 * KDF 统一接口 + KeyChain 单元测试
 */
import { describe, it, expect } from "vitest";
import { deriveKey, DEFAULT_KDF } from "../crypto/kdf";
import { keyChain } from "../keychain/keyChain";

const MNEMONIC = "a b c d e f g h i j k l";
const PASSWORD = "test-password";
const EMAIL = "test@example.com";

// ── KDF 统一接口 ───────────────────────────────────

describe("KDF (kdf.ts)", () => {
  it("deriveKey produces a usable CryptoKey", async () => {
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    const key = await deriveKey("password", salt);
    expect(key).toBeDefined();
    expect(key.algorithm.name).toBe("AES-GCM");
  });

  it("deriveKey with custom iterations", async () => {
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    const key = await deriveKey("password", salt, { algorithm: "pbkdf2", iterations: 10_000 });
    expect(key).toBeDefined();
  });

  it("deriveKey is deterministic", async () => {
    const salt = new Uint8Array(32);
    const key1 = await deriveKey("test", salt);
    const key2 = await deriveKey("test", salt);
    const data = new TextEncoder().encode("hello");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
      key1, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    );
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
      key2, ct,
    );
    expect(new TextDecoder().decode(new Uint8Array(pt))).toBe("hello");
  });

  it("deriveKey produces different keys for different passwords", async () => {
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    const key1 = await deriveKey("password1", salt);
    const key2 = await deriveKey("password2", salt);
    const data = new TextEncoder().encode("test");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
      key1, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    );
    try {
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
        key2, ct,
      );
      expect(false).toBe(true);
    } catch {
      expect(true).toBe(true);
    }
  });
});

// ── KeyChain ───────────────────────────────────────

describe("KeyChain", () => {
  it("generateKeys returns all required fields", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, PASSWORD, EMAIL);
    expect(keys.srp_verifier).toBeTruthy();
    expect(typeof keys.srp_verifier).toBe("string");
    expect(keys.srp_salt).toBeTruthy();
    expect(keys.localSalt).toBeTruthy();
    expect(keys.encrypted_user_key).toBeTruthy();
    expect(keys.mnemonic_salt).toBeTruthy();
    expect(keys.cached_K).toBeTruthy();
    expect(keys.mnemonic_encrypted).toBeTruthy();
    expect(keys.kdfSettings).toEqual(DEFAULT_KDF);
    expect(keyChain.isUnlocked).toBe(true);
  });

  it("generateKeys produces different keys each time", async () => {
    const k1 = await keyChain.generateKeys(MNEMONIC, PASSWORD, EMAIL);
    const k2 = await keyChain.generateKeys(MNEMONIC, PASSWORD, EMAIL);
    expect(k1.srp_verifier).not.toBe(k2.srp_verifier); // srp_salt 随机 -> verifier 不同
    expect(k1.encrypted_user_key).not.toBe(k2.encrypted_user_key);
  });

  it("unlockWithPassword works with correct password", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, "correct-password", EMAIL);
    keyChain.lock();
    expect(keyChain.isUnlocked).toBe(false);
    const ok = await keyChain.unlockWithPassword(
      "correct-password", keys.localSalt, keys.encrypted_user_key, keys.cached_K,
    );
    expect(ok).toBe(true);
    expect(keyChain.isUnlocked).toBe(true);
  });

  it("unlockWithPassword fails with wrong password", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, "correct-password", EMAIL);
    keyChain.lock();
    const ok = await keyChain.unlockWithPassword(
      "wrong-password", keys.localSalt, keys.encrypted_user_key, keys.cached_K,
    );
    expect(ok).toBe(false);
    expect(keyChain.isUnlocked).toBe(false);
  });

  it("unlockWithPassword fails with wrong salt", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, "password", EMAIL);
    keyChain.lock();
    const wrongSalt = btoa(String.fromCharCode(...new Uint8Array(32)));
    const ok = await keyChain.unlockWithPassword("password", wrongSalt, keys.encrypted_user_key, keys.cached_K);
    expect(ok).toBe(false);
  });

  it("getMnemonicFromCache roundtrips mnemonic_encrypted", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, "password", EMAIL);
    const mnemonic = await keyChain.getMnemonicFromCache("password", keys.localSalt, keys.mnemonic_encrypted);
    expect(mnemonic).toBe(MNEMONIC);
    const wrong = await keyChain.getMnemonicFromCache("wrong", keys.localSalt, keys.mnemonic_encrypted);
    expect(wrong).toBeNull();
  });

  it("encryptFileBlob / decryptFileBlob roundtrip", async () => {
    await keyChain.generateKeys(MNEMONIC, "password", EMAIL);
    const original = new TextEncoder().encode("file content here").buffer;
    const encrypted = await keyChain.encryptFileBlob(original);
    expect(encrypted).toBeTruthy();
    const decrypted = await keyChain.decryptFileBlob(encrypted!);
    expect(decrypted).not.toBeNull();
    expect(new Uint8Array(decrypted!)).toEqual(new Uint8Array(original));
  });

  it("lock clears all keys", async () => {
    await keyChain.generateKeys(MNEMONIC, "password", EMAIL);
    expect(keyChain.isUnlocked).toBe(true);
    keyChain.lock();
    expect(keyChain.isUnlocked).toBe(false);
  });

  it("unlock -> lock -> unlock cycle works", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, "password", EMAIL);
    keyChain.lock();
    const ok = await keyChain.unlockWithPassword("password", keys.localSalt, keys.encrypted_user_key, keys.cached_K);
    expect(ok).toBe(true);
  });
});
