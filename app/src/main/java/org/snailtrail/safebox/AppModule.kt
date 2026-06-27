package org.snailtrail.safebox

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import org.snailtrail.safebox.data.local.AppDatabase
import org.snailtrail.safebox.data.local.ItemDao
import org.snailtrail.safebox.data.local.UserDao
import org.snailtrail.safebox.data.remote.ApiService
import org.snailtrail.safebox.data.remote.AuthInterceptor
import org.snailtrail.safebox.domain.CryptoManager
import org.snailtrail.safebox.domain.KeyManager
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideAppDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(context, AppDatabase::class.java, "safebox.db")
            .fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    fun provideUserDao(db: AppDatabase): UserDao = db.userDao()

    @Provides
    fun provideItemDao(db: AppDatabase): ItemDao = db.itemDao()

    @Provides
    @Singleton
    fun provideCryptoManager(): CryptoManager = CryptoManager()

    @Provides
    @Singleton
    fun provideKeyManager(cryptoManager: CryptoManager): KeyManager = KeyManager(cryptoManager)

    @Provides
    @Singleton
    fun provideOkHttpClient(authInterceptor: AuthInterceptor): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
        return OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideApiService(client: OkHttpClient): ApiService {
        // TODO: 替换为实际服务器地址
        val baseUrl = "https://api.safebox.example.com/"
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
    }
}
