/**
 * KeyChain 密钥类型定义
 *
 * UserKeySet: 用户完整的密钥集合（内存中）
 * ItemKey: 条目级 AES-256 密钥（每条目一个随机 key）
 */
export interface UserKeySet {
  userKey: CryptoKey;         // AES-256-GCM，加密 Item Key 和 RSA 私钥
  authKeyHash: string;        // 发送给服务端的认证 hash
  rsaPrivateKey?: CryptoKey;  // RSA-4096（仅用于旧条目解密 + 未来共享）
  rsaPublicKey?: string;      // 公钥 base64 SPKI
}

export interface ItemKey {
  key: CryptoKey;         // AES-256-GCM 密钥
  encrypted: string;      // 用 User Key 包裹后的 Item Key，存于条目记录
}

// 加密格式版本: 1=RSA, 2=AES-GCM+ItemKey
export const ENCRYPTION_VERSION_V1 = 1;
export const ENCRYPTION_VERSION_V2 = 2;
