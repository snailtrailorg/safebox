"""SRP-6a 认证服务（对标 1Password 2SKD，自实现，无外部 SRP 库）。

参考：
- 1Password 安全设计白皮书 https://agilebits.github.io/security-design/
- RFC 3526（4096-bit MODP group）、RFC 2945（SRP-6a）

x 派生（2SKD，双秘密）：
    pbkdf2_out = PBKDF2-HMAC-SHA256(主密码, HKDF拉伸(srp_salt, 邮箱), 600_000, 32)
    hkdf_out   = HKDF-SHA256(助记词, salt=邮箱, info="safebox-srp", 32)
    x = int(pbkdf2_out XOR hkdf_out)
对标 1Password：PBKDF2(主密码) XOR HKDF(SecretKey)，助记词即 Secret Key。

SRP-6a：
    N, g = RFC 3526 4096-bit；hash = SHA-256
    k = H(PAD(N) | PAD(g))；u = H(PAD(A) | PAD(B))
    A = g^a mod N；B = (k·v + g^b) mod N
    S_client = (B - k·g^x)^(a + u·x) mod N
    S_server = (A · v^u)^b mod N
    K = H(S)；M1 = H(PAD(A) | PAD(B) | K)；M2 = H(PAD(A) | M1 | K)

注：1Password 官方未公布 M1/M2/k 的确切公式（刻意省略），此处按 SRP-6a 标准实现，
前后端（本文件 + web crypto/srp.ts）必须完全一致。
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import unicodedata
from typing import Optional


# ── RFC 3526 4096-bit MODP Group ──────────────────────────

_N_HEX = """
FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A92108011A723C12A787E6D788719A10BDBA5B2699C327186AF4E23C1A946834B6150BDA2583E9CA2AD44CE8DBBBC2DB04DE8EF92E8EFC141FBECAA6287C59474E6BC05D99B2964FA090C3A2233BA186515BE7ED1F612970CEE2D7AFB81BDD762170481CD0069127D5B05AA993B4EA988D8FDDC186FFB7DC90A6C08F4DF435C934063199FFFFFFFFFFFFFFFF
"""
N = int(_N_HEX.replace("\n", "").replace(" ", ""), 16)
G = 2
_N_BYTES = (N.bit_length() + 7) // 8  # 用于 pad


# ── 哈希工具 ──────────────────────────────────────────────

def _sha256(*args: bytes) -> bytes:
    h = hashlib.sha256()
    for a in args:
        h.update(a)
    return h.digest()


def _pad(n: int) -> bytes:
    """整数 pad 到 N 字节长度（SRP 规范，大端）。"""
    return n.to_bytes(_N_BYTES, "big")


def _as_int(b: bytes) -> int:
    return int.from_bytes(b, "big")


# SRP-6a multiplier: k = H(PAD(N) | PAD(g))
K = _as_int(_sha256(_pad(N), _pad(G)))


# ── HKDF-SHA256（标准库无，自实现 RFC 5869）──────────────────

def hkdf_extract(salt: bytes, ikm: bytes) -> bytes:
    return hmac.new(salt, ikm, hashlib.sha256).digest()


def hkdf_expand(prk: bytes, info: bytes, length: int) -> bytes:
    out = b""
    t = b""
    i = 1
    while len(out) < length:
        t = hmac.new(prk, t + info + bytes([i]), hashlib.sha256).digest()
        out += t
        i += 1
    return out[:length]


def hkdf(ikm: bytes, salt: bytes, info: bytes, length: int) -> bytes:
    prk = hkdf_extract(salt, ikm)
    return hkdf_expand(prk, info, length)


# ── 2SKD x 派生（对标 1Password，助记词 = Secret Key）──────

PBKDF2_ITERATIONS = 600_000  # safebox 用 600k（1Password 650k，接近）

AUTH_INFO = b"safebox-srp-auth"       # x 派生 HKDF info
SALT_STRETCH_INFO = b"safebox-srp-salt"  # srp_salt 经 HKDF 拉伸的 info


def derive_x(master_password: str, mnemonic: str, srp_salt: bytes, email: str) -> int:
    """2SKD：x = PBKDF2(主密码) XOR HKDF(助记词)。

    - 主密码：NFKD 归一化
    - srp_salt：经 HKDF 拉伸（salt=小写邮箱），作 PBKDF2 的 salt
    - 助记词：经 HKDF（salt=小写邮箱，info=AUTH_INFO）
    - XOR 得 x（双秘密，缺主密码或助记词任一都无法派生）
    """
    email_lower = email.lower().encode("utf-8")
    password = unicodedata.normalize("NFKD", master_password).encode("utf-8")
    mnemonic_bytes = mnemonic.encode("utf-8")

    # 1. srp_salt 经 HKDF 拉伸（对标 1Password 的 HKDF 拉伸 salt）
    stretched_salt = hkdf(srp_salt, salt=email_lower, info=SALT_STRETCH_INFO, length=32)

    # 2. PBKDF2(主密码, 拉伸salt, 600k)
    pbkdf2_out = hashlib.pbkdf2_hmac("sha256", password, stretched_salt, PBKDF2_ITERATIONS, 32)

    # 3. HKDF(助记词, salt=邮箱, info=AUTH_INFO)
    hkdf_out = hkdf(mnemonic_bytes, salt=email_lower, info=AUTH_INFO, length=32)

    # 4. XOR
    x_bytes = bytes(a ^ b for a, b in zip(pbkdf2_out, hkdf_out))
    return _as_int(x_bytes)


def generate_srp_salt() -> bytes:
    """16 字节随机 salt（对标 1Password 16 字节）。"""
    return secrets.token_bytes(16)


def compute_verifier(x: int) -> int:
    """v = g^x mod N。"""
    return pow(G, x, N)


# ── SRP-6a 握手数学 ───────────────────────────────────────

def generate_private_ephemeral() -> int:
    """随机私有 ephemeral（a 或 b），[1, N)。"""
    return secrets.randbelow(N - 1) + 1


def compute_client_public(a: int) -> int:
    """A = g^a mod N。"""
    return pow(G, a, N)


def compute_server_public(v: int, b: int) -> int:
    """B = (k·v + g^b) mod N。"""
    return (K * v + pow(G, b, N)) % N


def compute_u(A: int, B: int) -> int:
    """u = H(PAD(A) | PAD(B))。"""
    return _as_int(_sha256(_pad(A), _pad(B)))


def compute_client_S(B: int, a: int, u: int, x: int) -> int:
    """客户端共享秘密：S = (B - k·g^x)^(a + u·x) mod N。"""
    return pow((B - K * pow(G, x, N)) % N, a + u * x, N)


def compute_server_S(A: int, v: int, u: int, b: int) -> int:
    """服务端共享秘密：S = (A · v^u)^b mod N。"""
    return pow(A * pow(v, u, N) % N, b, N)


def compute_K(S: int) -> bytes:
    """K = H(S)。"""
    return _sha256(_pad(S))


def compute_M1(A: int, B: int, K: bytes) -> bytes:
    """客户端证据：M1 = H(PAD(A) | PAD(B) | K)。"""
    return _sha256(_pad(A), _pad(B), K)


def compute_M2(A: int, M1: bytes, K: bytes) -> bytes:
    """服务端证据：M2 = H(PAD(A) | M1 | K)。"""
    return _sha256(_pad(A), M1, K)


def verify_M1(A: int, B: int, K: bytes, client_M1: bytes) -> bool:
    """常量时间比较 M1。"""
    return hmac.compare_digest(compute_M1(A, B, K), client_M1)


def verify_M2(A: int, M1: bytes, K: bytes, server_M2: bytes) -> bool:
    """常量时间比较 M2。"""
    return hmac.compare_digest(compute_M2(A, M1, K), server_M2)


# ── 校验公共值（防恶意输入）────────────────────────────────

def is_valid_public(value: int) -> bool:
    """A/B 必须 ≠ 0 mod N（SRP-6a 防护）。"""
    return value % N != 0
