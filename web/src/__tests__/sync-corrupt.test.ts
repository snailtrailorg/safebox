/**
 * P2-7 回归测试 — pull 阶段的服务端字段必须是「安全解析」，不能一条坏数据打断整轮同步。
 *
 * 修复前：`JSON.parse(remote.name)` 裸调用，服务端任一字段是非 JSON 字符串
 * （数据损坏 / 上游版本不匹配）都会让 sync() 整体抛异常 —— 结果是一轮同步里
 * **已经 parse 成功的条目也全部丢失**（异常在 toUpsert 落库之前抛出）。
 * 这是典型的「静默失败的反面：响亮的失败，但代价是整批」。
 *
 * 修复后契约：
 *   1. name 非法 -> 跳过该条（其余条目照常入库），不抛异常；
 *   2. description 非法 -> 置 null，条目仍入库（描述是可空字段）；
 *   3. data 非法 -> 用 EMPTY_FIELD 占位，条目仍入库（data 非空，不能给 null）；
 *   4. 合法 JSON 但不是 EncryptedField 形状（缺 ciphertext）-> 同样视为损坏。
 *
 * 另含一条"反证"：把 parseField 换成裸 JSON.parse 时必须让本文件变红，
 * 否则说明测试没打在真实路径上。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

const pushMock = vi.fn(async () => ({ results: [] }));
const pullMock = vi.fn();
const deleteMock = vi.fn(async () => ({ results: [] }));

vi.mock("../services/api", () => ({
  apiClient: {
    push: (...a: unknown[]) => pushMock(...(a as [])),
    pull: (...a: unknown[]) => pullMock(...(a as [])),
    delete: (...a: unknown[]) => deleteMock(...(a as [])),
  },
}));

function mockField(value: string) {
  return { encrypted_key: "mock-key", ciphertext: value };
}

/** 构造一条服务端条目；字段值原样传入（可传非法字符串） */
function remoteItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    server_id: "srv-ok",
    client_did: null,
    type: "login",
    icon: null,
    name: JSON.stringify(mockField("ok-name")),
    description: null,
    data: JSON.stringify(mockField("{}")),
    version: 1,
    is_deleted: false,
    updated_at: "2025-01-02T00:00:00+00:00",
    ...overrides,
  };
}

async function resetDb() {
  const { getDb } = await import("../db/database");
  const db = await getDb();
  await db.clear("items");
  await db.clear("session");
}

describe("sync() — 服务端字段损坏的兜底 (P2-7)", () => {
  beforeEach(async () => {
    await resetDb();
    pushMock.mockClear();
    pullMock.mockReset();
    deleteMock.mockClear();
  });

  it("name 是非法 JSON：跳过该条，且不抛异常、其余条目照常入库", async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();

    pullMock.mockResolvedValue({
      items: [
        remoteItem({ server_id: "srv-bad", name: "{这不是 JSON" }),
        remoteItem({ server_id: "srv-good" }),
      ],
      has_more: false,
      server_time: "2025-01-02T00:00:00+00:00",
      server_id: "srv-good",
    });

    const { sync } = await import("../services/sync");

    // 关键断言 1：不抛
    const result = await sync();

    // 关键断言 2：坏条目被跳过，好条目正常入库
    expect(result.pulled).toBe(1);
    const rows = await db.getAll("items");
    expect(rows.length).toBe(1);
    expect(rows[0].serverId).toBe("srv-good");
    expect(rows[0].name).toEqual(mockField("ok-name"));
  });

  it("合法 JSON 但非 EncryptedField 形状（缺 ciphertext）：同样按损坏跳过", async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();

    pullMock.mockResolvedValue({
      items: [remoteItem({ server_id: "srv-shape", name: '{"foo":"bar"}' })],
      has_more: false,
      server_time: "2025-01-02T00:00:00+00:00",
      server_id: "srv-shape",
    });

    const { sync } = await import("../services/sync");
    const result = await sync();

    expect(result.pulled).toBe(0);
    expect(await db.getAll("items")).toHaveLength(0);
  });

  it("description 非法 -> 置 null；data 非法 -> EMPTY_FIELD 占位；条目仍入库", async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();

    pullMock.mockResolvedValue({
      items: [
        remoteItem({
          server_id: "srv-degraded",
          description: "not-json{{{",
          data: "]also-bad[",
        }),
      ],
      has_more: false,
      server_time: "2025-01-02T00:00:00+00:00",
      server_id: "srv-degraded",
    });

    const { sync } = await import("../services/sync");
    const result = await sync();

    // 只有 name 决定是否跳过；desc/data 坏则降级
    expect(result.pulled).toBe(1);
    const rows = await db.getAll("items");
    expect(rows).toHaveLength(1);
    // description 可空 -> null
    expect(rows[0].description).toBeNull();
    // data 非空 -> 空占位（不是 null，避免下游解构崩）
    expect(rows[0].data).toEqual({ encrypted_key: "", ciphertext: "" });
    // name 完好
    expect(rows[0].name).toEqual(mockField("ok-name"));
  });

  it("字段为 null/undefined 不抛（服务端可空字段的正常路径）", async () => {
    await resetDb();

    pullMock.mockResolvedValue({
      items: [remoteItem({ server_id: "srv-null", description: null })],
      has_more: false,
      server_time: "2025-01-02T00:00:00+00:00",
      server_id: "srv-null",
    });

    const { sync } = await import("../services/sync");
    const result = await sync();

    expect(result.pulled).toBe(1);
  });

  it("反证：分页存在时坏数据不阻断后续页", async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();

    // 第一页含坏条目 + has_more=true，第二页是好条目
    pullMock
      .mockResolvedValueOnce({
        items: [remoteItem({ server_id: "srv-bad", name: "<html>" })],
        has_more: true,
        server_time: "2025-01-02T00:00:00+00:00",
        server_id: "srv-bad",
      })
      .mockResolvedValueOnce({
        items: [remoteItem({ server_id: "srv-page2" })],
        has_more: false,
        server_time: "2025-01-03T00:00:00+00:00",
        server_id: "srv-page2",
      });

    const { sync } = await import("../services/sync");
    const result = await sync();

    // 第二页没被第一页的坏数据连累
    expect(pullMock).toHaveBeenCalledTimes(2);
    expect(result.pulled).toBe(1);
    const rows = await db.getAll("items");
    expect(rows.map((r) => r.serverId)).toEqual(["srv-page2"]);
  });
});
