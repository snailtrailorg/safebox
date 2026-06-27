package org.snailtrail.safebox.data.repository

import kotlinx.coroutines.flow.first
import org.snailtrail.safebox.data.local.ItemEntity
import org.snailtrail.safebox.data.remote.ApiService
import org.snailtrail.safebox.data.remote.dto.*
import org.snailtrail.safebox.domain.SessionManager
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SyncRepository @Inject constructor(
    private val apiService: ApiService,
    private val itemRepository: ItemRepository,
    private val sessionManager: SessionManager,
) {
    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    suspend fun sync(uid: Int): Result<Unit> {
        return try {
            // 1. 先 push 本地脏数据
            pushDirtyItems()
            // 2. 再 pull 服务端更新
            pullRemoteChanges(uid)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private suspend fun pushDirtyItems() {
        val dirtyItems = itemRepository.getDirtyItems()
        if (dirtyItems.isEmpty()) return

        val syncItems = dirtyItems.map { item ->
            SyncItemRequest(
                clientDid = item.did,
                type = item.type,
                icon = item.icon,
                name = item.name,
                description = item.description,
                data = item.data,
                version = item.version,
                updatedAt = isoFormat.format(Date(item.updatedAt)),
            )
        }

        val resp = apiService.syncPush(SyncPushRequest(syncItems))
        if (resp.isSuccessful) {
            val results = resp.body()?.results ?: return
            for ((index, result) in results.withIndex()) {
                if (result.status in listOf("created", "updated") && result.serverId != null) {
                    itemRepository.markSynced(dirtyItems[index].did, result.serverId)
                }
            }
        }
    }

    private suspend fun pullRemoteChanges(uid: Int) {
        val lastSync = sessionManager.lastSyncTime.first() ?: "2020-01-01T00:00:00+00:00"

        var hasMore = true
        var since = lastSync

        while (hasMore) {
            val resp = apiService.syncPull(since)
            if (!resp.isSuccessful) break

            val body = resp.body() ?: break
            hasMore = body.hasMore

            val itemsToUpsert = mutableListOf<ItemEntity>()
            val itemsToDelete = mutableListOf<String>()

            for (remote in body.items) {
                if (remote.isDeleted) {
                    // 服务端已删除
                    if (remote.serverId != null) {
                        itemsToDelete.add(remote.serverId)
                    }
                } else {
                    itemsToUpsert.add(ItemEntity(
                        uid = uid,
                        type = remote.type,
                        icon = remote.icon,
                        name = remote.name,
                        description = remote.description,
                        data = remote.data,
                        serverId = remote.serverId,
                        version = remote.version,
                        isDirty = false,
                        updatedAt = parseIso8601(remote.updatedAt),
                    ))
                }
            }

            itemRepository.upsertFromServer(itemsToUpsert)
            for (serverId in itemsToDelete) {
                itemRepository.softDeleteByServerId(serverId)
            }

            since = body.serverTime
        }

        sessionManager.updateSyncTime(since)
    }

    private fun parseIso8601(iso: String): Long {
        return try {
            isoFormat.parse(iso)?.time ?: System.currentTimeMillis()
        } catch (e: Exception) {
            System.currentTimeMillis()
        }
    }
}
