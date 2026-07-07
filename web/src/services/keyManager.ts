/**
 * KeyManager — 内存中密钥生命周期管理（已废弃）
 *
 * @deprecated 使用 keychain/keyChain.ts 替代。
 *             保留仅用于测试兼容和旧代码参考。
 *             新代码请使用:
 *               import { keyChain } from "../keychain/keyChain";
 */
import {
  deriveKey,
  deriveKeyHash,
  generateSalt,
  generateRecoveryCode,
  recoveryCodeToKey,
  generateAesKey,
  exportAesKey,
  aesEncrypt,
  aesDecrypt,
  aesEncryptString,
  aesDecryptString,
  generateRsaKeyPair,
  encodePublicKey,
  encodePrivateKey,
  decodePublicKey,
  decodePrivateKey,
  rsaEncrypt,
  rsaDecrypt,
} from "../crypto";

class KeyManager {
  private masterKey: CryptoKey | null = null;
  private rsaPublicKey: CryptoKey | null = null;
  private rsaPrivateKey: CryptoKey | null = null;
  private recoveryCode: string | null = null;

  // ── 状态查询 ────────────────────────────────────

  get isUnlocked(): boolean {
    return this.masterKey !== null;
  }

  get isRsaLoaded(): boolean {
    return this.rsaPublicKey !== null && this.rsaPrivateKey !== null;
  }

  get currentRecoveryCode(): string | null {
    return this.recoveryCode;
  }

  // ── 密钥生成（注册时） ──────────────────────────

  async generateKeys(password: string): Promise<{
    authKeyHash: string;
    passwordSalt: string;
    passwordWrapped: string;
    recoveryWrapped: string;
    encryptedPrivate: string;
    rsaPublicKey: string;
    recoveryCode: string;
    devicePublicKey?: string;
    deviceWrapped?: string;
  }> {
    const salt = generateSalt();
    this.masterKey = await generateAesKey();
    const derivedKey = await deriveKey(password, salt);
    const authKeyHash = await deriveKeyHash(password, salt);

    // 生成 RSA 密钥对
    const rsaPair = await generateRsaKeyPair();
    this.rsaPublicKey = rsaPair.publicKey;
    this.rsaPrivateKey = rsaPair.privateKey;

    // 恢复码
    this.recoveryCode = generateRecoveryCode();
    const recoveryKey = await recoveryCodeToKey(this.recoveryCode);

    // 导出 RSA 公钥
    const rsaPubEncoded = await encodePublicKey(this.rsaPublicKey);
    const rsaPrivEncoded = await encodePrivateKey(this.rsaPrivateKey);

    // 包装密钥
    const masterRaw = new Uint8Array(await crypto.subtle.exportKey("raw", this.masterKey) as ArrayBuffer);
    const passwordWrapped = await aesEncrypt(derivedKey, masterRaw);
    const recoveryWrapped = await aesEncrypt(recoveryKey, masterRaw);
    const encryptedPrivate = await aesEncryptString(
      this.masterKey,
      rsaPrivEncoded,
    );

    const saltBase64 = this.bytesToBase64(salt);

    return {
      authKeyHash,
      passwordSalt: saltBase64,
      passwordWrapped,
      recoveryWrapped,
      encryptedPrivate,
      rsaPublicKey: rsaPubEncoded,
      recoveryCode: this.recoveryCode,
    };
  }

  // ── 解锁 ────────────────────────────────────────

  /** 通过密码解锁 */
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
      this.masterKey = await crypto.subtle.importKey(
        "raw",
        masterRaw as BufferSource,
        "AES-GCM",
        true,
        ["encrypt", "decrypt"],
      );
      return true;
    } catch {
      return false;
    }
  }

  /** 通过恢复码解锁 */
  async unlockWithRecoveryCode(
    recoveryCode: string,
    recoveryWrapped: string,
  ): Promise<boolean> {
    try {
      const recoveryKey = await recoveryCodeToKey(recoveryCode);
      const masterRaw = await aesDecrypt(recoveryKey, recoveryWrapped);
      if (!masterRaw) return false;
      this.masterKey = await crypto.subtle.importKey(
        "raw",
        masterRaw as BufferSource,
        "AES-GCM",
        true,
        ["encrypt", "decrypt"],
      );
      return true;
    } catch {
      return false;
    }
  }

  // ── RSA 密钥加载 ────────────────────────────────

  /** 加载 RSA 密钥对 */
  async loadRsaKeys(
    encryptedPrivateKey: string,
    publicKeyStr: string,
  ): Promise<boolean> {
    if (!this.masterKey) return false;
    try {
      // 解密私钥
      const privatePem = await aesDecryptString(
        this.masterKey,
        encryptedPrivateKey,
      );
      if (!privatePem) return false;
      this.rsaPrivateKey = await decodePrivateKey(privatePem);
      this.rsaPublicKey = await decodePublicKey(publicKeyStr);
      return this.rsaPublicKey !== null && this.rsaPrivateKey !== null;
    } catch {
      return false;
    }
  }

  // ── RSA 加密/解密（按条目） ──────────────────────

  async encryptItemData(plaintext: string): Promise<string | null> {
    if (!this.rsaPublicKey) return null;
    return rsaEncrypt(this.rsaPublicKey, plaintext);
  }

  async decryptItemData(encoded: string): Promise<string | null> {
    if (!this.rsaPrivateKey) return null;
    return rsaDecrypt(this.rsaPrivateKey, encoded);
  }

  // ── 文件加密/解密（AES-GCM，用于文件类型条目）─────

  /** 加密文件内容，返回 Base64(nonce + ciphertext) */
  async encryptFileBlob(plaintext: ArrayBuffer): Promise<string | null> {
    if (!this.masterKey) return null;
    return aesEncrypt(this.masterKey, new Uint8Array(plaintext));
  }

  /** 解密文件内容，返回原始 ArrayBuffer */
  async decryptFileBlob(encoded: string): Promise<ArrayBuffer | null> {
    if (!this.masterKey) return null;
    const bytes = await aesDecrypt(this.masterKey, encoded);
    if (!bytes) return null;
    return (bytes.buffer as ArrayBuffer).slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
  }

  // ── 锁定 ────────────────────────────────────────

  lock(): void {
    this.masterKey = null;
    this.rsaPublicKey = null;
    this.rsaPrivateKey = null;
    this.recoveryCode = null;
  }

  // ── 工具方法 ────────────────────────────────────

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

/** 全局单例 */
export const keyManager = new KeyManager();
