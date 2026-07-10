/**
 * H5 回归测试 — 本地删除必须传播到服务端（POST /sync/delete）
 *
 * 用 fake-indexeddb 跑真实 itemsStore/sessionStore，mock apiClient 观察调用。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

// mock apiClient：记录 delete 调用，push/pull 返回空
const pushMock = vi.fn(async () => ({ results: [] }));
const pullMock = vi.fn(async () => ({
  items: [],
  has_more: false,
  server_time: "2020-01-01T00:00:00+00:00",
}));
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

describe("sync() — 删除传播 (H5)", () => {
  beforeEach(async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    await db.clear("items");
    await db.clear("session");
    pushMock.mockClear();
    pullMock.mockClear();
    deleteMock.mockClear();
  });

  it("已同步条目被本地软删后，sync 调用 /sync/delete 并清除脏标记", async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    // 一个已同步（有 serverId）、随后被本地软删的条目
    const did = await db.add("items", {
      uid: "u1", type: "login", icon: null,
      name: mockField("secret"), description: null, data: mockField("{}"),
      serverId: "srv-123", version: 1,
      isDirty: true, isDeleted: true,
      updatedAt: Date.now(), createdAt: Date.now(),
    } as any);

    const { sync } = await import("../services/sync");
    await sync();

    // 删除被传播到服务端
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock.mock.calls[0][0].server_ids).toContain("srv-123");

    // 本地脏标记被清除（墓碑保留）
    const item = await db.get("items", did as number);
    expect(item?.isDirty).toBe(false);
    expect(item?.isDeleted).toBe(true);
  });

  it("从未同步（无 serverId）就删除的条目不调用 /sync/delete，但清除脏标记", async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    const did = await db.add("items", {
      uid: "u1", type: "note", icon: null,
      name: mockField("local-only"), description: null, data: mockField("{}"),
      serverId: null, version: 1,
      isDirty: true, isDeleted: true,
      updatedAt: Date.now(), createdAt: Date.now(),
    } as any);

    const { sync } = await import("../services/sync");
    await sync();

    expect(deleteMock).not.toHaveBeenCalled();
    const item = await db.get("items", did as number);
    expect(item?.isDirty).toBe(false);
  });
});
