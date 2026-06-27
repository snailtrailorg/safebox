package org.snailtrail.safebox.domain

import android.util.Base64
import java.security.PrivateKey
import java.security.PublicKey
import javax.crypto.SecretKey
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 密钥管理器：管理 masterKey、RSA 密钥对的生命周期。
 * 内存中持有密钥，不持久化明文。
 */
@Singleton
class KeyManager @Inject constructor(
    val cryptoManager: CryptoManager
) {
    // 内存中的密钥（不持久化，App 被杀或超时锁定后清除）
    private var _masterKey: SecretKey? = null
    private var _rsaPublicKey: PublicKey? = null
    private var _rsaPrivateKey: PrivateKey? = null

    val isUnlocked: Boolean get() = _masterKey != null

    val masterKey: SecretKey? get() = _masterKey
    val rsaPublicKey: PublicKey? get() = _rsaPublicKey
    val rsaPrivateKey: PrivateKey? get() = _rsaPrivateKey

    // 设备密钥（用于 Google OAuth / 信任设备登录）
    private var _deviceKeyPair: Pair<PublicKey, PrivateKey>? = null

    fun generateDeviceKeyPair() {
        _deviceKeyPair = cryptoManager.generateRsaKeyPair()
    }

    fun getDevicePublicKey(): PublicKey? = _deviceKeyPair?.first
    fun getDevicePrivateKey(): PrivateKey? = _deviceKeyPair?.second

    /**
     * 用密码解锁：PBKDF2 派生密钥 → 解密 passwordWrappedKey → masterKey。
     */
    fun unlockWithPassword(
        password: String,
        salt: ByteArray,
        passwordWrapped: String
    ): Boolean {
        val derivedKey = cryptoManager.deriveKey(password, salt)
        val masterKeyBytes = cryptoManager.aesDecrypt(derivedKey, passwordWrapped) ?: return false
        _masterKey = javax.crypto.spec.SecretKeySpec(masterKeyBytes, "AES")
        return true
    }

    /**
     * 用恢复码解锁。
     */
    fun unlockWithRecoveryCode(
        recoveryCode: String,
        recoveryWrapped: String
    ): Boolean {
        val recoveryKey = cryptoManager.recoveryCodeToKey(recoveryCode)
        val masterKeyBytes = cryptoManager.aesDecrypt(recoveryKey, recoveryWrapped) ?: return false
        _masterKey = javax.crypto.spec.SecretKeySpec(masterKeyBytes, "AES")
        return true
    }

    /**
     * 用设备密钥解锁（Google OAuth / 信任设备登录）。
     */
    fun unlockWithDevice(privateKey: PrivateKey, deviceWrapped: String): Boolean {
        val masterKeyBytes = cryptoManager.deviceDecrypt(privateKey, deviceWrapped) ?: return false
        _masterKey = javax.crypto.spec.SecretKeySpec(masterKeyBytes, "AES")
        return true
    }

    /**
     * 加载 RSA 密钥对到内存。
     */
    fun loadRsaKeys(encryptedPrivateKey: String, publicKeyStr: String): Boolean {
        val privateKeyBytes = cryptoManager.aesDecrypt(_masterKey!!, encryptedPrivateKey)
            ?: return false
        _rsaPrivateKey = cryptoManager.decodePrivateKey(String(privateKeyBytes, Charsets.UTF_8))
        _rsaPublicKey = cryptoManager.decodePublicKey(publicKeyStr)
        return _rsaPublicKey != null && _rsaPrivateKey != null
    }

    /**
     * 生成注册所需的全部密钥材料。
     */
    fun generateKeys(password: String): GeneratedKeys {
        val salt = cryptoManager.generateSalt()
        val passwordDerivedKey = cryptoManager.deriveKey(password, salt)
        val masterKey = cryptoManager.generateMasterKey()
        val (publicKey, privateKey) = cryptoManager.generateRsaKeyPair()
        val recoveryCode = cryptoManager.generateRecoveryCode()
        val recoveryKey = cryptoManager.recoveryCodeToKey(recoveryCode)

        // 加密后的密钥材料（上传到服务端）
        val passwordWrapped = cryptoManager.aesEncrypt(passwordDerivedKey, masterKey.encoded)
        val recoveryWrapped = cryptoManager.aesEncrypt(recoveryKey, masterKey.encoded)
        val encryptedPrivate = cryptoManager.aesEncryptString(
            masterKey, cryptoManager.encodePrivateKey(privateKey)
        )
        val rsaPubEncoded = cryptoManager.encodePublicKey(publicKey)

        // 存到内存
        _masterKey = masterKey
        _rsaPublicKey = publicKey
        _rsaPrivateKey = privateKey

        return GeneratedKeys(
            salt = Base64.encodeToString(salt, Base64.NO_WRAP),
            passwordHash = Base64.encodeToString(passwordDerivedKey.encoded, Base64.NO_WRAP),
            passwordWrapped = passwordWrapped,
            recoveryWrapped = recoveryWrapped,
            encryptedPrivate = encryptedPrivate,
            rsaPublicKey = rsaPubEncoded,
            recoveryCode = recoveryCode,
        )
    }

    /**
     * 锁定：清除内存中的密钥。
     */
    fun lock() {
        _masterKey = null
        _rsaPublicKey = null
        _rsaPrivateKey = null
    }

    data class GeneratedKeys(
        val salt: String,
        val passwordHash: String,
        val passwordWrapped: String,
        val recoveryWrapped: String,
        val encryptedPrivate: String,
        val rsaPublicKey: String,
        val recoveryCode: String,
    )
}
