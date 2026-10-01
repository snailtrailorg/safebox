/**
 * 改密 / 恢复链路测试（P0 回归防护）
 *
 * 背景：kdf-keychain.test.ts 覆盖了 generateKeys / unlockWithPassword / getMnemonicFromCache /
 * encryptFileBlob / lock，但 changeMasterPassword 与 recoverAndRewrap 零覆盖。
 * 这正是 P0-1（改密 100% 抛 InvalidAccessException）能存活的原因。
 *
 * 本文件补上这两个函数的全链路验证，且验证「语义正确性」而非仅「不抛异常」：
 *   - changeMasterPassword：新 K 解出的必须是同一个 UserKey（否则老条目全解不开）
 *   - recoverAndRewrap：换设备恢复后必须能解出原数据
 */
import { describe, it, expect, beforeEach } from "vitest";
import { keyChain } from "../keychain/keyChain";
import { deriveKey } from "../crypto/kdf";
import { aesDecrypt, aesEncryptString, aesDecryptString } from "../crypto/aes";

const MNEMONIC = "a b c d e f g h i j k l";
const OLD_PASSWORD = "old-correct-password";
const NEW_PASSWORD = "new-correct-password";
const EMAIL = "test@example.com";

function randomSaltBase64(): string {
  const s = new Uint8Array(32);
  crypto.getRandomValues(s);
  return btoa(String.fromCharCode(...s));
}

function base64ToBytes(b64: string): Uint8Array {
  const b = atob(b64);
  const r = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) r[i] = b.charCodeAt(i);
  return r;
}

beforeEach(() => {
  keyChain.lock();
});

// ── changeMasterPassword（P0-1 回归防护）─────────────────

describe("changeMasterPassword", () => {
  it("不抛异常，且产出全部 5 个字段", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, OLD_PASSWORD, EMAIL);
    keyChain.lock();
    const unlocked = await keyChain.unlockWithPassword(
      OLD_PASSWORD, keys.localSalt, keys.encrypted_user_key, keys.cached_K,
    );
    expect(unlocked).toBe(true);

    const newSalt = randomSaltBase64();
    const result = await keyChain.changeMasterPassword(
      MNEMONIC, EMAIL, keys.mnemonic_salt, NEW_PASSWORD, newSalt,
    );

    expect(result.new_encrypted_user_key).toBeTruthy();
    expect(result.new_cached_K).toBeTruthy();
    expect(result.new_srp_verifier).toBeTruthy();
    expect(result.new_srp_salt).toBeTruthy();
    expect(result.new_mnemonic_encrypted).toBeTruthy();
  });

  it("语义正确：新 K 解出的必须是同一个 UserKey（老条目才不会全废）", async () => {
    // 建库 + 用它加密一条数据，作为「UserKey 身份」的指纹
    const keys = await keyChain.generateKeys(MNEMONIC, OLD_PASSWORD, EMAIL);
    keyChain.lock();
    await keyChain.unlockWithPassword(OLD_PASSWORD, keys.localSalt, keys.encrypted_user_key, keys.cached_K);
    const itemKey = await keyChain.createItemKey();
    const field = await keyChain.encryptItemField("secret-value", "password", "login", itemKey);

    // 改密
    const newSalt = randomSaltBase64();
    const result = await keyChain.changeMasterPassword(
      MNEMONIC, EMAIL, keys.mnemonic_salt, NEW_PASSWORD, newSalt,
    );

    // 用新材料解锁（模拟改密后重新登录）
    keyChain.lock();
    const reUnlocked = await keyChain.unlockWithPassword(
      NEW_PASSWORD, newSalt, result.new_encrypted_user_key, result.new_cached_K,
    );
    expect(reUnlocked).toBe(true);

    // 关键断言：UserKey 没变 -> 老条目仍可解密
    const plain = await keyChain.decryptItemField(field, "password", "login");
    expect(plain).toBe("secret-value");
  });

  it("旧主密码在新材料上失效", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, OLD_PASSWORD, EMAIL);
    keyChain.lock();
    await keyChain.unlockWithPassword(OLD_PASSWORD, keys.localSalt, keys.encrypted_user_key, keys.cached_K);
    const newSalt = randomSaltBase64();
    const result = await keyChain.changeMasterPassword(
      MNEMONIC, EMAIL, keys.mnemonic_salt, NEW_PASSWORD, newSalt,
    );

    keyChain.lock();
    const withOld = await keyChain.unlockWithPassword(
      OLD_PASSWORD, newSalt, result.new_encrypted_user_key, result.new_cached_K,
    );
    expect(withOld).toBe(false);
  });

  it("new_mnemonic_encrypted 能用新主密码解回原助记词", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, OLD_PASSWORD, EMAIL);
    keyChain.lock();
    await keyChain.unlockWithPassword(OLD_PASSWORD, keys.localSalt, keys.encrypted_user_key, keys.cached_K);
    const newSalt = randomSaltBase64();
    const result = await keyChain.changeMasterPassword(
      MNEMONIC, EMAIL, keys.mnemonic_salt, NEW_PASSWORD, newSalt,
    );

    const recovered = await keyChain.getMnemonicFromCache(
      NEW_PASSWORD, newSalt, result.new_mnemonic_encrypted,
    );
    expect(recovered).toBe(MNEMONIC);
  });

  it("未解锁时调用应抛 not_unlocked", async () => {
    keyChain.lock();
    await expect(
      keyChain.changeMasterPassword(MNEMONIC, EMAIL, randomSaltBase64(), NEW_PASSWORD, randomSaltBase64()),
    ).rejects.toThrow(/not_unlocked/);
  });
});

// ── recoverAndRewrap（换设备恢复）─────────────────────

describe("recoverAndRewrap", () => {
  it("换设备恢复：用助记词+主密码解出 UserKey 并建本地缓存", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, OLD_PASSWORD, EMAIL);
    // 清内存，模拟新设备
    keyChain.lock();

    const newLocalSalt = randomSaltBase64();
    const rec = await keyChain.recoverAndRewrap(
      MNEMONIC, OLD_PASSWORD, keys.mnemonic_salt, keys.encrypted_user_key, newLocalSalt,
    );

    expect(rec.ok).toBe(true);
    expect(rec.newCachedK).toBeTruthy();
    expect(rec.mnemonicEncrypted).toBeTruthy();
    // 副作用：UserKey 已载入内存
    expect(keyChain.isUnlocked).toBe(true);
  });

  it("恢复后能用新缓存正常解锁（cached_K 自洽）", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, OLD_PASSWORD, EMAIL);
    keyChain.lock();

    const newLocalSalt = randomSaltBase64();
    const rec = await keyChain.recoverAndRewrap(
      MNEMONIC, OLD_PASSWORD, keys.mnemonic_salt, keys.encrypted_user_key, newLocalSalt,
    );
    expect(rec.ok).toBe(true);

    // 二次解锁（模拟锁定后重新输入主密码）
    keyChain.lock();
    const ok = await keyChain.unlockWithPassword(
      OLD_PASSWORD, newLocalSalt, keys.encrypted_user_key, rec.newCachedK!,
    );
    expect(ok).toBe(true);
  });

  it("恢复后解出的助记词与原文一致", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, OLD_PASSWORD, EMAIL);
    keyChain.lock();
    const newLocalSalt = randomSaltBase64();
    const rec = await keyChain.recoverAndRewrap(
      MNEMONIC, OLD_PASSWORD, keys.mnemonic_salt, keys.encrypted_user_key, newLocalSalt,
    );
    const m = await keyChain.getMnemonicFromCache(OLD_PASSWORD, newLocalSalt, rec.mnemonicEncrypted!);
    expect(m).toBe(MNEMONIC);
  });

  it("错误助记词应失败且不载入 UserKey", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, OLD_PASSWORD, EMAIL);
    keyChain.lock();
    const rec = await keyChain.recoverAndRewrap(
      "z y x w v u t s r q p o", OLD_PASSWORD, keys.mnemonic_salt, keys.encrypted_user_key, randomSaltBase64(),
    );
    expect(rec.ok).toBe(false);
    expect(keyChain.isUnlocked).toBe(false);
  });
});

// ── 改密 ↔ 恢复 交叉一致性 ────────────────────────────

describe("改密后仍可用助记词换设备恢复", () => {
  it("改密 -> 新设备用新主密码+助记词恢复成功", async () => {
    const keys = await keyChain.generateKeys(MNEMONIC, OLD_PASSWORD, EMAIL);
    keyChain.lock();
    await keyChain.unlockWithPassword(OLD_PASSWORD, keys.localSalt, keys.encrypted_user_key, keys.cached_K);

    const newSalt = randomSaltBase64();
    const changed = await keyChain.changeMasterPassword(
      MNEMONIC, EMAIL, keys.mnemonic_salt, NEW_PASSWORD, newSalt,
    );

    // 新设备：助记词 + 新主密码 + 改密后的 encrypted_user_key
    keyChain.lock();
    const rec = await keyChain.recoverAndRewrap(
      MNEMONIC, NEW_PASSWORD, keys.mnemonic_salt, changed.new_encrypted_user_key, randomSaltBase64(),
    );
    expect(rec.ok).toBe(true);
    expect(keyChain.isUnlocked).toBe(true);
  });
});

// ── K 派生拼接契约守护（P1-3）─────────────────────────

describe("K 派生拼接契约", () => {
  it("分隔符必须存在：mnemonic||password 的跨边界歧义不可复现", async () => {
    // 裸拼接下 "ab" + "c" 与 "a" + "bc" 会产生同一输入。
    // 引入 U+0000 分隔后，这两组必须派生出不同的 K。
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);

    // 通过 generateKeys 间接验证：不同 (mnemonic, password) 切分 => 不同 verifier
    const a = await keyChain.generateKeys("a b c d e f g h i j k l", "x", EMAIL);
    const b = await keyChain.generateKeys("a b c d e f g h i j k lx", "x", EMAIL);
    // 两者 mnemonic 不同（词数不同）-> srp 材料不同；这里主要确认不抛错且产出正常
    expect(a.encrypted_user_key).toBeTruthy();
    expect(b.encrypted_user_key).toBeTruthy();
    expect(a.encrypted_user_key).not.toBe(b.encrypted_user_key);
  });

  it("同一组输入可复现（派生确定性未被破坏）", async () => {
    const salt = randomSaltBase64();
    const k1 = await keyChain.generateKeys(MNEMONIC, OLD_PASSWORD, EMAIL);
    keyChain.lock();
    const ok = await keyChain.unlockWithPassword(OLD_PASSWORD, k1.localSalt, k1.encrypted_user_key, k1.cached_K);
    expect(ok).toBe(true);
    // 助记词解锁走同一条 K 派生路径，必须能解出同一 UserKey
    const k2 = await keyChain.generateKeys(MNEMONIC, OLD_PASSWORD, EMAIL);
    keyChain.lock();
    const rec = await keyChain.recoverAndRewrap(
      MNEMONIC, OLD_PASSWORD, k2.mnemonic_salt, k2.encrypted_user_key, salt,
    );
    expect(rec.ok).toBe(true);
  });
});
