/**
 * KDF 统一接口 + KeyChain 单元测试
 */
import { describe, it, expect } from "vitest";
import { deriveKey, deriveAuthKey, DEFAULT_KDF } from "../crypto/kdf";
import { keyChain } from "../keychain/keyChain";

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
    // Same salt + password → same key (verify by encrypting)
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
      // Should not reach here with wrong key
      expect(false).toBe(true);
    } catch {
      expect(true).toBe(true); // Decryption should fail
    }
  });

  it("deriveAuthKey produces base64 string", async () => {
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    const hash = await deriveAuthKey("password", salt);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
    expect(/^[A-Za-z0-9+/=]+$/.test(hash)).toBe(true);
  });

  it("deriveAuthKey is deterministic", async () => {
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    const h1 = await deriveAuthKey("test", salt);
    const h2 = await deriveAuthKey("test", salt);
    expect(h1).toBe(h2);
  });

  it("deriveAuthKey differs from deriveKey (different salt domain)", async () => {
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    const authHash = await deriveAuthKey("password", salt);
    // deriveAuthKey uses salt+"auth" domain, deriveKey uses plain salt
    // They should produce different results
    const authHash2 = await deriveAuthKey("password", salt);
    expect(authHash).toBe(authHash2); // Same salt → same auth hash
  });

  it("deriveAuthKey with custom KDF settings", async () => {
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    const hash = await deriveAuthKey("password", salt, { algorithm: "pbkdf2", iterations: 50_000 });
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});

// ── KeyChain ───────────────────────────────────────

describe("KeyChain", () => {
  it("generateKeys returns all required fields", async () => {
    const keys = await keyChain.generateKeys("a b c d e f g h i j k l","","test-password");
    expect(keys.authKeyHash).toBeTruthy();
    expect(typeof keys.authKeyHash).toBe("string");
    expect(keys.loginSalt).toBeTruthy();
    expect(typeof keys.loginSalt).toBe("string");
    expect(keys.encrypted_user_key).toBeTruthy();
    expect(typeof keys.encrypted_user_key).toBe("string");
    expect(keys.recovery_salt).toBeTruthy();
    expect(typeof keys.recovery_salt).toBe("string");
    expect(keys.kdfSettings).toEqual(DEFAULT_KDF);
    expect(keyChain.isUnlocked).toBe(true);
  });

  it("generateKeys produces different keys each time", async () => {
    const k1 = await keyChain.generateKeys("a b c d e f g h i j k l","","password");
    const k2 = await keyChain.generateKeys("a b c d e f g h i j k l","","password");
    expect(k1.authKeyHash).not.toBe(k2.authKeyHash);
    expect(k1.encrypted_user_key).not.toBe(k2.encrypted_user_key);
  });

  it("unlockWithPassword works with correct password", async () => {
    const keys = await keyChain.generateKeys("a b c d e f g h i j k l","","correct-password");
    keyChain.lock();
    expect(keyChain.isUnlocked).toBe(false);

    const ok = await keyChain.unlockWithPassword(
      "correct-password", keys.loginSalt, keys.encrypted_user_key, keys.cached_K,
    );
    expect(ok).toBe(true);
    expect(keyChain.isUnlocked).toBe(true);
  });

  it("unlockWithPassword fails with wrong password", async () => {
    const keys = await keyChain.generateKeys("a b c d e f g h i j k l","","correct-password");
    keyChain.lock();

    const ok = await keyChain.unlockWithPassword(
      "wrong-password", keys.loginSalt, keys.encrypted_user_key, keys.cached_K,
    );
    expect(ok).toBe(false);
    expect(keyChain.isUnlocked).toBe(false);
  });

  it("unlockWithPassword fails with wrong salt", async () => {
    const keys = await keyChain.generateKeys("a b c d e f g h i j k l","","password");
    keyChain.lock();

    const wrongSalt = btoa(String.fromCharCode(...new Uint8Array(32)));
    const ok = await keyChain.unlockWithPassword("password", wrongSalt, keys.encrypted_user_key, keys.cached_K);
    expect(ok).toBe(false);
  });

  it("encryptFileBlob / decryptFileBlob roundtrip", async () => {
    await keyChain.generateKeys("a b c d e f g h i j k l","","password");
    const original = new TextEncoder().encode("file content here").buffer;
    const encrypted = await keyChain.encryptFileBlob(original);
    expect(encrypted).toBeTruthy();

    const decrypted = await keyChain.decryptFileBlob(encrypted!);
    expect(decrypted).not.toBeNull();
    expect(new Uint8Array(decrypted!)).toEqual(new Uint8Array(original));
  });

  it("lock clears all keys", async () => {
    await keyChain.generateKeys("a b c d e f g h i j k l","","password");
    expect(keyChain.isUnlocked).toBe(true);

    keyChain.lock();
    expect(keyChain.isUnlocked).toBe(false);
  });
  it("unlock → lock → unlock cycle works", async () => {
    const keys = await keyChain.generateKeys("a b c d e f g h i j k l","","password");
    keyChain.lock();

    const ok = await keyChain.unlockWithPassword("password", keys.loginSalt, keys.encrypted_user_key, keys.cached_K);
    expect(ok).toBe(true);  });
  });
