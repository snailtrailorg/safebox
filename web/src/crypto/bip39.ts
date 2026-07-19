/**
 * BIP39 标准 2048 词表 + 助记词生成
 * 与服务端 bip39.py 词表一致（标准 BIP39 英文词表）
 */
import { BIP39_WORDS } from "./wordlist";

export { BIP39_WORDS };

/** 生成 12 词助记词（rejection sampling，均匀分布到 2048 词） */
export function generateMnemonic(): string {
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
