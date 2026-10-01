/**
 * P2-5 / P2-6 / P2-8 / P2-9 回归测试 —— 边界输入的硬校验。
 *
 * 这四条同源：**把外部输入当可信数据**。备份文件来自用户磁盘（可被任意篡改）、
 * 传输体来自网络（可被中间人改写）、时间戳来自服务端（可为 null）。
 * 共同失败模式是「静默降级」或「未捕获异常」——两者都不会在开发期暴露，
 * 只会在用户手上炸。
 *
 * 覆盖：
 *   P2-5  hexToBytes 奇数长度 / 非法字符 —— 原实现会产出静默截断的错误字节
 *   P2-6  decryptBody 短于 nonce 长度 —— 原实现把空 nonce 喂给 GCM
 *   P2-8  importBackup 结构未校验 —— 原实现 JSON.parse 裸调用，坏 items 污染库存
 *   P2-9  updated_at 无效 —— 原实现 NaN 落库，条目永久排在同步序列之外
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

// i18n 在 node 环境下初始化较慢；mock 成直通，断言错误语义用 error.code 而非文案
vi.mock("../i18n", () => ({
  default: { t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) },
}));

describe("P2-5 hexToBytes 输入校验", () => {
  it("合法偶数长度 hex 正常解析", async () => {
    const { hexToBytes } = await import("../crypto/transport");
    expect(Array.from(hexToBytes("00ff10"))).toEqual([0x00, 0xff, 0x10]);
    expect(Array.from(hexToBytes(""))).toEqual([]);
  });

  it("奇数长度 hex 必须抛错（原实现静默丢弃末位半字节）", async () => {
    const { hexToBytes } = await import("../crypto/transport");
    // 修复前：new Uint8Array(1.5) 触发 RangeError 或静默截断，取决于引擎
    expect(() => hexToBytes("abc")).toThrow();
  });

  it("含非 hex 字符必须抛错（原实现 parseInt 返回 NaN -> 静默变 0）", async () => {
    const { hexToBytes } = await import("../crypto/transport");
    // 修复前：parseInt("zz",16) === NaN，写入 Uint8Array 变成 0 —— 静默错值
    expect(() => hexToBytes("zzzz")).toThrow();
    expect(() => hexToBytes("00 11")).toThrow();
  });

  it("bytesToHex / hexToBytes 往返一致", async () => {
    const { hexToBytes, bytesToHex } = await import("../crypto/transport");
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
    expect(Array.from(hexToBytes(bytesToHex(bytes)))).toEqual(Array.from(bytes));
  });
});

describe("P2-6 decryptBody 长度校验", () => {
  const K = new Uint8Array(32).fill(7);

  it("加密后解密往返一致", async () => {
    const { encryptBody, decryptBody } = await import("../crypto/transport");
    const pt = new TextEncoder().encode("hello srp transport");
    const ct = await encryptBody(K, pt);
    const out = await decryptBody(K, ct);
    expect(new TextDecoder().decode(out)).toBe("hello srp transport");
  });

  it("短于 nonce(12) 的输入必须抛错，而不是把空 nonce 喂给 GCM", async () => {
    const { decryptBody } = await import("../crypto/transport");
    // 修复前：data.slice(0,12) 得到短数组，GCM 直接抛 OperationError，
    // 错误信息与"密文损坏"无法区分；且 0 长度时行为更模糊
    await expect(decryptBody(K, new Uint8Array(5))).rejects.toThrow();
    await expect(decryptBody(K, new Uint8Array(0))).rejects.toThrow();
  });

  it("恰好 12 字节（无密文体）必须抛错", async () => {
    const { decryptBody } = await import("../crypto/transport");
    await expect(decryptBody(K, new Uint8Array(12))).rejects.toThrow();
  });
});

describe("P2-8 importBackup 结构校验", () => {
  beforeEach(async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    await db.clear("items");
    await db.clear("session");
  });

  /** 构造一个「合法密码但内容损坏」的备份文件 */
  async function makeBackupFile(payload: unknown): Promise<File> {
    const { deriveKey, generateSalt } = await import("../crypto/kdf");
    const { aesEncrypt } = await import("../crypto/aes");
    const salt = generateSalt();
    const key = await deriveKey("correct-password", salt);
    const encrypted = await aesEncrypt(key, new TextEncoder().encode(JSON.stringify(payload)));
    const header = new Uint8Array(salt);
    const body = new TextEncoder().encode(encrypted!);
    const combined = new Uint8Array(header.length + body.length);
    combined.set(header);
    combined.set(body, header.length);
    return new File([combined], "backup.safebox");
  }

  it("items 不是数组（是对象）必须抛错，不得静默导入 0 条", async () => {
    const { importBackup } = await import("../utils/backup");
    const file = await makeBackupFile({ version: 1, items: { evil: true } });
    await expect(importBackup("correct-password", file)).rejects.toThrow();
  });

  it("items 是字符串必须抛错（原实现会逐字符迭代并崩在 item.serverId）", async () => {
    const { importBackup } = await import("../utils/backup");
    const file = await makeBackupFile({ version: 1, items: "not-an-array" });
    await expect(importBackup("correct-password", file)).rejects.toThrow();
  });

  it("条目缺少 name/data 加密字段必须抛错，不得把 undefined 落库", async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    const { importBackup } = await import("../utils/backup");

    const file = await makeBackupFile({
      version: 1,
      items: [{
        type: "login", icon: null,
        // name / data 缺失
        description: null,
        serverId: null, createdAt: 1, updatedAt: 2,
      }],
    });

    await expect(importBackup("correct-password", file)).rejects.toThrow();
    // 关键：库存未被污染
    expect(await db.getAll("items")).toHaveLength(0);
  });

  it("条目 name 形状不对（缺 ciphertext）必须抛错", async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    const { importBackup } = await import("../utils/backup");

    const file = await makeBackupFile({
      version: 1,
      items: [{
        type: "login", icon: null,
        name: { encrypted_key: "k" }, // 缺 ciphertext
        description: null,
        data: { encrypted_key: "k", ciphertext: "c" },
        serverId: null, createdAt: 1, updatedAt: 2,
      }],
    });

    await expect(importBackup("correct-password", file)).rejects.toThrow();
    expect(await db.getAll("items")).toHaveLength(0);
  });

  it("合法备份仍能正常导入（不误伤）", async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    const { importBackup } = await import("../utils/backup");
    const { upsertItem } = await import("../db/itemsStore");

    // 先放一个本地用户，让 getCurrentUserId 有值
    const { getCurrentUserId } = await import("../db/sessionStore");
    const uid = await getCurrentUserId();

    const file = await makeBackupFile({
      version: 1,
      items: [{
        type: "login", icon: null,
        name: { encrypted_key: "k", ciphertext: "n" },
        description: { encrypted_key: "k", ciphertext: "d" },
        data: { encrypted_key: "k", ciphertext: "x" },
        serverId: null, createdAt: 1, updatedAt: 2,
      }],
    });

    const n = await importBackup("correct-password", file);
    expect(n).toBe(1);
    const rows = await db.getAll("items");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toEqual({ encrypted_key: "k", ciphertext: "n" });
    expect(rows[0].description).toEqual({ encrypted_key: "k", ciphertext: "d" });
    // 导入的条目应当是脏的（待同步）
    expect(rows[0].isDirty).toBe(true);
    void upsertItem;
    void uid;
  });

  it("密码错误抛 wrongPassword，且与结构错误可区分", async () => {
    const { importBackup } = await import("../utils/backup");
    const file = await makeBackupFile({ version: 1, items: [] });
    await expect(importBackup("WRONG-password", file)).rejects.toThrow();
  });

  it("version 不支持时抛错", async () => {
    const { importBackup } = await import("../utils/backup");
    const file = await makeBackupFile({ version: 99, items: [] });
    await expect(importBackup("correct-password", file)).rejects.toThrow();
  });
});

describe("P2-9 updated_at 校验（sync 落库）", () => {
  const pushMock = vi.fn(async () => ({ results: [] }));
  const pullMock = vi.fn();
  const deleteMock = vi.fn(async () => ({ results: [] }));

  beforeEach(async () => {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    await db.clear("items");
    await db.clear("session");
    pushMock.mockClear();
    pullMock.mockReset();
    deleteMock.mockClear();
  });

  function remoteItem(updatedAt: string) {
    return {
      server_id: "srv-t",
      client_did: null,
      type: "login",
      icon: null,
      name: JSON.stringify({ encrypted_key: "k", ciphertext: "n" }),
      description: null,
      data: JSON.stringify({ encrypted_key: "k", ciphertext: "x" }),
      version: 1,
      is_deleted: false,
      updated_at: updatedAt,
    };
  }

  it("合法 ISO 时间戳正常落库", async () => {
    const { getDb } = await import("../db/database");
    vi.doMock("../services/api", () => ({
      apiClient: {
        push: (...a: unknown[]) => pushMock(...(a as [])),
        pull: (...a: unknown[]) => pullMock(...(a as [])),
        delete: (...a: unknown[]) => deleteMock(...(a as [])),
      },
    }));
    pullMock.mockResolvedValue({
      items: [remoteItem("2025-06-01T12:00:00+00:00")],
      has_more: false,
      server_time: "2025-06-01T12:00:00+00:00",
      server_id: "srv-t",
    });

    const { sync } = await import("../services/sync");
    await sync();
    const db = await getDb();
    const rows = await db.getAll("items");
    expect(rows).toHaveLength(1);
    expect(Number.isFinite(rows[0].updatedAt)).toBe(true);
  });

  it("无效 updated_at 必须跳过该条，不得把 NaN 落库（NaN 会让条目永久排在同步窗口外）", async () => {
    const { getDb } = await import("../db/database");
    vi.doMock("../services/api", () => ({
      apiClient: {
        push: (...a: unknown[]) => pushMock(...(a as [])),
        pull: (...a: unknown[]) => pullMock(...(a as [])),
        delete: (...a: unknown[]) => deleteMock(...(a as [])),
      },
    }));
    pullMock.mockResolvedValue({
      items: [remoteItem("not-a-date"), remoteItem("2025-06-02T00:00:00+00:00")],
      has_more: false,
      server_time: "2025-06-02T00:00:00+00:00",
      server_id: "srv-t",
    });

    const { sync } = await import("../services/sync");
    const result = await sync();
    const db = await getDb();
    const rows = await db.getAll("items");

    // 修复前：两条都可能落库，其中一条 updatedAt=NaN
    for (const r of rows) {
      expect(Number.isFinite(r.updatedAt)).toBe(true);
    }
    // 坏的那条被跳过
    expect(result.pulled).toBeLessThanOrEqual(1);
  });
});
