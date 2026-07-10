"""BIP39 词表 + 恢复码生成测试。"""
import hashlib

from app.services.bip39 import BIP39_WORDS, generate_bip39_code


# 官方 BIP39 英文词表（https://github.com/bitcoin/bips/bip-0039/english.txt）
# 2048 词 space-joined 的 SHA-256，用于穷尽校验词表与官方一致。
OFFICIAL_BIP39_SHA256 = "f18b9a84c83e38e98eceb0102b275e26438af83ab08f080cdb780a2caa9f3a6d"


def test_wordlist_matches_official_bip39():
    """词表必须与官方 BIP39 english.txt 逐词一致（H6 回归）。"""
    joined = " ".join(BIP39_WORDS)
    assert hashlib.sha256(joined.encode()).hexdigest() == OFFICIAL_BIP39_SHA256
    # 关键可读断言：标准词表无 africa/after（旧实现曾混入）
    assert "africa" not in BIP39_WORDS
    assert "after" not in BIP39_WORDS
    assert BIP39_WORDS[0] == "abandon"
    assert BIP39_WORDS[-1] == "zoo"
    assert BIP39_WORDS[37] == "again"  # 旧 bug 在此插入 africa


def test_wordlist_has_2048_words():
    assert len(BIP39_WORDS) == 2048


def test_wordlist_all_unique():
    assert len(set(BIP39_WORDS)) == 2048


def test_wordlist_no_duplicates():
    seen = set()
    for w in BIP39_WORDS:
        assert w not in seen, f"Duplicate: {w}"
        seen.add(w)


def test_wordlist_all_lowercase():
    for w in BIP39_WORDS:
        assert w == w.lower(), f"Not lowercase: {w}"


def test_wordlist_all_alpha():
    for w in BIP39_WORDS:
        assert w.isalpha(), f"Not alpha: {w}"


def test_generate_bip39_code_returns_12_words():
    code = generate_bip39_code()
    words = code.split()
    assert len(words) == 12


def test_generate_bip39_code_words_in_list():
    code = generate_bip39_code()
    for word in code.split():
        assert word in BIP39_WORDS


def test_generate_bip39_code_custom_length():
    code = generate_bip39_code(24)
    assert len(code.split()) == 24


def test_generate_bip39_code_is_random():
    """生成 100 个码，至少 90% 不同（确保不是固定值）。"""
    codes = {generate_bip39_code() for _ in range(100)}
    assert len(codes) >= 90


def test_generate_bip39_code_format():
    """格式：小写英文词，空格分隔，无首尾空格。"""
    code = generate_bip39_code()
    assert code == code.strip()
    assert code == code.lower()
    assert "  " not in code