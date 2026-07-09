/**
 * BIP39 词表索引 + 恢复码生成/还原
 * 与 Android CryptoManager.kt 完全一致的 2048 词表
 *
 * 注意：标准 BIP39 使用 128 bit 熵 + SHA-256 校验和 → 132 bit → 11 bit 分段 → 12 词。
 * 当前两端的实现均未遵循标准 BIP39（Android 端使用 byte%2048，Web 端使用 rejection sampling）。
 * 两端生成结果不可互换。修复需同时修改 Android CryptoManager.kt。
 */
import { BIP39_WORDS } from "./wordlist";

export { BIP39_WORDS };

/** 生成 12 词恢复码（rejection sampling，均匀分布到 2049 词） */
export function generateRecoveryCode(): string {
  const words: string[] = [];
  while (words.length < 12) {
    const buf = new Uint8Array(2);
    crypto.getRandomValues(buf);
    const value = ((buf[0] << 8) | buf[1]) & 0xFFFF;
    if (value < BIP39_WORDS.length) {
      words.push(BIP39_WORDS[value]);
    }
  }
  return words.join(" ");
}


