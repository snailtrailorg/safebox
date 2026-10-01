/**
 * KDF 统一接口
 *
 * 目前仅支持 PBKDF2-SHA256（迭代数跟随账户 kdf_settings）。
 * 加密路径: deriveKey -> PBKDF2(password, salt) -> 包裹/解包 User Key、本地缓存 K、mnemonic 缓存
 *
 * 认证走 SRP-6a（crypto/srp.ts），不使用 deriveAuthKey/bcrypt。
 *
 * 注：argon2id 曾是预留选项（需要 WebAssembly 实现，WebCrypto 无原生支持），
 * 但从未实现，且服务端已收窄为只放行 pbkdf2（见 auth_service.validate_kdf_settings）。
 * 保留一个"会抛错的类型分支"是静默失败温床，故移除。
 */
import { SALT_LENGTH, PBKDF2_ITERATIONS } from "../config/constants";

export type KdfSettings = { algorithm: "pbkdf2"; iterations: number };

// 迭代数以 constants.PBKDF2_ITERATIONS 为单一真理源（与 AES nonce/tag 等常量同处）
export const DEFAULT_KDF: KdfSettings = { algorithm: "pbkdf2", iterations: PBKDF2_ITERATIONS };
export const RECOMMENDED_KDF: KdfSettings = { algorithm: "pbkdf2", iterations: PBKDF2_ITERATIONS };

/** 生成随机盐 (32 字节) */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return salt;
}

/** 底层 deriveBits（可选 Web Worker，当前主线程实现） */
async function deriveBits(
  password: string,
  salt: Uint8Array,
  settings: KdfSettings,
  length: number,
): Promise<Uint8Array> {
  if (settings.algorithm !== "pbkdf2") {
    // 类型已收窄为 pbkdf2；此分支仅防御运行时传入非法值（如来自旧 kdf_settings）
    throw new Error(`unsupported KDF algorithm: ${String((settings as { algorithm?: string }).algorithm)}`);
  }
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations: settings.iterations, hash: "SHA-256" },
    keyMaterial, length,
  ) as ArrayBuffer;
  return new Uint8Array(bits as ArrayBuffer);
}

/** deriveKey - 派生 AES-256 加密密钥（用于包裹/解包 User Key、本地缓存 K、mnemonic 缓存）
 *
 *  ⚠️ 可提取性取舍（已知，非疏漏）：
 *  返回的 CryptoKey 为 extractable=true，因为 K 的 raw 需要被取出用于构造 cached_K
 *  （见 keyChain.ts: 导出 K 的 raw 后用 localDerivedKey 包裹）。
 *  注意 wrapKey 不能替代：WebCrypto 的 wrapKey("raw", ...) 内部等同 exportKey，
 *  仍要求源密钥可导出（实测：对 non-extractable key 调 wrapKey 抛 InvalidAccessError）。
 *  因此这里的 extractable=true 是"缓存 K"需求的必然结果。
 *  影响面：XSS 可导出本函数返回的密钥。若日后不再需要导出，应改回 false。
 */
export async function deriveKey(
  password: string, salt: Uint8Array, settings: KdfSettings = DEFAULT_KDF,
): Promise<CryptoKey> {
  const bits = await deriveBits(password, salt, settings, 256);
  return crypto.subtle.importKey("raw", bits.buffer.slice(bits.byteOffset, bits.byteOffset + bits.byteLength) as ArrayBuffer, "AES-GCM", true, ["encrypt", "decrypt"]);
}
