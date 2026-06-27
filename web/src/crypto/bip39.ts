/**
 * BIP39 词表 + 恢复码生成/还原
 * 与 Android CryptoManager.kt 完全一致的 2048 词表
 */
import { BIP39_WORDS } from "./wordlist";

export { BIP39_WORDS };

/** 生成 12 词恢复码 */
export function generateRecoveryCode(): string {
  const entropy = new Uint8Array(16);
  crypto.getRandomValues(entropy);
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    const index = (entropy[i] & 0xff) % BIP39_WORDS.length;
    words.push(BIP39_WORDS[index]);
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
