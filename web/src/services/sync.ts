/**
 * SyncService — push-then-pull 同步
 * 对应 Android SyncRepository.kt
 */
import { apiClient } from "./api";
import {
  getDirtyItems,
  getDeletedDirtyItems,
  clearDirty,
  markSynced,
  upsertFromServer,
  softDeleteByServerId,
} from "../db/itemsStore";
import { getLastSyncTime, updateLastSyncTime, getLastSyncId, updateLastSyncId } from "../db/sessionStore";
import type { ConflictInfo, EncryptedField } from "../types/domain";

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: ConflictInfo[];
}

/** 空加密字段占位（服务端字段缺失时使用） */
const EMPTY_FIELD: EncryptedField = { encrypted_key: "", ciphertext: "" };

/**
 * 安全解析服务端返回的加密字段 JSON。
 *
 * 服务端字段是 JSON 字符串（EncryptedField 的序列化），但可能因数据损坏/版本不匹配
 * 返回非法 JSON。早期实现直接 JSON.parse 会让**整轮同步抛异常**（一条坏数据阻断全部条目）。
 * 这里兜底为 null，由调用方决定跳过该条。
 */
function parseField(raw: string | null | undefined): EncryptedField | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "ciphertext" in parsed) {
      return parsed as EncryptedField;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 解析服务端 ISO 时间戳为毫秒数；非法输入返回 null。
 *
 * 服务端 updated_at 理论上是 ISO 8601，但 null / 空串 / 非日期串都可能出现
 * （上游字段变更、时区格式异常）。new Date("junk").getTime() === NaN，
 * 而 NaN 作为 updatedAt 落库后，按 updatedAt 排序/比较的代码会**静默失序** ——
 * 条目既不会报错也不会消失，只是永远排在错误的位置。宁可跳过该条。
 */
function parseServerTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export async function sync(): Promise<SyncResult> {
  let pushed = 0;
  let pulled = 0;
  const conflicts: ConflictInfo[] = [];
  // 冲突条目的本地信息（push 阶段收集，pull 阶段匹配服务端版本）
  const pendingConflicts: Array<{ localDid: number; serverId: string; localUpdatedAt: number }> = [];

  // 1. Push dirty items
  const dirtyItems = await getDirtyItems();
  if (dirtyItems.length > 0) {
    const pushResult = await apiClient.push({
      items: dirtyItems.map((item) => ({
        client_did: item.did ?? null,
        server_id: item.serverId ?? null,
        type: item.type,
        icon: item.icon,
        name: JSON.stringify(item.name),
        description: item.description ? JSON.stringify(item.description) : null,
        data: JSON.stringify(item.data),
        version: item.version,
        updated_at: new Date(item.updatedAt).toISOString(),
      })),
    });

    for (const [i, result] of pushResult.results.entries()) {
      if (result.status === "conflict") {
        // 冲突：保留本地版本，等待 pull 阶段获取服务端版本后由用户选择
        const local = dirtyItems[i];
        if (local?.did && local.serverId) {
          pendingConflicts.push({
            localDid: local.did,
            serverId: local.serverId,
            localUpdatedAt: local.updatedAt,
          });
        }
      } else if (
        (result.status === "created" || result.status === "updated") &&
        result.server_id &&
        dirtyItems[i]?.did
      ) {
        // 落库服务端权威 version，作为下次 push 的乐观并发基线
        await markSynced(dirtyItems[i].did!, result.server_id, result.version ?? undefined);
        pushed++;
      }
    }
  }

  // 1.5 Push deletions（本地已删除的条目通知服务端软删除）
  const deletedItems = await getDeletedDirtyItems();
  if (deletedItems.length > 0) {
    const withServer = deletedItems.filter((item) => item.serverId);
    if (withServer.length > 0) {
      const delResult = await apiClient.delete({
        server_ids: withServer.map((item) => item.serverId!),
      });
      // deleted / not_found 都视为服务端已无该条目，清本地脏标记（保留墓碑）
      const doneIds = new Set(
        delResult.results
          .filter((r) => r.status === "deleted" || r.status === "not_found")
          .map((r) => r.server_id),
      );
      for (const item of withServer) {
        if (item.did && item.serverId && doneIds.has(item.serverId)) {
          await clearDirty(item.did);
          pushed++;
        }
      }
    }
    // 本地创建但从未同步就删除的：服务端无需知道，直接清脏标记
    for (const item of deletedItems.filter((i) => !i.serverId)) {
      if (item.did) await clearDirty(item.did);
    }
  }

  // 2. Pull server changes (paginated, keyset (updated_at, id) 防同 updated_at 跨页丢失)
  let since = await getLastSyncTime();
  let sinceId = await getLastSyncId();
  let hasMore = true;
  let lastServerTime = since;
  let lastServerId = sinceId;
  const conflictServerIds = new Set(pendingConflicts.map((c) => c.serverId));

  while (hasMore) {
    const pullResult = await apiClient.pull(since, sinceId ?? undefined, 100);
    hasMore = pullResult.has_more;

    const toUpsert: Array<{
      type: string;
      icon: string | null;
      name: EncryptedField;
      description: EncryptedField | null;
      data: EncryptedField;
      serverId: string | null;
      version: number;
      isDirty: boolean;
      updatedAt: number;
    }> = [];

    for (const remote of pullResult.items) {
      if (remote.is_deleted) {
        if (remote.server_id) {
          await softDeleteByServerId(remote.server_id);
          pulled++;
        }
        continue;
      }

      // 解析加密字段；name 解析失败 -> 该条目损坏，跳过（不让一条坏数据阻断整轮同步）
      const nameField = parseField(remote.name);
      if (!nameField) {
        console.warn(`[sync] 跳过损坏条目 server_id=${remote.server_id}（name 非法 JSON）`);
        continue;
      }
      const descField = parseField(remote.description);
      const dataField = parseField(remote.data) ?? EMPTY_FIELD;

      // 时间戳非法 -> 该条无法安全落库（NaN 会污染排序），跳过
      const remoteMs = parseServerTime(remote.updated_at);
      if (remoteMs === null) {
        console.warn(`[sync] 跳过损坏条目 server_id=${remote.server_id}（updated_at 非法）`);
        continue;
      }

      if (remote.server_id && conflictServerIds.has(remote.server_id)) {
        // 冲突条目的服务端版本：不自动 upsert，捕获供用户选「使用服务端」时应用
        const local = pendingConflicts.find((c) => c.serverId === remote.server_id);
        if (local) {
          conflicts.push({
            localDid: local.localDid,
            serverId: remote.server_id,
            localUpdatedAt: local.localUpdatedAt,
            serverUpdatedAt: remoteMs,
            serverItem: {
              type: remote.type,
              icon: remote.icon,
              name: nameField,
              description: descField,
              data: dataField,
              version: remote.version,
              updatedAt: remoteMs,
            },
          });
        }
      } else {
        toUpsert.push({
          type: remote.type,
          icon: remote.icon,
          name: nameField,
          description: descField,
          data: dataField,
          serverId: remote.server_id,
          version: remote.version,
          isDirty: false,
          updatedAt: remoteMs,
        });
      }
    }

    if (toUpsert.length > 0) {
      await upsertFromServer(toUpsert);
      pulled += toUpsert.length;
    }

    lastServerTime = pullResult.server_time;
    lastServerId = pullResult.server_id;
    since = pullResult.server_time;
    sinceId = pullResult.server_id;
  }

  if (lastServerTime) {
    await updateLastSyncTime(lastServerTime);
    await updateLastSyncId(lastServerId);
  }

  return { pushed, pulled, conflicts };
}
