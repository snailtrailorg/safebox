package org.snailtrail.safebox.data.remote.dto

import com.google.gson.annotations.SerializedName

// ── 验证码 ──────────────────────────────

data class SendCodeRequest(
    val target: String,
    val value: String
)

data class SendCodeResponse(
    @SerializedName("expires_in") val expiresIn: Int
)

// ── 注册 ────────────────────────────────

data class RegisterEmailRequest(
    val email: String,
    @SerializedName("password_hash") val passwordHash: String,
    @SerializedName("password_salt") val passwordSalt: String,
    @SerializedName("password_wrapped") val passwordWrapped: String,
    @SerializedName("recovery_wrapped") val recoveryWrapped: String,
    @SerializedName("encrypted_private") val encryptedPrivate: String,
    @SerializedName("rsa_public_key") val rsaPublicKey: String,
    @SerializedName("device_name") val deviceName: String?,
    @SerializedName("device_public_key") val devicePublicKey: String,
    @SerializedName("device_wrapped") val deviceWrapped: String,
)

data class RegisterPhoneRequest(
    val phone: String,
    @SerializedName("verification_code") val verificationCode: String,
    @SerializedName("password_hash") val passwordHash: String,
    @SerializedName("password_salt") val passwordSalt: String,
    @SerializedName("password_wrapped") val passwordWrapped: String,
    @SerializedName("recovery_wrapped") val recoveryWrapped: String,
    @SerializedName("encrypted_private") val encryptedPrivate: String,
    @SerializedName("rsa_public_key") val rsaPublicKey: String,
    @SerializedName("device_name") val deviceName: String?,
    @SerializedName("device_public_key") val devicePublicKey: String,
    @SerializedName("device_wrapped") val deviceWrapped: String,
)

data class RegisterGoogleRequest(
    @SerializedName("google_id_token") val googleIdToken: String,
    @SerializedName("password_hash") val passwordHash: String,
    @SerializedName("password_salt") val passwordSalt: String,
    @SerializedName("password_wrapped") val passwordWrapped: String,
    @SerializedName("recovery_wrapped") val recoveryWrapped: String,
    @SerializedName("encrypted_private") val encryptedPrivate: String,
    @SerializedName("rsa_public_key") val rsaPublicKey: String,
    @SerializedName("device_name") val deviceName: String?,
    @SerializedName("device_public_key") val devicePublicKey: String,
    @SerializedName("device_wrapped") val deviceWrapped: String,
)

data class RegisterResponse(
    @SerializedName("user_id") val userId: String,
    @SerializedName("access_token") val accessToken: String,
    @SerializedName("refresh_token") val refreshToken: String,
)

// ── 登录 ────────────────────────────────

data class LoginEmailRequest(
    val email: String,
    @SerializedName("password_hash") val passwordHash: String,
)

data class LoginPhoneRequest(
    val phone: String,
    @SerializedName("verification_code") val verificationCode: String,
    @SerializedName("password_hash") val passwordHash: String,
)

data class LoginGoogleRequest(
    @SerializedName("google_id_token") val googleIdToken: String,
)

data class LoginResponse(
    @SerializedName("access_token") val accessToken: String,
    @SerializedName("refresh_token") val refreshToken: String,
    @SerializedName("password_wrapped") val passwordWrapped: String?,
    @SerializedName("recovery_wrapped") val recoveryWrapped: String,
    @SerializedName("encrypted_private") val encryptedPrivate: String,
    @SerializedName("rsa_public_key") val rsaPublicKey: String,
    val devices: List<DeviceInfo> = emptyList(),
)

data class DeviceInfo(
    val id: String,
    @SerializedName("device_name") val deviceName: String?,
    @SerializedName("device_wrapped") val deviceWrapped: String,
)

// ── 密码重置 ─────────────────────────────

data class ResetPasswordRequest(
    val target: String,
    val value: String,
    @SerializedName("verification_code") val verificationCode: String,
    @SerializedName("new_password_hash") val newPasswordHash: String,
    @SerializedName("new_password_salt") val newPasswordSalt: String,
    @SerializedName("new_password_wrapped") val newPasswordWrapped: String,
)

data class ResetPasswordResponse(val success: Boolean)

// ── Token ────────────────────────────────

data class RefreshTokenRequest(
    @SerializedName("refresh_token") val refreshToken: String,
)

data class RefreshTokenResponse(
    @SerializedName("access_token") val accessToken: String,
    @SerializedName("refresh_token") val refreshToken: String,
)

// ── 设备 ────────────────────────────────

data class RegisterDeviceRequest(
    @SerializedName("device_name") val deviceName: String?,
    @SerializedName("device_public_key") val devicePublicKey: String,
    @SerializedName("device_wrapped") val deviceWrapped: String,
)

data class RegisterDeviceResponse(
    @SerializedName("device_id") val deviceId: String,
)

// ── 同步 ────────────────────────────────

data class SyncItemRequest(
    @SerializedName("client_did") val clientDid: Int?,
    val type: String,
    val icon: String?,
    val name: String,
    val description: String?,
    val data: String?,
    val version: Int,
    @SerializedName("updated_at") val updatedAt: String,
)

data class SyncPushRequest(val items: List<SyncItemRequest>)

data class SyncPushResult(
    @SerializedName("client_did") val clientDid: Int?,
    @SerializedName("server_id") val serverId: String?,
    val status: String,
)

data class SyncPushResponse(val results: List<SyncPushResult>)

data class SyncPullResponse(
    val items: List<SyncItemResponse>,
    @SerializedName("server_time") val serverTime: String,
    @SerializedName("has_more") val hasMore: Boolean,
)

data class SyncItemResponse(
    @SerializedName("server_id") val serverId: String,
    @SerializedName("client_did") val clientDid: Int?,
    val type: String,
    val icon: String?,
    val name: String,
    val description: String?,
    val data: String?,
    val version: Int,
    @SerializedName("is_deleted") val isDeleted: Boolean,
    @SerializedName("updated_at") val updatedAt: String,
)

data class SyncDeleteRequest(
    @SerializedName("server_ids") val serverIds: List<String>,
)

data class SyncDeleteResponse(val results: List<SyncDeleteResult>)

data class SyncDeleteResult(
    @SerializedName("server_id") val serverId: String,
    val status: String,
)
