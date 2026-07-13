/**
 * keyChain 字段加解密往返测试。
 * 验证 decryptItemField 修复（原 buffer slice 切错致解密必败）+ AAD 绑定。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { keyChain } from "../keychain/keyChain";

describe("keyChain encryptItemField / decryptItemField round-trip", () => {
  beforeAll(async () => {
    // generateKeys 设 userKey（单例），供字段加解密使用
    await keyChain.generateKeys(
      "abandon ability able about above absent absorb abstract accuse achieve acid acoustic",
      "",
      "test-login-password",
    );
  });

  it("加密后解密应还原明文（含中文/特殊字符）", async () => {
    const plain = "我的银行密码 secret123!@#";
    const field = await keyChain.encryptItemField(plain, "name", "login");
    const decrypted = await keyChain.decryptItemField(field, "name", "login");
    expect(decrypted).toBe(plain);
  });

  it("错误 fieldName 的 AAD 解密失败（防密文替换）", async () => {
    const field = await keyChain.encryptItemField("secret", "name", "login");
    const wrong = await keyChain.decryptItemField(field, "data", "login");
    expect(wrong).toBeNull();
  });

  it("错误 itemType 的 AAD 解密失败", async () => {
    const field = await keyChain.encryptItemField("secret", "name", "login");
    const wrong = await keyChain.decryptItemField(field, "name", "card");
    expect(wrong).toBeNull();
  });

  it("每条目独立 Item Key（encrypted_key 不同）", async () => {
    const f1 = await keyChain.encryptItemField("a", "name", "login");
    const f2 = await keyChain.encryptItemField("b", "name", "login");
    expect(f1.encrypted_key).not.toBe(f2.encrypted_key);
  });

  it("description / data 字段独立加密往返", async () => {
    const notePlain = "备注内容 with emoji 🔐";
    const dataPlain = JSON.stringify({ username: "alice", password: "p@ss" });
    const noteField = await keyChain.encryptItemField(notePlain, "description", "note");
    const dataField = await keyChain.encryptItemField(dataPlain, "data", "login");
    expect(await keyChain.decryptItemField(noteField, "description", "note")).toBe(notePlain);
    expect(await keyChain.decryptItemField(dataField, "data", "login")).toBe(dataPlain);
  });
});
