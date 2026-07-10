/**
 * KeyChain — User Key 生命周期管理
 *
 * 替代 v1 KeyManager，职责:
 *   - User Key 生命周期（生成/解锁/锁定）
 *   - Item Key 生成和加密（每条目一个随机 key）
 *   - RSA 私钥加载（仅用于旧条目解密）
 *   - 旧格式（RSA）解密回退
 *
 * 密钥仅存于 JavaScript 堆内存（CryptoKey 对象），永不持久化。
 */
import {
  generateAesKey,
  exportAesKey,
  importAesKey,
  aesEncrypt,
  aesDecrypt,
  aesEncryptString,
  aesDecryptString,
  makeFieldAAD,
} from "../crypto/aes";
import {
  deriveKey,
  deriveAuthKey,
  type KdfSettings,
  DEFAULT_KDF,
} from "../crypto/kdf";
import type { UserKeySet, ItemKey, EncryptedField } from "./types";

class KeyChain {
  private userKey: CryptoKey | null = null;
  private rsaPrivateKey: CryptoKey | null = null;
  private rsaPublicKey: string | null = null;
  private authKeyHash: string | null = null;

  // ── 状态查询 ────────────────────────────────────

  get isUnlocked(): boolean {
    return this.userKey !== null;
  }

  get isRsaLoaded(): boolean {
    return this.rsaPrivateKey !== null;
  }

  // ── 密钥生成（注册时）──────────────────────────

  async generateKeys(password: string): Promise<{
    authKeyHash: string;
    passwordSalt: string;
    passwordWrapped: string;
    encryptedPrivate: string;
    rsaPublicKey: string;
    devicePublicKey?: string;
    deviceWrapped?: string;
    kdfSettings: KdfSettings;
  }> {
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    this.userKey = await generateAesKey();
    const derivedKey = await deriveKey(password, salt);
    const authKeyHash = await deriveAuthKey(password, salt);

    // 生成 RSA 密钥对（仅用于旧条目解密 + 未来共享）
    const rsaPair = await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 4096,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["encrypt", "decrypt"],
    );
    this.rsaPublicKey = await this.encodePublicKey(rsaPair.publicKey);
    this.rsaPrivateKey = rsaPair.privateKey;

    // 包装密钥
    const masterRaw = new Uint8Array(await crypto.subtle.exportKey("raw", this.userKey));
    const passwordWrapped = await aesEncrypt(derivedKey, masterRaw);
    const encryptedPrivate = await this.encryptPrivateKey(this.rsaPrivateKey);

    const saltBase64 = this.bytesToBase64(salt);
    this.authKeyHash = authKeyHash;

    return {
      authKeyHash,
      passwordSalt: saltBase64,
      passwordWrapped,
      encryptedPrivate,
      rsaPublicKey: this.rsaPublicKey,
      kdfSettings: DEFAULT_KDF,
    };
  }

  // ── 解锁 ────────────────────────────────────────

  async unlockWithPassword(
    password: string,
    saltBase64: string,
    passwordWrapped: string,
  ): Promise<boolean> {
    try {
      const salt = this.base64ToBytes(saltBase64);
      const derivedKey = await deriveKey(password, salt);
      const masterRaw = await aesDecrypt(derivedKey, passwordWrapped);
      if (!masterRaw) return false;
      const buf = masterRaw.buffer.slice(masterRaw.byteOffset, masterRaw.byteOffset + masterRaw.byteLength) as ArrayBuffer;
      this.userKey = await crypto.subtle.importKey(
        "raw", buf, "AES-GCM", true, ["encrypt", "decrypt"],
      );
      return true;
    } catch {
      return false;
    }
  }

  /** 导出 User Key 的 raw bytes（供改密等场景使用）。未解锁时返回 null。 */
  async exportUserKeyRaw(): Promise<Uint8Array | null> {
    if (!this.userKey) return null;
    return new Uint8Array(await crypto.subtle.exportKey("raw", this.userKey));
  }

  // ── RSA 密钥加载 ────────────────────────────────

  async loadRsaKeys(
    encryptedPrivateKey: string,
    publicKeyStr: string,
  ): Promise<boolean> {
    if (!this.userKey) return false;
    try {
      const privatePem = await aesDecryptString(this.userKey, encryptedPrivateKey);
      if (!privatePem) return false;
      const privateKey = await this.decodePrivateKey(privatePem);
      const publicKey = await this.decodePublicKey(publicKeyStr);
      if (!privateKey || !publicKey) return false;
      this.rsaPrivateKey = privateKey;
      this.rsaPublicKey = publicKeyStr;
      return true;
    } catch {
      return false;
    }
  }

  // ── Item Key 管理（v2 新增）─────────────────────

  /** 生成一个 Item Key 并返回加密后的 key（用于存储） */
  async createItemKey(): Promise<ItemKey> {
    const key = await generateAesKey();
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    const encrypted = await aesEncrypt(this.userKey!, raw);
    return { key, encrypted };
  }

  /** 从存储的加密 key 还原 Item Key */
  async decryptItemKey(encryptedKey: string): Promise<CryptoKey | null> {
    try {
      const raw = await aesDecrypt(this.userKey!, encryptedKey);
      if (!raw) return null;
      const key = await importAesKey(this.bytesToBase64(raw));
      return key;
    } catch {
      return null;
    }
  }

  // ── 条目字段加密/解密 ──────────────────────────

  /**
   * 加密条目字段（v2 格式：Item Key + AES-GCM + 字段 AAD）
   * 返回 { encrypted_key, ciphertext } — 存于条目记录的 single field
   */
  async encryptItemField(
    plaintext: string,
    fieldName: string,
    itemType: string,
    itemKey?: ItemKey,
  ): Promise<EncryptedField> {
    const ik = itemKey ?? (await this.createItemKey());
    const aad = makeFieldAAD(fieldName, itemType);
    const nonce = new Uint8Array(12);
    crypto.getRandomValues(nonce);
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce.buffer.slice(nonce.byteOffset, nonce.byteOffset + nonce.byteLength) as ArrayBuffer, tagLength: 128, additionalData: aad.buffer.slice(aad.byteOffset, aad.byteOffset + aad.byteLength) as ArrayBuffer },
      ik.key,
      new TextEncoder().encode(plaintext).buffer.slice(0) as ArrayBuffer,
    ) as ArrayBuffer;
    const ctView = new Uint8Array(ct);
    const result = new Uint8Array(nonce.length + ctView.length);
    result.set(nonce, 0);
    result.set(ctView, nonce.length);
    return {
      encrypted_key: ik.encrypted,
      ciphertext: this.bytesToBase64(result),
    };
  }

  /**
   * 解密条目字段（v2：Item Key + AES-GCM + 字段 AAD。解密失败返回 null）
   */
  async decryptItemField(
    field: EncryptedField,
    fieldName: string,
    itemType: string,
  ): Promise<string | null> {
    const itemKey = await this.decryptItemKey(field.encrypted_key);
    if (!itemKey) return null;
    try {
      const aad = makeFieldAAD(fieldName, itemType);
      const data = this.base64ToBytes(field.ciphertext);
      if (data.length < 13) return null;
      const nonce = data.slice(0, 12);
      const ct = data.slice(12);
      const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce.buffer.slice(nonce.byteOffset, nonce.byteOffset + nonce.byteLength) as ArrayBuffer, tagLength: 128, additionalData: aad.buffer.slice(aad.byteOffset, aad.byteOffset + aad.byteLength) as ArrayBuffer },
        itemKey,
        ct.buffer.slice(ct.byteOffset, ct.byteOffset + ct.byteLength) as ArrayBuffer,
      ) as ArrayBuffer;
      return new TextDecoder().decode(pt);
    } catch {
      return null;
    }
  }

  // ── 文件加密/解密（AES-GCM，用于文件类型条目）─────

  /** 加密文件内容，返回 Base64(nonce + ciphertext) */
  async encryptFileBlob(plaintext: ArrayBuffer): Promise<string | null> {
    if (!this.userKey) return null;
    return aesEncrypt(this.userKey, new Uint8Array(plaintext));
  }

  /** 解密文件内容，返回原始 ArrayBuffer */
  async decryptFileBlob(encoded: string): Promise<ArrayBuffer | null> {
    if (!this.userKey) return null;
    const bytes = await aesDecrypt(this.userKey, encoded);
    if (!bytes) return null;
    return (bytes.buffer as ArrayBuffer).slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
  }

  // ── 锁定 ────────────────────────────────────────

  lock(): void {
    this.userKey = null;
    this.rsaPrivateKey = null;
    this.rsaPublicKey = null;
    this.authKeyHash = null;
  }

  // ── 内部工具 ────────────────────────────────────

  private async encodePublicKey(key: CryptoKey): Promise<string> {
    const spki = await crypto.subtle.exportKey("spki", key);
    return this.bytesToBase64(new Uint8Array(spki as ArrayBuffer));
  }

  private async decodePublicKey(encoded: string): Promise<CryptoKey | null> {
    try {
      const bytes = this.base64ToBytes(encoded);
      return await crypto.subtle.importKey(
        "spki", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"],
      );
    } catch { return null; }
  }

  private async decodePrivateKey(pem: string): Promise<CryptoKey | null> {
    try {
      const bytes = this.base64ToBytes(pem);
      return await crypto.subtle.importKey(
        "pkcs8", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"],
      );
    } catch { return null; }
  }

  private async encryptPrivateKey(key: CryptoKey): Promise<string> {
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", key);
    const encoded = this.bytesToBase64(new Uint8Array(pkcs8 as ArrayBuffer));
    return aesEncryptString(this.userKey!, encoded);
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  private base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
}

/** 全局单例 */
export const keyChain = new KeyChain();
