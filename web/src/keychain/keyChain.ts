/**
 * KeyChain - User Key 生命周期（模型 D 串行化）
 *
 * K = PBKDF2(恢复码 [+ 主密码], recovery_salt) - 永久，不存服务器
 * User Key = 随机 AES-256 - 包裹 Item Keys
 * encrypted_user_key = AES(K, User Key) - 存服务器
 * 登录密码只做认证 + 本地缓存 K
 */
import {
  generateAesKey, importAesKey,
  aesEncrypt, aesDecrypt, aesEncryptString, aesDecryptString,
  aesDecryptField,
  makeFieldAAD,
} from "../crypto/aes";
import { deriveKey, deriveAuthKey, type KdfSettings, DEFAULT_KDF } from "../crypto/kdf";
import type { ItemKey, EncryptedField } from "./types";

class KeyChain {
  private userKey: CryptoKey | null = null;

  get isUnlocked(): boolean { return this.userKey !== null; }

  // ── 注册时生成密钥 ──────────────────────────────

  async generateKeys(recoveryCode: string, masterPassword: string, loginPassword: string): Promise<{
    authKeyHash: string;
    loginSalt: string;
    encrypted_user_key: string;
    recovery_salt: string;
    cached_K: string;
    kdfSettings: KdfSettings;
  }> {
    const loginSalt = new Uint8Array(32);
    crypto.getRandomValues(loginSalt);
    const recoverySalt = new Uint8Array(32);
    crypto.getRandomValues(recoverySalt);

    // K = PBKDF2(恢复码 [+ 主密码], recovery_salt)
    const kSeed = recoveryCode + (masterPassword || "");
    const K = await deriveKey(kSeed, recoverySalt);

    // User Key（随机，不变）
    this.userKey = await generateAesKey();
    const userKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", this.userKey));

    // encrypted_user_key = AES(K, User Key) - 存服务器
    const encrypted_user_key = await aesEncrypt(K, userKeyRaw);

    // loginDerivedKey = PBKDF2(登录密码, loginSalt) - 本地缓存 K
    const loginDerivedKey = await deriveKey(loginPassword, loginSalt);
    // cached_K = AES(loginDerivedKey, K)，K 是派生的主密钥，不在服务器
    const kRaw = new Uint8Array(await crypto.subtle.exportKey("raw", K));
    const cached_K = await aesEncrypt(loginDerivedKey, kRaw);

    // authKey - 服务端认证
    const authKeyHash = await deriveAuthKey(loginPassword, loginSalt);

    const saltBase64 = this.bytesToBase64(loginSalt);
    const recSaltBase64 = this.bytesToBase64(recoverySalt);

    return {
      authKeyHash,
      loginSalt: saltBase64,
      encrypted_user_key,
      recovery_salt: recSaltBase64,
      cached_K,
      kdfSettings: DEFAULT_KDF,
    };
  }

  // ── 日常解锁（Web: 登录密码 -> loginDerivedKey -> K -> UserKey）─────────

  async unlockWithPassword(
    loginPassword: string,
    loginSaltBase64: string,
    encryptedUserKey: string,
    cached_K: string,
  ): Promise<boolean> {
    try {
      const loginSalt = this.base64ToBytes(loginSaltBase64);
      const loginDerivedKey = await deriveKey(loginPassword, loginSalt);
      // K = AES 解密(cached_K, loginDerivedKey)
      const kRaw = await aesDecrypt(loginDerivedKey, cached_K);
      if (!kRaw) return false;
      // User Key = AES 解密(encrypted_user_key, K)
      const ukRaw = await aesDecrypt(await importAesKey(this.bytesToBase64(kRaw)), encryptedUserKey);
      if (!ukRaw) return false;
      const buf = ukRaw.buffer.slice(ukRaw.byteOffset, ukRaw.byteOffset + ukRaw.byteLength) as ArrayBuffer;
      this.userKey = await crypto.subtle.importKey("raw", buf, "AES-GCM", true, ["encrypt", "decrypt"]);
      return true;
    } catch { return false; }
  }

  // ── 恢复码解锁（忘登录密码/换设备）─────────────────

  async unlockFromRecoveryCode(
    recoveryCode: string,
    masterPassword: string,
    recoverySaltBase64: string,
    encryptedUserKey: string,
  ): Promise<boolean> {
    try {
      const recoverySalt = this.base64ToBytes(recoverySaltBase64);
      const kSeed = recoveryCode + (masterPassword || "");
      const K = await deriveKey(kSeed, recoverySalt);
      const ukRaw = await aesDecrypt(K, encryptedUserKey);
      if (!ukRaw) return false;
      const buf = ukRaw.buffer.slice(ukRaw.byteOffset, ukRaw.byteOffset + ukRaw.byteLength) as ArrayBuffer;
      this.userKey = await crypto.subtle.importKey("raw", buf, "AES-GCM", true, ["encrypt", "decrypt"]);
      return true;
    } catch { return false; }
  }

  // ── 恢复码解锁 + 重包 cached_K（忘密码恢复流程专用）──

  /** 用恢复码派生 K -> 解 User Key 设到内存 + 用新登录密码重包 cached_K。
   *  一次派生 K，避免重复 PBKDF2。返回新 cached_K 供 saveSession。 */
  async recoverAndRewrap(
    recoveryCode: string,
    masterPassword: string,
    recoverySaltBase64: string,
    encryptedUserKey: string,
    newLoginPassword: string,
    newLoginSaltBase64: string,
  ): Promise<{ ok: boolean; newCachedK?: string }> {
    try {
      const recoverySalt = this.base64ToBytes(recoverySaltBase64);
      const kSeed = recoveryCode + (masterPassword || "");
      const K = await deriveKey(kSeed, recoverySalt);
      const ukRaw = await aesDecrypt(K, encryptedUserKey);
      if (!ukRaw) return { ok: false };
      const buf = ukRaw.buffer.slice(ukRaw.byteOffset, ukRaw.byteOffset + ukRaw.byteLength) as ArrayBuffer;
      this.userKey = await crypto.subtle.importKey("raw", buf, "AES-GCM", true, ["encrypt", "decrypt"]);
      // 重包 cached_K = AES(newLoginDerivedKey, K_raw)
      const kRaw = new Uint8Array(await crypto.subtle.exportKey("raw", K));
      const newSalt = this.base64ToBytes(newLoginSaltBase64);
      const newLoginDerivedKey = await deriveKey(newLoginPassword, newSalt);
      const newCachedK = await aesEncrypt(newLoginDerivedKey, kRaw);
      return { ok: true, newCachedK };
    } catch { return { ok: false }; }
  }

  // ── 改登录密码（K 不变，只更新本地缓存）─────────────

  async rewrapCachedK(
    oldLoginPassword: string, oldLoginSaltBase64: string,
    oldCached_K: string,
    newLoginPassword: string, newLoginSaltBase64: string,
  ): Promise<string> {
    const oldSalt = this.base64ToBytes(oldLoginSaltBase64);
    const oldLoginDerivedKey = await deriveKey(oldLoginPassword, oldSalt);
    const kRaw = await aesDecrypt(oldLoginDerivedKey, oldCached_K);
    if (!kRaw) throw new Error("unlock_failed");
    const newSalt = this.base64ToBytes(newLoginSaltBase64);
    const newLoginDerivedKey = await deriveKey(newLoginPassword, newSalt);
    return aesEncrypt(newLoginDerivedKey, kRaw);
  }

  /** 导出 User Key 的 raw bytes */
  async exportUserKeyRaw(): Promise<Uint8Array | null> {
    if (!this.userKey) return null;
    return new Uint8Array(await crypto.subtle.exportKey("raw", this.userKey));
  }

  // ── Item Key（不变）──────────────────────────────

  async createItemKey(): Promise<ItemKey> {
    const key = await generateAesKey();
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    const encrypted = await aesEncrypt(this.userKey!, raw);
    return { key, encrypted };
  }
  async decryptItemKey(encryptedKey: string): Promise<CryptoKey | null> {
    try {
      const raw = await aesDecrypt(this.userKey!, encryptedKey);
      if (!raw) return null;
      return importAesKey(this.bytesToBase64(raw));
    } catch { return null; }
  }

  // ── 字段加密/解密（不变）─────────────────────────

  async encryptItemField(plaintext: string, fieldName: string, itemType: string, itemKey?: ItemKey): Promise<EncryptedField> {
    const ik = itemKey ?? (await this.createItemKey());
    const aad = makeFieldAAD(fieldName, itemType);
    const nonce = new Uint8Array(12); crypto.getRandomValues(nonce);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce.buffer.slice(nonce.byteOffset, nonce.byteOffset + nonce.byteLength) as ArrayBuffer, tagLength: 128, additionalData: aad  as any}, ik.key, new TextEncoder().encode(plaintext) as BufferSource) as ArrayBuffer;
    const ctView = new Uint8Array(ct as ArrayBuffer);
    const r = new Uint8Array(12 + ctView.byteLength);
    r.set(nonce, 0);
    r.set(ctView, 12);
    return { encrypted_key: ik.encrypted, ciphertext: this.bytesToBase64(r) };
  }

  async decryptItemField(field: EncryptedField, fieldName: string, itemType: string): Promise<string | null> {
    const ik = await this.decryptItemKey(field.encrypted_key);
    if (!ik) return null;
    try {
      const bytes = await aesDecryptField(ik, field.ciphertext, fieldName, itemType);
      if (!bytes) return null;
      return new TextDecoder().decode(bytes);
    } catch { return null; }
  }

  // ── 文件加密/解密（不变）─────────────────────────

  async encryptFileBlob(plaintext: ArrayBuffer): Promise<string | null> {
    if (!this.userKey) return null;
    return aesEncrypt(this.userKey, new Uint8Array(plaintext));
  }
  async decryptFileBlob(encoded: string): Promise<ArrayBuffer | null> {
    if (!this.userKey) return null;
    const bytes = await aesDecrypt(this.userKey, encoded);
    if (!bytes) return null;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  lock(): void { this.userKey = null; }

  private bytesToBase64(bytes: Uint8Array): string {
    let b = ""; for (let i = 0; i < bytes.length; i++) b += String.fromCharCode(bytes[i]);
    return btoa(b);
  }
  private base64ToBytes(b64: string): Uint8Array {
    const b = atob(b64); const r = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) r[i] = b.charCodeAt(i);
    return r;
  }
}

export const keyChain = new KeyChain();
