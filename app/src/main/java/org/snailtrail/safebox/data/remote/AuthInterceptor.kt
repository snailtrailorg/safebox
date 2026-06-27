package org.snailtrail.safebox.data.remote

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import org.snailtrail.safebox.domain.SessionManager
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp 拦截器：自动在请求头中注入 JWT Bearer token。
 * 如果 token 已过期，尝试用 refresh_token 刷新。
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val sessionManager: SessionManager,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        // 跳过认证端点
        if (originalRequest.url.encodedPath.contains("/auth/") &&
            !originalRequest.url.encodedPath.contains("/auth/register-device")
        ) {
            return chain.proceed(originalRequest)
        }

        val accessToken = runBlocking { sessionManager.accessToken.first() }
        val requestWithAuth = if (accessToken != null) {
            originalRequest.newBuilder()
                .header("Authorization", "Bearer $accessToken")
                .build()
        } else {
            originalRequest
        }

        val response = chain.proceed(requestWithAuth)

        // 如果 401，尝试刷新 token
        if (response.code == 401) {
            response.close()
            val refreshToken = runBlocking { sessionManager.refreshToken.first() }
            if (refreshToken != null) {
                // TODO: 调用 refresh-token API 获取新 token
                // 暂时直接返回原始响应
            }
        }

        return response
    }
}
