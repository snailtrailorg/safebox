/**
 * Web 客户端集成测试 — IndexedDB / KeyManager / API / 认证流程
 *
 * 注意：这些测试使用 fake-indexeddb 模拟浏览器 IndexedDB，
 * crypto.subtle 需要 Node 21+ 的原生 Web Crypto 支持。
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import "fake-indexeddb/auto";

// ── DB 层测试 ────────────────────────────────────

describe("IndexedDB — itemsStore", () => {
  beforeEach(async () => {
    // 每个测试前清除数据库
    const { getDb } = await import("../db/database");
    const db = await getDb();
    await db.clear("items");
    await db.clear("session");
  });

  it("getUserItems returns empty for new DB", async () => {
    const { getUserItems } = await import("../db/itemsStore");
    const items = await getUserItems('test-user');
    expect(items).toEqual([]);
  });

  it("upsertItem creates new item and returns did", async () => {
    const { upsertItem, getUserItems } = await import("../db/itemsStore");
    const did = await upsertItem({
      uid: "test-user",
      type: "login",
      icon: null,
      name: "test-item",
      description: "test desc",
      data: '{"username":"alice"}',
      serverId: null,
      version: 1,
      isDirty: true,
      isDeleted: false,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    });
    expect(did).toBeGreaterThan(0);

    const items = await getUserItems('test-user');
    expect(items.length).toBe(1);
    expect(items[0].name).toBe("test-item");
    expect(items[0].type).toBe("login");
    expect(items[0].isDirty).toBe(true);
  });

  it("upsertItem updates existing item", async () => {
    const { upsertItem, getUserItems } = await import("../db/itemsStore");
    const did = await upsertItem({
      uid: "test-user",
      type: "login",
      icon: null,
      name: "original",
      description: null,
      data: null,
      serverId: null,
      version: 1,
      isDirty: true,
      isDeleted: false,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    });

    await upsertItem({
      did,
      uid: "test-user",
      type: "login",
      icon: null,
      name: "updated-name",
      description: "new desc",
      data: '{"package":"com.test"}',
      serverId: null,
      version: 2,
      isDirty: true,
      isDeleted: false,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    });

    const { getItem } = await import("../db/itemsStore");
    const item = await getItem(did);
    expect(item?.name).toBe("updated-name");
    expect(item?.description).toBe("new desc");
  });

  it("softDeleteItem marks item as deleted", async () => {
    const { upsertItem, softDeleteItem, getUserItems } = await import("../db/itemsStore");
    const did = await upsertItem({
      uid: "test-user",
      type: "file",
      icon: null,
      name: "to-delete",
      description: null,
      data: null,
      serverId: null,
      version: 1,
      isDirty: true,
      isDeleted: false,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    });

    await softDeleteItem(did);
    const items = await getUserItems('test-user');
    expect(items.find((i) => i.did === did)).toBeUndefined();

    const { getItem } = await import("../db/itemsStore");
    const item = await getItem(did);
    expect(item?.isDeleted).toBe(true);
  });

  it("getDirtyItems returns only dirty undeleted items", async () => {
    const { upsertItem, getDirtyItems, markSynced } = await import("../db/itemsStore");

    const did1 = await upsertItem({
      uid: "test-user", type: "login", icon: null, name: "dirty1", description: null, data: null,
      serverId: null, version: 1, isDirty: true, isDeleted: false, updatedAt: Date.now(), createdAt: Date.now(),
    });
    const did2 = await upsertItem({
      uid: "test-user", type: "login", icon: null, name: "dirty2", description: null, data: null,
      serverId: null, version: 1, isDirty: true, isDeleted: false, updatedAt: Date.now(), createdAt: Date.now(),
    });

    // 标记第一个为已同步
    await markSynced(did1, "server-id-123");

    const dirty = await getDirtyItems();
    expect(dirty.length).toBe(1);
    expect(dirty[0].name).toBe("dirty2");
  });

  it("markSynced sets isDirty=false and sets serverId", async () => {
    const { upsertItem, markSynced, getItem } = await import("../db/itemsStore");
    const did = await upsertItem({
      uid: "test-user", type: "login", icon: null, name: "synced", description: null, data: null,
      serverId: null, version: 1, isDirty: true, isDeleted: false, updatedAt: Date.now(), createdAt: Date.now(),
    });

    await markSynced(did, "svr-abc");
    const item = await getItem(did);
    expect(item?.isDirty).toBe(false);
    expect(item?.serverId).toBe("svr-abc");
  });

  it("getUserItems returns items and they are non-empty", async () => {
    const { upsertItem, getUserItems } = await import("../db/itemsStore");
    await upsertItem({
      uid: "test-user", type: "login", icon: null, name: "item-a", description: null, data: null,
      serverId: null, version: 1, isDirty: true, isDeleted: false, updatedAt: 1000, createdAt: 1000,
    });
    // 短暂延迟确保时间戳不同
    await new Promise((r) => setTimeout(r, 10));
    await upsertItem({
      uid: "test-user", type: "login", icon: null, name: "item-b", description: null, data: null,
      serverId: null, version: 1, isDirty: true, isDeleted: false, updatedAt: Date.now(), createdAt: Date.now(),
    });

    const items = await getUserItems('test-user');
    expect(items.length).toBe(2);
    // 按 updatedAt 倒序，item-b 应该在前（更新时间更晚）
    expect(items[0].name).toBe("item-b");
  });
});

// ── Session Store 测试 ───────────────────────────

describe("IndexedDB — sessionStore", () => {
  beforeEach(async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    await db.clear("session");
    await db.clear("items");
  });
  it("getSession returns empty defaults when no session", async () => {
    const { clearSession, getSession } = await import("../db/sessionStore");
    await clearSession();
    const session = await getSession();
    expect(session.accessToken).toBe("");
    expect(session.lastSyncTime).toBe("2020-01-01T00:00:00+00:00");
  });

  it("saveSession and getSession roundtrip", async () => {
    const { saveSession, getSession } = await import("../db/sessionStore");
    await saveSession({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      serverUserId: "user-1",
      passwordSalt: "salt-base64",
      passwordWrapped: "wrapped-base64",
      recoveryWrapped: "recovery-base64",
      encryptedPrivate: "enc-priv-base64",
      rsaPublicKey: "rsa-pub-base64",
      lastSyncTime: "2025-06-01T00:00:00+00:00",
    });

    const session = await getSession();
    expect(session.accessToken).toBe("test-access-token");
    expect(session.passwordSalt).toBe("salt-base64");
    expect(session.lastSyncTime).toBe("2025-06-01T00:00:00+00:00");
  });

  it("updateTokens only updates tokens", async () => {
    const { saveSession, getSession, updateTokens } = await import("../db/sessionStore");
    await saveSession({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      passwordSalt: "keep-this",
    });
    await updateTokens("new-access", "new-refresh");

    const session = await getSession();
    expect(session.accessToken).toBe("new-access");
    expect(session.refreshToken).toBe("new-refresh");
    expect(session.passwordSalt).toBe("keep-this"); // 保留其他字段
  });

  it("hasSession returns false when no token", async () => {
    const { clearSession } = await import("../db/sessionStore");
    await clearSession();
    const { hasSession } = await import("../db/sessionStore");
    expect(await hasSession()).toBe(false);
  });

  it("hasSession returns true when token exists", async () => {
    const { saveSession, hasSession } = await import("../db/sessionStore");
    await saveSession({ accessToken: "some-token" });
    expect(await hasSession()).toBe(true);
  });

  it("clearSession removes all data", async () => {
    const { saveSession, clearSession, getSession } = await import("../db/sessionStore");
    await saveSession({ accessToken: "token", passwordSalt: "salt" });
    await clearSession();
    const session = await getSession();
    expect(session.accessToken).toBe("");
    expect(session.passwordSalt).toBe("");
  });
});

// ── KeyManager 集成测试 ──────────────────────────

describe("KeyManager", () => {
  it("generateKeys produces all required fields", async () => {
    const { keyManager } = await import("../services/keyManager");
    const keys = await keyManager.generateKeys("test-password");
    expect(keys.authKeyHash).toBeTruthy();
    expect(keys.passwordSalt).toBeTruthy();
    expect(keys.passwordWrapped).toBeTruthy();
    expect(keys.recoveryWrapped).toBeTruthy();
    expect(keys.encryptedPrivate).toBeTruthy();
    expect(keys.rsaPublicKey).toBeTruthy();
    expect(keys.recoveryCode).toBeTruthy();
    expect(keys.recoveryCode.split(" ").length).toBe(12);
    expect(keyManager.isUnlocked).toBe(true);
    expect(keyManager.isRsaLoaded).toBe(true);
    expect(keyManager.currentRecoveryCode).toBe(keys.recoveryCode);
  });

  it("unlockWithPassword roundtrip", async () => {
    const { keyManager } = await import("../services/keyManager");
    const keys = await keyManager.generateKeys("my-password");
    keyManager.lock();
    expect(keyManager.isUnlocked).toBe(false);

    const ok = await keyManager.unlockWithPassword("my-password", keys.passwordSalt, keys.passwordWrapped);
    expect(ok).toBe(true);
    expect(keyManager.isUnlocked).toBe(true);
  });

  it("unlockWithPassword fails with wrong password", async () => {
    const { keyManager } = await import("../services/keyManager");
    const keys = await keyManager.generateKeys("correct");
    keyManager.lock();
    const ok = await keyManager.unlockWithPassword("wrong", keys.passwordSalt, keys.passwordWrapped);
    expect(ok).toBe(false);
  });

  it("unlockWithRecoveryCode roundtrip", async () => {
    const { keyManager } = await import("../services/keyManager");
    const keys = await keyManager.generateKeys("password");
    const recoveryCode = keys.recoveryCode;
    keyManager.lock();

    const ok = await keyManager.unlockWithRecoveryCode(recoveryCode, keys.recoveryWrapped);
    expect(ok).toBe(true);
    expect(keyManager.isUnlocked).toBe(true);
  });

  it("unlockWithRecoveryCode fails with wrong code", async () => {
    const { keyManager } = await import("../services/keyManager");
    const keys = await keyManager.generateKeys("password");
    keyManager.lock();
    const ok = await keyManager.unlockWithRecoveryCode("zoo zone zero zebra youth young you yellow year yard wrong write", keys.recoveryWrapped);
    expect(ok).toBe(false);
  });

  it("loadRsaKeys after password unlock", async () => {
    const { keyManager } = await import("../services/keyManager");
    const keys = await keyManager.generateKeys("test123");
    const { encryptedPrivate, rsaPublicKey } = keys;
    const { passwordSalt, passwordWrapped } = keys;

    keyManager.lock();
    await keyManager.unlockWithPassword("test123", passwordSalt, passwordWrapped);
    const loaded = await keyManager.loadRsaKeys(encryptedPrivate, rsaPublicKey);
    expect(loaded).toBe(true);
    expect(keyManager.isRsaLoaded).toBe(true);
  });

  it("encryptItemData / decryptItemData roundtrip", async () => {
    const { keyManager } = await import("../services/keyManager");
    await keyManager.generateKeys("test");

    const data = JSON.stringify({ username: "bob", password: "secret123" });
    const encrypted = await keyManager.encryptItemData(data);
    expect(encrypted).not.toBeNull();

    const decrypted = await keyManager.decryptItemData(encrypted!);
    expect(JSON.parse(decrypted!)).toEqual({ username: "bob", password: "secret123" });
  });

  it("lock clears all keys", async () => {
    const { keyManager } = await import("../services/keyManager");
    await keyManager.generateKeys("test");
    expect(keyManager.isUnlocked).toBe(true);
    expect(keyManager.isRsaLoaded).toBe(true);

    keyManager.lock();
    expect(keyManager.isUnlocked).toBe(false);
    expect(keyManager.isRsaLoaded).toBe(false);
  });
});

// ── 密码生成器测试 ───────────────────────────────

describe("Password Generator", () => {
  it("generatePassword default length is 16", async () => {
    const { generatePassword } = await import("../utils/password");
    const pwd = generatePassword();
    expect(pwd.length).toBe(16);
  });

  it("generatePassword respects length option", async () => {
    const { generatePassword } = await import("../utils/password");
    const pwd = generatePassword({ length: 32 });
    expect(pwd.length).toBe(32);
  });

  it("generatePassword produces different values", async () => {
    const { generatePassword } = await import("../utils/password");
    const p1 = generatePassword();
    const p2 = generatePassword();
    expect(p1).not.toBe(p2);
  });
});
