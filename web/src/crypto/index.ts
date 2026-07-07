/**
 * CryptoManager 门面 — 对应 Android CryptoManager.kt
 * 统一暴露所有加密操作
 */
export { generateRecoveryCode, recoveryCodeToKey } from "./bip39";
export { generateSalt, deriveKey, deriveKeyHash } from "./pbkdf2";
export {
  aesEncrypt,
  aesDecrypt,
  aesEncryptString,
  aesDecryptString,
  generateAesKey,
  exportAesKey,
  importAesKey,
  makeFieldAAD,
  aesEncryptField,
  aesDecryptField,
  bytesToBase64,
  base64ToBytes,
} from "./aes";
export {
  generateRsaKeyPair,
  encodePublicKey,
  encodePrivateKey,
  decodePublicKey,
  decodePrivateKey,
  rsaEncrypt,
  rsaDecrypt,
} from "./rsa";
