"""kdf_settings 校验测试（P1-1 防护）。

背景：kdf_settings 由客户端注册时上传并原样落库，是未校验的外部输入。
若允许 argon2id 落库，前端 kdf.ts 的 deriveKey 会抛错，该账户之后永久无法派生 K
-> encrypted_user_key 不可解 -> 数据永久不可达。
故服务端只放行 pbkdf2，且迭代数不低于阈值。
"""
from app.services.auth_service import (
    validate_kdf_settings,
    DEFAULT_KDF_SETTINGS,
    MIN_PBKDF2_ITERATIONS,
)


def test_none_returns_default():
    assert validate_kdf_settings(None) == DEFAULT_KDF_SETTINGS


def test_empty_dict_returns_default():
    assert validate_kdf_settings({}) == DEFAULT_KDF_SETTINGS


def test_valid_pbkdf2_preserved():
    out = validate_kdf_settings({"algorithm": "pbkdf2", "iterations": 800_000})
    assert out == {"algorithm": "pbkdf2", "iterations": 800_000}


def test_argon2id_rejected():
    """核心防护：argon2id 不得落库（前端未实现，会导致账户永久锁死）。"""
    out = validate_kdf_settings({"algorithm": "argon2id", "memory": 65536, "iterations": 3, "parallelism": 4})
    assert out == DEFAULT_KDF_SETTINGS
    assert out["algorithm"] == "pbkdf2"


def test_unknown_algorithm_rejected():
    assert validate_kdf_settings({"algorithm": "scrypt"}) == DEFAULT_KDF_SETTINGS


def test_low_iterations_rejected():
    """防客户端上传过低迭代数削弱 KDF。"""
    out = validate_kdf_settings({"algorithm": "pbkdf2", "iterations": 1000})
    assert out == DEFAULT_KDF_SETTINGS


def test_min_iterations_boundary_ok():
    out = validate_kdf_settings({"algorithm": "pbkdf2", "iterations": MIN_PBKDF2_ITERATIONS})
    assert out["iterations"] == MIN_PBKDF2_ITERATIONS


def test_non_int_iterations_rejected():
    assert validate_kdf_settings({"algorithm": "pbkdf2", "iterations": "600000"}) == DEFAULT_KDF_SETTINGS


def test_non_dict_rejected():
    assert validate_kdf_settings(["pbkdf2"]) == DEFAULT_KDF_SETTINGS
