package org.snailtrail.safebox.data.repository

import android.util.Base64
import org.snailtrail.safebox.data.remote.ApiService
import org.snailtrail.safebox.data.remote.dto.*
import org.snailtrail.safebox.domain.CryptoManager
import org.snailtrail.safebox.domain.KeyManager
import org.snailtrail.safebox.domain.SessionManager
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val keyManager: KeyManager,
) {
    private val cryptoManager: CryptoManager
        get() = keyManager.cryptoManager

    suspend fun sendVerificationCode(target: String, value: String): Result<Unit> {
        return try {
            val resp = apiService.sendCode(SendCodeRequest(target, value))
            if (resp.isSuccessful) Result.success(Unit)
            else Result.failure(Exception(resp.errorBody()?.string() ?: "Failed to send verification code"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun registerWithEmail(
        email: String,
        password: String,
        deviceName: String?,
    ): Result<Unit> {
        val keys = keyManager.generateKeys(password)

        keyManager.generateDeviceKeyPair()
        val devicePubKey = keyManager.getDevicePublicKey()
            ?: return Result.failure(Exception("Failed to generate device key"))
        val devicePubEncoded = android.util.Base64.encodeToString(
            devicePubKey.encoded, android.util.Base64.NO_WRAP
        )
        val deviceWrapped = keyManager.cryptoManager.aesEncrypt(
            keyManager.masterKey!!, devicePubKey.encoded
        )

        val resp = apiService.registerEmail(RegisterEmailRequest(
            email = email,
            passwordHash = keys.passwordHash,
            passwordSalt = keys.salt,
            passwordWrapped = keys.passwordWrapped,
            recoveryWrapped = keys.recoveryWrapped,
            encryptedPrivate = keys.encryptedPrivate,
            rsaPublicKey = keys.rsaPublicKey,
            deviceName = deviceName,
            devicePublicKey = devicePubEncoded,
            deviceWrapped = deviceWrapped,
        ))

        if (resp.isSuccessful) {
            val body = resp.body()!!
            sessionManager.saveLoginSession(
                accessToken = body.accessToken,
                refreshToken = body.refreshToken,
                serverUserId = body.userId,
                passwordSalt = keys.salt,
                passwordWrapped = keys.passwordWrapped,
                recoveryWrapped = keys.recoveryWrapped,
                encryptedPrivate = keys.encryptedPrivate,
                rsaPublicKey = keys.rsaPublicKey,
            )
            keyManager.loadRsaKeys(keys.encryptedPrivate, keys.rsaPublicKey)
            return Result.success(Unit)
        } else {
            return Result.failure(Exception(resp.errorBody()?.string() ?: "Registration failed"))
        }
    }

    suspend fun loginWithEmail(email: String, password: String): Result<Unit> {
        val saltStr = sessionManager.getPasswordSalt()
            ?: return Result.failure(Exception("Local key material not found. Please use recovery phrase to sign in on a new device."))

        val salt = Base64.decode(saltStr, Base64.NO_WRAP)
        val passwordHash = Base64.encodeToString(
            cryptoManager.deriveKey(password, salt).encoded,
            Base64.NO_WRAP
        )

        val resp = apiService.loginEmail(LoginEmailRequest(email, passwordHash))
        return handleLoginResponse(resp, password, salt)
    }

    suspend fun loginWithPhone(
        phone: String,
        verificationCode: String,
        password: String,
    ): Result<Unit> {
        val saltStr = sessionManager.getPasswordSalt()
            ?: return Result.failure(Exception("Local key material not found"))

        val salt = Base64.decode(saltStr, Base64.NO_WRAP)
        val passwordHash = Base64.encodeToString(
            cryptoManager.deriveKey(password, salt).encoded,
            Base64.NO_WRAP
        )

        val resp = apiService.loginPhone(LoginPhoneRequest(phone, verificationCode, passwordHash))
        return handleLoginResponse(resp, password, salt)
    }

    suspend fun loginWithGoogle(idToken: String): Result<Unit> {
        val resp = apiService.loginGoogle(LoginGoogleRequest(idToken))
        if (resp.isSuccessful) {
            val body = resp.body()!!
            val devicePrivateKey = keyManager.getDevicePrivateKey()
                ?: return Result.failure(Exception("Device key unavailable"))

            val currentDevice = body.devices.firstOrNull()
                ?: return Result.failure(Exception("Device key not found"))

            if (!keyManager.unlockWithDevice(devicePrivateKey, currentDevice.deviceWrapped)) {
                return Result.failure(Exception("Device key decryption failed"))
            }
            if (!keyManager.loadRsaKeys(body.encryptedPrivate, body.rsaPublicKey)) {
                return Result.failure(Exception("Failed to load RSA keys"))
            }

            sessionManager.updateTokens(body.accessToken, body.refreshToken)
            return Result.success(Unit)
        } else {
            return Result.failure(Exception("Google sign-in failed"))
        }
    }

    suspend fun recoverWithRecoveryCode(recoveryCode: String): Result<Unit> {
        val recoveryWrapped = sessionManager.getRecoveryWrapped()
            ?: return Result.failure(Exception("Recovery key material not found"))

        if (!keyManager.unlockWithRecoveryCode(recoveryCode, recoveryWrapped)) {
            return Result.failure(Exception("Invalid recovery phrase"))
        }

        val encryptedPrivate = sessionManager.getEncryptedPrivate()
            ?: return Result.failure(Exception("Encrypted private key not found"))
        val rsaPublicKey = sessionManager.getRsaPublicKey()
            ?: return Result.failure(Exception("Public key not found"))

        if (!keyManager.loadRsaKeys(encryptedPrivate, rsaPublicKey)) {
            return Result.failure(Exception("Failed to load RSA keys"))
        }

        return Result.success(Unit)
    }

    suspend fun logout() {
        keyManager.lock()
        sessionManager.logout()
    }

    private suspend fun handleLoginResponse(
        resp: retrofit2.Response<LoginResponse>,
        password: String,
        salt: ByteArray,
    ): Result<Unit> {
        if (resp.isSuccessful) {
            val body = resp.body()!!
            val pwWrapped = body.passwordWrapped
                ?: return Result.failure(Exception("Server did not return key material"))

            if (!keyManager.unlockWithPassword(password, salt, pwWrapped)) {
                return Result.failure(Exception("Incorrect password"))
            }
            if (!keyManager.loadRsaKeys(body.encryptedPrivate, body.rsaPublicKey)) {
                return Result.failure(Exception("Failed to load RSA keys"))
            }

            sessionManager.updateTokens(body.accessToken, body.refreshToken)
            return Result.success(Unit)
        } else {
            return Result.failure(Exception(resp.errorBody()?.string() ?: "Sign-in failed"))
        }
    }
}
