/**
 * Web 客户端集成测试 — IndexedDB / API / 认证流程
 *
 * 注意：这些测试使用 fake-indexeddb 模拟浏览器 IndexedDB，
 * crypto.subtle 需要 Node 21+ 的原生 Web Crypto 支持。
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import "fake-indexeddb/auto";

// v2 加密字段 mock（测试 DB 层逻辑，不测真实加密）
function mockField(value: string) {
  return { encrypted_key: "mock-key", ciphertext: value };
}

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
      name: mockField("test-item"),
      description: mockField("test desc"),
      data: mockField('{"username":"alice"}'),
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
    expect(items[0].name).toEqual(mockField("test-item"));
    expect(items[0].type).toBe("login");
    expect(items[0].isDirty).toBe(true);
  });

  it("upsertItem updates existing item", async () => {
    const { upsertItem, getUserItems } = await import("../db/itemsStore");
    const did = await upsertItem({
      uid: "test-user",
      type: "login",
      icon: null,
      name: mockField("original"),
      description: null,
      data: mockField(""),
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
      name: mockField("updated-name"),
      description: mockField("new desc"),
      data: mockField('{"package":"com.test"}'),
      serverId: null,
      version: 2,
      isDirty: true,
      isDeleted: false,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    });

    const { getItem } = await import("../db/itemsStore");
    const item = await getItem(did);
    expect(item?.name).toEqual(mockField("updated-name"));
    expect(item?.description).toEqual(mockField("new desc"));
  });

  it("softDeleteItem marks item as deleted", async () => {
    const { upsertItem, softDeleteItem, getUserItems } = await import("../db/itemsStore");
    const did = await upsertItem({
      uid: "test-user",
      type: "file",
      icon: null,
      name: mockField("to-delete"),
      description: null,
      data: mockField(""),
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
      uid: "test-user", type: "login", icon: null, name: mockField("dirty1"), description: null, data: mockField(""),
      serverId: null, version: 1, isDirty: true, isDeleted: false, updatedAt: Date.now(), createdAt: Date.now(),
    });
    const did2 = await upsertItem({
      uid: "test-user", type: "login", icon: null, name: mockField("dirty2"), description: null, data: mockField(""),
      serverId: null, version: 1, isDirty: true, isDeleted: false, updatedAt: Date.now(), createdAt: Date.now(),
    });

    // 标记第一个为已同步
    await markSynced(did1, "server-id-123");

    const dirty = await getDirtyItems();
    expect(dirty.length).toBe(1);
    expect(dirty[0].name).toEqual(mockField("dirty2"));
  });

  it("markSynced sets isDirty=false and sets serverId", async () => {
    const { upsertItem, markSynced, getItem } = await import("../db/itemsStore");
    const did = await upsertItem({
      uid: "test-user", type: "login", icon: null, name: mockField("synced"), description: null, data: mockField(""),
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
      uid: "test-user", type: "login", icon: null, name: mockField("item-a"), description: null, data: mockField(""),
      serverId: null, version: 1, isDirty: true, isDeleted: false, updatedAt: 1000, createdAt: 1000,
    });
    // 短暂延迟确保时间戳不同
    await new Promise((r) => setTimeout(r, 10));
    await upsertItem({
      uid: "test-user", type: "login", icon: null, name: mockField("item-b"), description: null, data: mockField(""),
      serverId: null, version: 1, isDirty: true, isDeleted: false, updatedAt: Date.now(), createdAt: Date.now(),
    });

    const items = await getUserItems('test-user');
    expect(items.length).toBe(2);
    // 按 updatedAt 倒序，item-b 应该在前（更新时间更晚）
    expect(items[0].name).toEqual(mockField("item-b"));
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
      loginSalt: "salt-base64",
      encrypted_user_key: "wrapped-base64",
      recovery_salt: "enc-priv-base64",
      has_master_password: false,
      lastSyncTime: "2025-06-01T00:00:00+00:00",
    });

    const session = await getSession();
    expect(session.accessToken).toBe("test-access-token");
    expect(session.loginSalt).toBe("salt-base64");
    expect(session.lastSyncTime).toBe("2025-06-01T00:00:00+00:00");
  });

  it("updateTokens only updates tokens", async () => {
    const { saveSession, getSession, updateTokens } = await import("../db/sessionStore");
    await saveSession({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      loginSalt: "keep-this",
    });
    await updateTokens("new-access", "new-refresh");

    const session = await getSession();
    expect(session.accessToken).toBe("new-access");
    expect(session.refreshToken).toBe("new-refresh");
    expect(session.loginSalt).toBe("keep-this"); // 保留其他字段
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
    await saveSession({ accessToken: "token", loginSalt: "salt" });
    await clearSession();
    const session = await getSession();
    expect(session.accessToken).toBe("");
    expect(session.loginSalt).toBe("");
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
