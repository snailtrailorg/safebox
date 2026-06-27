package org.snailtrail.safebox.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface UserDao {
    @Query("SELECT * FROM user WHERE uid = :uid")
    suspend fun getUser(uid: Int): UserEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertUser(user: UserEntity): Long

    @Query("DELETE FROM user")
    suspend fun deleteAll()
}
