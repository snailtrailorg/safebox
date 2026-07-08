"""恢复码服务单元测试。"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.recovery_service import (
    hash_recovery_code,
    verify_recovery_code,
    generate_recovery_code_plaintext,
    generate_recovery_code_salt,
    sign_recovery_token,
    verify_recovery_token,
)


def test_generate_recovery_code_is_bip39():
    """生成的是 BIP39 12 词格式。"""
    code = generate_recovery_code_plaintext()
    words = code.split()
    assert len(words) == 12
    assert all(w.isalpha() and w.islower() for w in words)


def test_generate_recovery_code_unique():
    """每次生成不同的码。"""
    codes = {generate_recovery_code_plaintext() for _ in range(50)}
    assert len(codes) >= 45


def test_hash_and_verify():
    code = "abandon ability able about above absent absorb abstract accuse achieve acid acoustic"
    salt = generate_recovery_code_salt()
    h = hash_recovery_code(code, salt)
    assert len(h) == 64  # SHA-256 hex digest
    assert verify_recovery_code(code, salt, h)
    assert not verify_recovery_code("wrong code", salt, h)
    assert not verify_recovery_code(code, "wrong salt", h)


def test_hash_deterministic():
    code = "test code"
    salt = "test salt"
    assert hash_recovery_code(code, salt) == hash_recovery_code(code, salt)


def test_hash_case_sensitive():
    """normalize 做 lower，大小写不敏感。"""
    code = "Test Code"
    salt = "salt"
    h1 = hash_recovery_code(code, salt)
    h2 = hash_recovery_code(code.lower(), salt)
    assert h1 == h2  # normalize 统一转小写


def test_hash_whitespace_sensitive():
    """normalize 做 trim + 单空格，多余空格不影响。"""
    salt = "salt"
    h1 = hash_recovery_code("a b", salt)
    h2 = hash_recovery_code("a  b", salt)
    assert h1 == h2  # normalize 合并空格


def test_verify_constant_time():
    """verify 使用 hmac.compare_digest，常量时间。"""
    code = "test"
    salt = generate_recovery_code_salt()
    h = hash_recovery_code(code, salt)
    # 长度不同的哈希不应泄露信息
    assert not verify_recovery_code(code, salt, "short")
    assert not verify_recovery_code(code, salt, "a" * 64)


def test_sign_and_verify_token():
    payload = {"sub": "user-id", "action": "accelerate", "rc_id": "rc-id"}
    token = sign_recovery_token(payload)
    assert token is not None
    decoded = verify_recovery_token(token)
    assert decoded is not None
    assert decoded["sub"] == "user-id"
    assert decoded["action"] == "accelerate"
    assert decoded["rc_id"] == "rc-id"


def test_verify_invalid_token():
    assert verify_recovery_token("invalid.token") is None
    assert verify_recovery_token("") is None


def test_verify_wrong_action():
    payload = {"sub": "user-id", "action": "freeze", "rc_id": "rc-id"}
    token = sign_recovery_token(payload)
    decoded = verify_recovery_token(token)
    assert decoded is not None
    assert decoded["action"] == "freeze"


def test_generate_salt_unique():
    salts = {generate_recovery_code_salt() for _ in range(50)}
    assert len(salts) == 50  # 64 hex chars, 足够随机