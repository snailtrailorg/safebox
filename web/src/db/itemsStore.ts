/**
 * Item CRUD — IndexedDB
 * 对应 Android ItemDao.kt
 */
import { getDb } from "./database";
import { getCurrentUserId } from "./sessionStore";
import type { Item, ItemType, EncryptedField } from "../types/domain";

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
    // 本地有未同步编辑时不覆盖（避免静默丢失用户编辑，让下次 push 冲突处理）
    if (item.isDirty) continue;
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

/** 获取所有「已删除且待同步」的条目（用于向服务端传播删除） */
export async function getDeletedDirtyItems(): Promise<Item[]> {
  const db = await getDb();
  const all = await db.getAll("items");
  return all.filter((item) => item.isDirty && item.isDeleted);
}

/** 清除脏标记（保留其他字段，如 isDeleted 墓碑），避免重复上传 */
export async function clearDirty(did: number): Promise<void> {
  const db = await getDb();
  const item = await db.get("items", did);
  if (item) {
    await db.put("items", { ...item, isDirty: false });
  }
}

/** 标记已同步（并落库服务端权威 version，供下次 push 作为乐观并发基线） */
export async function markSynced(
  did: number,
  serverId: string,
  version?: number,
): Promise<void> {
  const db = await getDb();
  const item = await db.get("items", did);
  if (item) {
    await db.put("items", {
      ...item,
      serverId,
      ...(version != null ? { version } : {}),
      isDirty: false,
    });
  }
}

/** 标记条目重新推送（冲突解决 keepLocal 用）：
 *  设 version 为服务端当前版本（认基线），保持 isDirty=true，
 *  下次 push 基线匹配 -> 接受，本地内容胜出。保留 serverId/isDeleted=false。 */
export async function markForRepush(did: number, baseVersion?: number): Promise<void> {
  const db = await getDb();
  const item = await db.get("items", did);
  if (item) {
    await db.put("items", {
      ...item,
      isDirty: true,
      isDeleted: false,
      updatedAt: Date.now(),
      ...(baseVersion != null ? { version: baseVersion } : {}),
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
    name: EncryptedField;
    description: EncryptedField | null;
    data: EncryptedField;
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
      // 本地有未同步编辑时不覆盖，让 push 冲突处理（避免静默丢失用户编辑）
      if (existing.isDirty) continue;
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
