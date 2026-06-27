package org.snailtrail.safebox.data.remote

import org.snailtrail.safebox.data.remote.dto.*
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface ApiService {

    // ── 验证码 ──────────────────────────────

    @POST("api/v1/auth/send-code")
    suspend fun sendCode(@Body request: SendCodeRequest): Response<SendCodeResponse>

    // ── 注册 ────────────────────────────────

    @POST("api/v1/auth/register/email")
    suspend fun registerEmail(@Body request: RegisterEmailRequest): Response<RegisterResponse>

    @POST("api/v1/auth/register/phone")
    suspend fun registerPhone(@Body request: RegisterPhoneRequest): Response<RegisterResponse>

    @POST("api/v1/auth/register/google")
    suspend fun registerGoogle(@Body request: RegisterGoogleRequest): Response<RegisterResponse>

    // ── 登录 ────────────────────────────────

    @POST("api/v1/auth/login/email")
    suspend fun loginEmail(@Body request: LoginEmailRequest): Response<LoginResponse>

    @POST("api/v1/auth/login/phone")
    suspend fun loginPhone(@Body request: LoginPhoneRequest): Response<LoginResponse>

    @POST("api/v1/auth/login/google")
    suspend fun loginGoogle(@Body request: LoginGoogleRequest): Response<LoginResponse>

    // ── 密码重置 ─────────────────────────────

    @POST("api/v1/auth/reset-password")
    suspend fun resetPassword(@Body request: ResetPasswordRequest): Response<ResetPasswordResponse>

    // ── Token ────────────────────────────────

    @POST("api/v1/auth/refresh-token")
    suspend fun refreshToken(@Body request: RefreshTokenRequest): Response<RefreshTokenResponse>

    // ── 设备注册 ─────────────────────────────

    @POST("api/v1/auth/register-device")
    suspend fun registerDevice(@Body request: RegisterDeviceRequest): Response<RegisterDeviceResponse>

    // ── 同步 ────────────────────────────────

    @GET("api/v1/sync/pull")
    suspend fun syncPull(
        @Query("since") since: String,
        @Query("limit") limit: Int = 100
    ): Response<SyncPullResponse>

    @POST("api/v1/sync/push")
    suspend fun syncPush(@Body request: SyncPushRequest): Response<SyncPushResponse>

    @POST("api/v1/sync/delete")
    suspend fun syncDelete(@Body request: SyncDeleteRequest): Response<SyncDeleteResponse>
}
