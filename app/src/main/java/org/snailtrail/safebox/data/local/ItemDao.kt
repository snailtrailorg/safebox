package org.snailtrail.safebox.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ItemDao {
    @Query("SELECT * FROM item WHERE uid = :uid AND isDeleted = 0 ORDER BY updatedAt DESC")
    fun getUserItems(uid: Int): Flow<List<ItemEntity>>

    @Query("SELECT * FROM item WHERE did = :did")
    suspend fun getItem(did: Int): ItemEntity?

    @Query("SELECT * FROM item WHERE serverId = :serverId")
    suspend fun getItemByServerId(serverId: String): ItemEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertItem(item: ItemEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertItems(items: List<ItemEntity>)

    @Query("UPDATE item SET isDeleted = 1 WHERE did = :did")
    suspend fun softDeleteItem(did: Int)

    @Query("UPDATE item SET isDeleted = 1 WHERE serverId = :serverId")
    suspend fun softDeleteByServerId(serverId: String)

    @Query("SELECT * FROM item WHERE isDirty = 1")
    suspend fun getDirtyItems(): List<ItemEntity>

    @Query("UPDATE item SET isDirty = 0, serverId = :serverId WHERE did = :did")
    suspend fun markSynced(did: Int, serverId: String)

    @Query("SELECT MAX(updatedAt) FROM item WHERE uid = :uid")
    suspend fun getLastUpdatedAt(uid: Int): Long?

    @Query("DELETE FROM item")
    suspend fun deleteAll()
}
