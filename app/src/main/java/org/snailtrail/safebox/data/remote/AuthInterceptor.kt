package org.snailtrail.safebox.data.remote

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import org.snailtrail.safebox.domain.SessionManager
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp 拦截器：自动注入 JWT Bearer token 和 Accept-Language header。
 * 如果 token 已过期，尝试用 refresh_token 刷新。
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val sessionManager: SessionManager,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        // Accept-Language: zh 如果系统语言是中文，否则 en
        val lang = if (Locale.getDefault().language.startsWith("zh")) "zh" else "en"
        val builder = originalRequest.newBuilder()
            .header("Accept-Language", lang)

        // 跳过认证端点（除 register-device 外）
        val isAuthPath = originalRequest.url.encodedPath.contains("/auth/") &&
            !originalRequest.url.encodedPath.contains("/auth/register-device")

        if (!isAuthPath) {
            val accessToken = runBlocking { sessionManager.accessToken.first() }
            if (accessToken != null) {
                builder.header("Authorization", "Bearer $accessToken")
            }
        }

        val response = chain.proceed(builder.build())

        // 如果 401，尝试刷新 token
        if (response.code == 401 && !isAuthPath) {
            response.close()
            val refreshToken = runBlocking { sessionManager.refreshToken.first() }
            if (refreshToken != null) {
                // TODO: 调用 refresh-token API 获取新 token
            }
        }

        return response
    }
}
