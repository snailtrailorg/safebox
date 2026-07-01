/**
 * Item CRUD — IndexedDB
 * 对应 Android ItemDao.kt
 */
import { getDb } from "./database";
import { getCurrentUserId } from "./sessionStore";
import type { Item, ItemType } from "../types/domain";

/** 获取用户的所有未删除条目（按更新时间倒序） */
export async function getUserItems(uid: string): Promise<Item[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("items", "by-uid", uid);
  return all
    .filter((item) => !item.isDeleted)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 获取单个条目 */
export async function getItem(did: number): Promise<Item | undefined> {
  const db = await getDb();
  return db.get("items", did);
}

/** 插入或更新条目（REPLACE 策略） */
export async function upsertItem(item: Item): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  const toSave: Item = {
    ...item,
    isDirty: true,
    updatedAt: now,
    createdAt: item.createdAt || now,
  };
  if (toSave.did && toSave.did > 0) {
    await db.put("items", toSave);
    return toSave.did;
  } else {
    const { did, ...rest } = toSave;
    return db.add("items", rest as Item);
  }
}

/** 软删除条目 */
export async function softDeleteItem(did: number): Promise<void> {
  const db = await getDb();
  const item = await db.get("items", did);
  if (item) {
    await db.put("items", {
      ...item,
      isDeleted: true,
      isDirty: true,
      updatedAt: Date.now(),
    });
  }
  // 级联删除关联的文件 blob
  await deleteFileBlob(did);
}

/** 通过 serverId 软删除 */
export async function softDeleteByServerId(serverId: string): Promise<void> {
  const db = await getDb();
  const items = await db.getAllFromIndex("items", "by-serverId", serverId);
  for (const item of items) {
    await db.put("items", {
      ...item,
      isDeleted: true,
      isDirty: false,
      updatedAt: Date.now(),
    });
  }
}

/** 获取所有脏条目（待同步） */
export async function getDirtyItems(): Promise<Item[]> {
  const db = await getDb();
  const all = await db.getAll("items");
  return all.filter((item) => item.isDirty && !item.isDeleted);
}

/** 标记已同步 */
export async function markSynced(
  did: number,
  serverId: string,
): Promise<void> {
  const db = await getDb();
  const item = await db.get("items", did);
  if (item) {
    await db.put("items", {
      ...item,
      serverId,
      isDirty: false,
    });
  }
}

// ── 文件 Blob 操作 ────────────────────────────────

/** 保存加密文件 blob */
export async function saveFileBlob(
  did: number,
  encryptedBlob: string,
): Promise<void> {
  const db = await getDb();
  await db.put("fileBlobs", { did, encryptedBlob });
}

/** 获取加密文件 blob */
export async function getFileBlob(
  did: number,
): Promise<{ encryptedBlob: string } | undefined> {
  const db = await getDb();
  return db.get("fileBlobs", did);
}

/** 删除文件 blob */
export async function deleteFileBlob(did: number): Promise<void> {
  const db = await getDb();
  await db.delete("fileBlobs", did);
}

// ── 从服务器批量 upsert ────────────────────────────

/** 从服务器批量 upsert */
export async function upsertFromServer(
  items: Array<{
    type: string;
    icon: string | null;
    name: string;
    description: string | null;
    data: string | null;
    serverId: string | null;
    version: number;
    isDirty: boolean;
    updatedAt: number;
  }>,
): Promise<void> {
  const db = await getDb();
  for (const remote of items) {
    // 查找已存在的（按 serverId）
    let existing: Item | undefined;
    if (remote.serverId) {
      const matches = await db.getAllFromIndex(
        "items",
        "by-serverId",
        remote.serverId,
      );
      existing = matches.find((i) => !i.isDeleted);
    }

    const now = Date.now();
    if (existing) {
      // 更新
      await db.put("items", {
        ...existing,
        type: remote.type as ItemType,
        icon: remote.icon,
        name: remote.name,
        description: remote.description,
        data: remote.data,
        version: remote.version,
        isDirty: false,
        updatedAt: remote.updatedAt,
      });
    } else {
      // 新增
      const uid = await getCurrentUserId();
      await db.add("items", {
        uid,
        type: remote.type as ItemType,
        icon: remote.icon,
        name: remote.name,
        description: remote.description,
        data: remote.data,
        serverId: remote.serverId,
        version: remote.version,
        isDirty: false,
        isDeleted: false,
        updatedAt: remote.updatedAt,
        createdAt: now,
      });
    }
  }
}
