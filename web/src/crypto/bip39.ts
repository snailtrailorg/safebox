/**
 * BIP39 词表 + 恢复码生成/还原
 * 与 Android CryptoManager.kt 完全一致的 2048 词表
 */
import { BIP39_WORDS } from "./wordlist";

export { BIP39_WORDS };

/** 生成 12 词恢复码（BIP39 rejection sampling，12 位 → 2049 词均匀分布） */
export function generateRecoveryCode(): string {
  const entropy = new Uint8Array(32);
  crypto.getRandomValues(entropy);
  const words: string[] = [];

  for (let byteIdx = 0; words.length < 12 && byteIdx < entropy.length - 1; byteIdx++) {
    // 取 16 位，拒绝 >= 2049 的值
    const value = ((entropy[byteIdx] << 8) | entropy[byteIdx + 1]) & 0xFFFF;
    if (value < BIP39_WORDS.length) {
      words.push(BIP39_WORDS[value]);
    }
  }

  // 理论上 32 字节足够生成 12 词（平均需要 ~18 字节）
  // 极端情况下熵不够，用额外的随机字节补充
  while (words.length < 12) {
    const extra = new Uint8Array(2);
    crypto.getRandomValues(extra);
    const value = ((extra[0] << 8) | extra[1]) & 0xFFFF;
    if (value < BIP39_WORDS.length) {
      words.push(BIP39_WORDS[value]);
    }
  }

  return words.join(" ");
}

/** 恢复码 → AES 密钥（SHA-256 哈希） */
export async function recoveryCodeToKey(
  code: string,
): Promise<CryptoKey> {
  const normalized = code.trim().toLowerCase();
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(hash),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
