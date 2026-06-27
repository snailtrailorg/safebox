package org.snailtrail.safebox.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "user")
data class UserEntity(
    @PrimaryKey val uid: Int = 0,
    val email: String? = null,
    val phone: String? = null,
    val googleId: String? = null,
    val serverUserId: String = "",
    val passwordHash: String = "",
    val passwordSalt: String = "",
    val passwordWrappedKey: String = "",
    val recoveryWrappedKey: String = "",
    val encryptedPrivateKey: String = "",
    val rsaPublicKey: String = "",
)

@Entity(tableName = "item")
data class ItemEntity(
    @PrimaryKey(autoGenerate = true) val did: Int = 0,
    val uid: Int = 0,
    val type: String = "",
    val icon: String? = null,
    val name: String = "",
    val description: String? = null,
    val data: String? = null,
    val serverId: String? = null,
    val version: Int = 1,
    val isDirty: Boolean = false,
    val isDeleted: Boolean = false,
    val updatedAt: Long = System.currentTimeMillis(),
    val createdAt: Long = System.currentTimeMillis(),
)
