package org.snailtrail.safebox.data.repository

import kotlinx.coroutines.flow.Flow
import org.snailtrail.safebox.data.local.ItemDao
import org.snailtrail.safebox.data.local.ItemEntity
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ItemRepository @Inject constructor(
    private val itemDao: ItemDao,
) {
    fun getUserItems(uid: Int): Flow<List<ItemEntity>> = itemDao.getUserItems(uid)

    suspend fun getItem(did: Int): ItemEntity? = itemDao.getItem(did)

    suspend fun saveItem(item: ItemEntity): Long {
        return itemDao.upsertItem(item.copy(isDirty = true, updatedAt = System.currentTimeMillis()))
    }

    suspend fun deleteItem(did: Int) {
        itemDao.softDeleteItem(did)
    }

    suspend fun getDirtyItems(): List<ItemEntity> = itemDao.getDirtyItems()

    suspend fun markSynced(did: Int, serverId: String) {
        itemDao.markSynced(did, serverId)
    }

    suspend fun upsertFromServer(items: List<ItemEntity>) {
        itemDao.upsertItems(items)
    }

    suspend fun softDeleteByServerId(serverId: String) {
        itemDao.softDeleteByServerId(serverId)
    }

    suspend fun getLastUpdatedAt(uid: Int): Long? = itemDao.getLastUpdatedAt(uid)
}
