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
      } else if (remote.server_id && conflictServerIds.has(remote.server_id)) {
        // 冲突条目的服务端版本：不自动 upsert，捕获供用户选「使用服务端」时应用
        const local = pendingConflicts.find((c) => c.serverId === remote.server_id);
        if (local) {
          conflicts.push({
            localDid: local.localDid,
            serverId: remote.server_id,
            localUpdatedAt: local.localUpdatedAt,
            serverUpdatedAt: new Date(remote.updated_at).getTime(),
            serverItem: {
              type: remote.type,
              icon: remote.icon,
              name: JSON.parse(remote.name) as EncryptedField,
              description: remote.description ? JSON.parse(remote.description) as EncryptedField : null,
              data: remote.data ? JSON.parse(remote.data) as EncryptedField : ({ encrypted_key: "", ciphertext: "" } as EncryptedField),
              version: remote.version,
              updatedAt: new Date(remote.updated_at).getTime(),
            },
          });
        }
      } else {
        toUpsert.push({
          type: remote.type,
          icon: remote.icon,
          name: JSON.parse(remote.name) as EncryptedField,
          description: remote.description ? JSON.parse(remote.description) as EncryptedField : null,
          data: remote.data ? JSON.parse(remote.data) as EncryptedField : ({ encrypted_key: "", ciphertext: "" } as EncryptedField),
          serverId: remote.server_id,
          version: remote.version,
          isDirty: false,
          updatedAt: new Date(remote.updated_at).getTime(),
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
