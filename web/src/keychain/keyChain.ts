/**
 * KeyChain - User Key 生命周期（合并主密码模型）
 *
 * K = PBKDF2(助记词 + 主密码, mnemonic_salt) - 永久，不存服务器（主密码参与派生）
 * User Key = 随机 AES-256 - 包裹 Item Keys
 * encrypted_user_key = AES(K, User Key) - 存服务器
 * 主密码：既派生 K（加密），又派生 auth hash（认证）+ 本地缓存 K
 * 改主密码：K 变 -> 重新包裹 encrypted_user_key + 新 cached_K + 新 auth hash（需助记词）
 * 忘主密码 = 数据丢失（主密码参与 K 派生，无法恢复）
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

  async generateKeys(mnemonic: string, masterPassword: string): Promise<{
    localPasswordHash: string;
    localSalt: string;
    encrypted_user_key: string;
    mnemonic_salt: string;
    cached_K: string;
    kdfSettings: KdfSettings;
  }> {
    const localSalt = new Uint8Array(32);
    crypto.getRandomValues(localSalt);
    const mnemonicSalt = new Uint8Array(32);
    crypto.getRandomValues(mnemonicSalt);

    // K = PBKDF2(助记词 + 主密码, mnemonic_salt) - 主密码参与派生
    const K = await deriveKey(mnemonic + masterPassword, mnemonicSalt);

    // User Key（随机，不变）
    this.userKey = await generateAesKey();
    const userKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", this.userKey));

    // encrypted_user_key = AES(K, User Key) - 存服务器
    const encrypted_user_key = await aesEncrypt(K, userKeyRaw);

    // localDerivedKey = PBKDF2(主密码, localSalt) - 本地缓存 K
    const localDerivedKey = await deriveKey(masterPassword, localSalt);
    // cached_K = AES(localDerivedKey, K)，K 是派生的主密钥，不在服务器
    const kRaw = new Uint8Array(await crypto.subtle.exportKey("raw", K));
    const cached_K = await aesEncrypt(localDerivedKey, kRaw);

    // authKey - 服务端认证
    const localPasswordHash = await deriveAuthKey(masterPassword, localSalt);

    const saltBase64 = this.bytesToBase64(localSalt);
    const recSaltBase64 = this.bytesToBase64(mnemonicSalt);

    return {
      localPasswordHash,
      localSalt: saltBase64,
      encrypted_user_key,
      mnemonic_salt: recSaltBase64,
      cached_K,
      kdfSettings: DEFAULT_KDF,
    };
  }

  // ── 日常解锁（Web: 主密码 -> localDerivedKey -> K -> UserKey）─────────

  async unlockWithPassword(
    masterPassword: string,
    localSaltBase64: string,
    encryptedUserKey: string,
    cached_K: string,
  ): Promise<boolean> {
    try {
      const localSalt = this.base64ToBytes(localSaltBase64);
      const localDerivedKey = await deriveKey(masterPassword, localSalt);
      // K = AES 解密(cached_K, localDerivedKey)
      const kRaw = await aesDecrypt(localDerivedKey, cached_K);
      if (!kRaw) return false;
      // User Key = AES 解密(encrypted_user_key, K)
      const ukRaw = await aesDecrypt(await importAesKey(this.bytesToBase64(kRaw)), encryptedUserKey);
      if (!ukRaw) return false;
      const buf = ukRaw.buffer.slice(ukRaw.byteOffset, ukRaw.byteOffset + ukRaw.byteLength) as ArrayBuffer;
      this.userKey = await crypto.subtle.importKey("raw", buf, "AES-GCM", true, ["encrypt", "decrypt"]);
      return true;
    } catch { return false; }
  }

  // ── 助记词解锁（换设备：助记词 + 主密码 -> K -> UserKey）─────────────────

  async unlockFromMnemonic(
    mnemonic: string,
    masterPassword: string,
    mnemonicSaltBase64: string,
    encryptedUserKey: string,
  ): Promise<boolean> {
    try {
      const mnemonicSalt = this.base64ToBytes(mnemonicSaltBase64);
      const K = await deriveKey(mnemonic + masterPassword, mnemonicSalt);
      const ukRaw = await aesDecrypt(K, encryptedUserKey);
      if (!ukRaw) return false;
      const buf = ukRaw.buffer.slice(ukRaw.byteOffset, ukRaw.byteOffset + ukRaw.byteLength) as ArrayBuffer;
      this.userKey = await crypto.subtle.importKey("raw", buf, "AES-GCM", true, ["encrypt", "decrypt"]);
      return true;
    } catch { return false; }
  }

  // ── 换设备：助记词 + 主密码派生 K 解 UserKey + 用主密码建本地缓存 ──

  /** 一次派生 K：解 User Key 设到内存 + 用主密码重包 cached_K 供本地缓存。
   *  换设备专用（无 cached_K，需助记词 + 主密码重新派生）。主密码同时用于 K 派生与本地缓存。 */
  async recoverAndRewrap(
    mnemonic: string,
    masterPassword: string,
    mnemonicSaltBase64: string,
    encryptedUserKey: string,
    localSaltBase64: string,
  ): Promise<{ ok: boolean; newCachedK?: string }> {
    try {
      const mnemonicSalt = this.base64ToBytes(mnemonicSaltBase64);
      const K = await deriveKey(mnemonic + masterPassword, mnemonicSalt);
      const ukRaw = await aesDecrypt(K, encryptedUserKey);
      if (!ukRaw) return { ok: false };
      const buf = ukRaw.buffer.slice(ukRaw.byteOffset, ukRaw.byteOffset + ukRaw.byteLength) as ArrayBuffer;
      this.userKey = await crypto.subtle.importKey("raw", buf, "AES-GCM", true, ["encrypt", "decrypt"]);
      // 建本地缓存：cached_K = AES(localDerivedKey, K_raw)
      const kRaw = new Uint8Array(await crypto.subtle.exportKey("raw", K));
      const localSalt = this.base64ToBytes(localSaltBase64);
      const localDerivedKey = await deriveKey(masterPassword, localSalt);
      const newCachedK = await aesEncrypt(localDerivedKey, kRaw);
      return { ok: true, newCachedK };
    } catch { return { ok: false }; }
  }

  // ── 改主密码（K 变：主密码参与派生，需助记词重派生 K + 重包裹 encrypted_user_key）──

  /** 改主密码：主密码参与 K 派生，故 K 变。
   *  需助记词（派生新 K）+ 已解锁的 User Key（内存中，不变）。
   *  重新包裹 encrypted_user_key = AES(新K, UserKey) + 新 cached_K + 新 auth hash。
   *  旧主密码验证由服务端 change-password 端点完成（current_local_password_hash）。 */
  async changeMasterPassword(
    mnemonic: string,
    mnemonicSaltBase64: string,
    newMasterPassword: string,
    newLocalSaltBase64: string,
  ): Promise<{
    new_encrypted_user_key: string;
    new_cached_K: string;
    new_local_password_hash: string;
  }> {
    if (!this.userKey) throw new Error("not_unlocked");
    const mnemonicSalt = this.base64ToBytes(mnemonicSaltBase64);
    // 新 K = PBKDF2(助记词 + 新主密码, mnemonic_salt)
    const newK = await deriveKey(mnemonic + newMasterPassword, mnemonicSalt);
    const userKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", this.userKey));
    // 重新包裹 User Key（User Key 不变，K 变）
    const new_encrypted_user_key = await aesEncrypt(newK, userKeyRaw);
    // 新本地缓存：cached_K = AES(新 localDerivedKey, 新 K_raw)
    const kRaw = new Uint8Array(await crypto.subtle.exportKey("raw", newK));
    const newSalt = this.base64ToBytes(newLocalSaltBase64);
    const newLocalDerivedKey = await deriveKey(newMasterPassword, newSalt);
    const new_cached_K = await aesEncrypt(newLocalDerivedKey, kRaw);
    const new_local_password_hash = await deriveAuthKey(newMasterPassword, newSalt);
    return { new_encrypted_user_key, new_cached_K, new_local_password_hash };
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
