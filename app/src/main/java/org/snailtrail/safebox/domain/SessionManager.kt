package org.snailtrail.safebox.domain

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "safebox_session")

/**
 * 会话管理器：持久化登录状态、token、服务端用户 ID。
 * 不存储密钥（密钥在 KeyManager 内存中）。
 */
@Singleton
class SessionManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private val KEY_ACCESS_TOKEN = stringPreferencesKey("access_token")
        private val KEY_REFRESH_TOKEN = stringPreferencesKey("refresh_token")
        private val KEY_SERVER_USER_ID = stringPreferencesKey("server_user_id")
        private val KEY_PASSWORD_SALT = stringPreferencesKey("password_salt")
        private val KEY_PASSWORD_WRAPPED = stringPreferencesKey("password_wrapped")
        private val KEY_RECOVERY_WRAPPED = stringPreferencesKey("recovery_wrapped")
        private val KEY_ENCRYPTED_PRIVATE = stringPreferencesKey("encrypted_private")
        private val KEY_RSA_PUBLIC_KEY = stringPreferencesKey("rsa_public_key")
        private val KEY_LAST_SYNC_TIME = stringPreferencesKey("last_sync_time")
        private val KEY_IS_LOGGED_IN = booleanPreferencesKey("is_logged_in")
    }

    val isLoggedIn: Flow<Boolean> = context.dataStore.data.map { it[KEY_IS_LOGGED_IN] ?: false }

    val accessToken: Flow<String?> = context.dataStore.data.map { it[KEY_ACCESS_TOKEN] }
    val refreshToken: Flow<String?> = context.dataStore.data.map { it[KEY_REFRESH_TOKEN] }
    val serverUserId: Flow<String?> = context.dataStore.data.map { it[KEY_SERVER_USER_ID] }
    val lastSyncTime: Flow<String?> = context.dataStore.data.map { it[KEY_LAST_SYNC_TIME] }

    suspend fun getPasswordSalt(): String? =
        context.dataStore.data.first()[KEY_PASSWORD_SALT]

    suspend fun getPasswordWrapped(): String? =
        context.dataStore.data.first()[KEY_PASSWORD_WRAPPED]

    suspend fun getRecoveryWrapped(): String? =
        context.dataStore.data.first()[KEY_RECOVERY_WRAPPED]

    suspend fun getEncryptedPrivate(): String? =
        context.dataStore.data.first()[KEY_ENCRYPTED_PRIVATE]

    suspend fun getRsaPublicKey(): String? =
        context.dataStore.data.first()[KEY_RSA_PUBLIC_KEY]

    suspend fun saveLoginSession(
        accessToken: String,
        refreshToken: String,
        serverUserId: String,
        passwordSalt: String,
        passwordWrapped: String,
        recoveryWrapped: String,
        encryptedPrivate: String,
        rsaPublicKey: String,
    ) {
        context.dataStore.edit { prefs ->
            prefs[KEY_IS_LOGGED_IN] = true
            prefs[KEY_ACCESS_TOKEN] = accessToken
            prefs[KEY_REFRESH_TOKEN] = refreshToken
            prefs[KEY_SERVER_USER_ID] = serverUserId
            prefs[KEY_PASSWORD_SALT] = passwordSalt
            prefs[KEY_PASSWORD_WRAPPED] = passwordWrapped
            prefs[KEY_RECOVERY_WRAPPED] = recoveryWrapped
            prefs[KEY_ENCRYPTED_PRIVATE] = encryptedPrivate
            prefs[KEY_RSA_PUBLIC_KEY] = rsaPublicKey
        }
    }

    suspend fun updateTokens(accessToken: String, refreshToken: String) {
        context.dataStore.edit { prefs ->
            prefs[KEY_ACCESS_TOKEN] = accessToken
            prefs[KEY_REFRESH_TOKEN] = refreshToken
        }
    }

    suspend fun updateSyncTime(time: String) {
        context.dataStore.edit { prefs ->
            prefs[KEY_LAST_SYNC_TIME] = time
        }
    }

    suspend fun logout() {
        context.dataStore.edit { it.clear() }
    }
}
