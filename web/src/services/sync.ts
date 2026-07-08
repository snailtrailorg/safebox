/**
 * SyncService — push-then-pull 同步
 * 对应 Android SyncRepository.kt
 */
import { apiClient } from "./api";
import {
  getDirtyItems,
  markSynced,
  upsertFromServer,
  softDeleteByServerId,
} from "../db/itemsStore";
import { getLastSyncTime, updateLastSyncTime } from "../db/sessionStore";
import type { ConflictInfo } from "../types/domain";

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
        type: item.type,
        icon: item.icon,
        name: item.name,
        description: item.description,
        data: item.data,
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
        await markSynced(dirtyItems[i].did!, result.server_id);
        pushed++;
      }
    }
  }

  // 2. Pull server changes (paginated)
  let since = await getLastSyncTime();
  let hasMore = true;
  let lastServerTime = since;
  const conflictServerIds = new Set(pendingConflicts.map((c) => c.serverId));

  while (hasMore) {
    const pullResult = await apiClient.pull(since, 100);
    hasMore = pullResult.has_more;

    const toUpsert: Array<{
      type: string;
      icon: string | null;
      name: string;
      description: string | null;
      data: string | null;
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
        // 冲突条目的服务端版本：不自动 upsert，等待用户选择
        const local = pendingConflicts.find((c) => c.serverId === remote.server_id);
        if (local) {
          conflicts.push({
            localDid: local.localDid,
            serverId: remote.server_id,
            localUpdatedAt: local.localUpdatedAt,
            serverUpdatedAt: new Date(remote.updated_at).getTime(),
          });
        }
      } else {
        toUpsert.push({
          type: remote.type,
          icon: remote.icon,
          name: remote.name,
          description: remote.description,
          data: remote.data,
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
    since = pullResult.server_time;
  }

  if (lastServerTime) {
    await updateLastSyncTime(lastServerTime);
  }

  return { pushed, pulled, conflicts };
}
