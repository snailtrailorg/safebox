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
import { rsaDecrypt, rsaEncrypt } from "../crypto/rsa";
import type { UserKeySet, ItemKey } from "./types";
import { ENCRYPTION_VERSION_V2 } from "./types";

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
    recoveryWrapped: string;
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
    // 恢复码现在由服务端生成（POST /auth/recovery/generate），注册时不再需要 recoveryWrapped
    const recoveryWrapped = "";
    const encryptedPrivate = await this.encryptPrivateKey(this.rsaPrivateKey);

    const saltBase64 = this.bytesToBase64(salt);
    this.authKeyHash = authKeyHash;

    return {
      authKeyHash,
      passwordSalt: saltBase64,
      passwordWrapped,
      recoveryWrapped,
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
    itemKey?: CryptoKey,  // 传入已有的 Item Key 或留空生成新的
  ): Promise<{ encrypted_key: string; ciphertext: string; version: number }> {
    const ik = itemKey ?? (await this.createItemKey()).key;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", ik));
    const encryptedKey = await aesEncrypt(this.userKey!, raw);
    const aad = makeFieldAAD(fieldName, itemType);
    const nonce = new Uint8Array(12);
    crypto.getRandomValues(nonce);
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce.buffer.slice(nonce.byteOffset, nonce.byteOffset + nonce.byteLength) as ArrayBuffer, additionalData: aad.buffer.slice(aad.byteOffset, aad.byteOffset + aad.byteLength) as ArrayBuffer },
      ik,
      new TextEncoder().encode(plaintext).buffer.slice(0) as ArrayBuffer,
    ) as ArrayBuffer;
    const ctView = new Uint8Array(ct);
    const result = new Uint8Array(nonce.length + ctView.length);
    result.set(nonce, 0);
    result.set(ctView, nonce.length);
    return {
      encrypted_key: encryptedKey,  // aesEncrypt 已经返回 base64
      ciphertext: this.bytesToBase64(result),
      version: ENCRYPTION_VERSION_V2,
    };
  }

  /**
   * 解密条目字段（先试 v2 AES-GCM，失败回退 v1 RSA）
   */
  async decryptItemField(
    field: { encrypted_key?: string; ciphertext: string },
    fieldName: string,
    itemType: string,
    version?: number,
  ): Promise<string | null> {
    // v2: Item Key + AES-GCM
    if (version === ENCRYPTION_VERSION_V2 && field.encrypted_key) {
      const itemKey = await this.decryptItemKey(field.encrypted_key);
      if (itemKey) {
        try {
          const aad = makeFieldAAD(fieldName, itemType);
          const data = this.base64ToBytes(field.ciphertext);
          if (data.length >= 13) {
            const nonce = data.slice(0, 12);
            const ct = data.slice(12);
            const pt = await crypto.subtle.decrypt(
              { name: "AES-GCM", iv: nonce.buffer.slice(nonce.byteOffset, nonce.byteOffset + nonce.byteLength) as ArrayBuffer, additionalData: aad.buffer.slice(aad.byteOffset, aad.byteOffset + aad.byteLength) as ArrayBuffer },
              itemKey,
              ct.buffer.slice(ct.byteOffset, ct.byteOffset + ct.byteLength) as ArrayBuffer,
            ) as ArrayBuffer;
            return new TextDecoder().decode(pt);
          }
        } catch {}
      }
    }
    // v1: RSA（旧格式）
    if (this.rsaPrivateKey) {
      try {
        return await rsaDecrypt(this.rsaPrivateKey, field.ciphertext);
      } catch {
        return null;
      }
    }
    return null;
  }

  // ── v1 兼容：RSA 加密/解密（旧条目）───────────────

  /** v1 格式：RSA 加密条目数据 */
  async encryptItemData(plaintext: string): Promise<string | null> {
    if (!this.rsaPublicKey) return null;
    try {
      const key = await this.decodePublicKey(this.rsaPublicKey);
      if (!key) return null;
      return rsaEncrypt(key, plaintext);
    } catch {
      return null;
    }
  }

  /** v1 格式：RSA 解密条目数据 */
  async decryptItemData(encoded: string): Promise<string | null> {
    if (!this.rsaPrivateKey) return null;
    try {
      return rsaDecrypt(this.rsaPrivateKey, encoded);
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
