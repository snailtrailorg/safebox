package org.snailtrail.safebox.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [UserEntity::class, ItemEntity::class],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun userDao(): UserDao
    abstract fun itemDao(): ItemDao
}
