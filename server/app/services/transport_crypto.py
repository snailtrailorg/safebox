"""SRP 会话密钥 K 的 AES-256-GCM 通信加解密（对标 1Password SRP+GCM 传输层）。

K = H(S)（SRP 握手派生，32 字节 SHA-256）。AES-256-GCM。
格式：nonce(12) + ciphertext + tag(16)。
"""
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NONCE_LEN = 12


def encrypt(K: bytes, plaintext: bytes) -> bytes:
    """AES-256-GCM 加密。返回 nonce(12) + ciphertext+tag。"""
    nonce = os.urandom(NONCE_LEN)
    ct = AESGCM(K).encrypt(nonce, plaintext, None)
    return nonce + ct


def decrypt(K: bytes, data: bytes) -> bytes:
    """AES-256-GCM 解密。输入 nonce(12) + ciphertext+tag。失败抛异常。"""
    nonce = data[:NONCE_LEN]
    ct = data[NONCE_LEN:]
    return AESGCM(K).decrypt(nonce, ct, None)
