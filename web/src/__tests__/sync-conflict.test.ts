/**
 * M5 回归测试 - sync 冲突解决两分支 + M6 client_did 跨设备
 *
 * keepLocal：bump updatedAt + 保持 dirty，下次 sync 重新 push 并按 LWW 胜出。
 * useServer：应用 pull 时捕获的服务端版本，本地条目更新而非消失。
 * 用 fake-indexeddb 跑真实 itemsStore，mock apiClient 驱动真实 sync()。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

// mock apiClient
const pushMock = vi.fn();
const pullMock = vi.fn();
const deleteMock = vi.fn(async (req: { server_ids: string[] }) => ({
  results: req.server_ids.map((id) => ({ server_id: id, status: "deleted" as const })),
}));

vi.mock("../services/api", () => ({
  apiClient: {
    push: (...a: unknown[]) => pushMock(...(a as [])),
    pull: (...a: unknown[]) => pullMock(...(a as [])),
    delete: (req: { server_ids: string[] }) => deleteMock(req),
  },
}));

function mockField(value: string) {
  return { encrypted_key: "mock-key", ciphertext: value };
}

describe("sync() 冲突解决 (M5)", () => {
  beforeEach(async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    await db.clear("items");
    await db.clear("session");
    pushMock.mockReset();
    pullMock.mockReset();
    deleteMock.mockReset();
  });

  it("冲突时捕获服务端版本到 ConflictInfo.serverItem", async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    // 本地已同步条目（有 serverId），脏（待 push），与服务端冲突
    await db.put("items", {
      did: 1, uid: "u1", type: "login", icon: null,
      name: mockField("local-name"), description: null, data: mockField("{}"),
      serverId: "srv-1", version: 1,
      isDirty: true, isDeleted: false,
      updatedAt: 1000, createdAt: 500,
    } as any);

    pushMock.mockResolvedValue({
      results: [{ client_did: 1, server_id: "srv-1", status: "conflict" }],
    });
    pullMock.mockResolvedValue({
      items: [{
        server_id: "srv-1", client_did: 1, type: "login", icon: null,
        name: JSON.stringify(mockField("server-name")),
        description: null, data: JSON.stringify(mockField("{}")),
        version: 2, is_deleted: false, updated_at: "2025-01-02T00:00:00+00:00",
      }],
      has_more: false, server_time: "2025-01-02T00:00:00+00:00",
    });

    const { sync } = await import("../services/sync");
    const result = await sync();

    expect(result.conflicts.length).toBe(1);
    const c = result.conflicts[0];
    expect(c.serverId).toBe("srv-1");
    // 捕获了服务端版本（供 useServer 应用）
    expect(c.serverItem).toBeDefined();
    expect(c.serverItem?.name).toEqual(mockField("server-name"));
    expect(c.serverItem?.version).toBe(2);
  });

  it("useServer: 应用捕获的服务端版本，本地条目更新而非消失", async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    await db.put("items", {
      did: 1, uid: "u1", type: "login", icon: null,
      name: mockField("local-name"), description: null, data: mockField("{}"),
      serverId: "srv-1", version: 1,
      isDirty: true, isDeleted: false,
      updatedAt: 1000, createdAt: 500,
    } as any);

    pushMock.mockResolvedValue({
      results: [{ client_did: 1, server_id: "srv-1", status: "conflict" }],
    });
    pullMock.mockResolvedValue({
      items: [{
        server_id: "srv-1", client_did: 1, type: "login", icon: null,
        name: JSON.stringify(mockField("server-name")),
        description: null, data: JSON.stringify(mockField("{}")),
        version: 2, is_deleted: false, updated_at: "2025-01-02T00:00:00+00:00",
      }],
      has_more: false, server_time: "2025-01-02T00:00:00+00:00",
    });

    const { sync } = await import("../services/sync");
    const { upsertFromServer } = await import("../db/itemsStore");
    const result = await sync();
    const c = result.conflicts[0];

    // 用户选「使用服务端」：应用捕获的服务端版本（force=true 覆盖本地脏条目）
    await upsertFromServer([{
      type: c.serverItem!.type,
      icon: c.serverItem!.icon,
      name: c.serverItem!.name,
      description: c.serverItem!.description,
      data: c.serverItem!.data,
      serverId: c.serverId,
      version: c.serverItem!.version,
      isDirty: false,
      updatedAt: c.serverUpdatedAt,
    }], true);

    // 本地条目仍存在（did=1），内容已更新为服务端版本
    const item = await db.get("items", 1);
    expect(item).toBeDefined();
    expect(item?.isDeleted).toBe(false);
    expect(item?.name).toEqual(mockField("server-name"));
    expect(item?.version).toBe(2);
  });

  it("keepLocal: markForRepush 设基线 version 且保持 dirty（下次 push 基线匹配被接受）", async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    await db.put("items", {
      did: 1, uid: "u1", type: "login", icon: null,
      name: mockField("local-name"), description: null, data: mockField("{}"),
      serverId: "srv-1", version: 1,
      isDirty: false, isDeleted: false, // 已同步（冲突场景下 markSynced 后的状态）
      updatedAt: 1000, createdAt: 500,
    } as any);

    const { markForRepush, getDirtyItems } = await import("../db/itemsStore");
    // 服务端当前 version=2（冲突时捕获），认基线为 2
    await markForRepush(1, 2);

    const item = await db.get("items", 1);
    expect(item?.isDirty).toBe(true);
    expect(item?.version).toBe(2); // 基线设为服务端当前
    expect(item?.isDeleted).toBe(false);
    expect(item?.serverId).toBe("srv-1"); // 保留
    // 进入了脏条目队列（下次 push）
    const dirty = await getDirtyItems();
    expect(dirty.find((i) => i.did === 1)).toBeDefined();
  });
});
