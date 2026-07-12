"""轻量 i18n 模块：JSON 翻译文件 + Accept-Language 解析。"""

from typing import Optional
import json
from functools import lru_cache
from pathlib import Path

LOCALES_DIR = Path(__file__).parent / "locales"


@lru_cache(maxsize=2)
def load_locale(lang: str) -> dict:
    """加载翻译文件（结果缓存）。"""
    path = LOCALES_DIR / f"{lang}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return json.loads((LOCALES_DIR / "en.json").read_text(encoding="utf-8"))


def get_text(key: str, lang: str = "en", **kwargs) -> str:
    """获取翻译文本，支持格式化插值。

    Args:
        key: 翻译 key
        lang: 语言代码 (zh/en)
        **kwargs: 格式化参数

    Returns:
        翻译后的字符串，key 不存在时返回 key 本身
    """
    locale = load_locale(lang)
    text = locale.get(key, key)
    if kwargs:
        text = text.format(**kwargs)
    return text


def get_lang(accept_language: Optional[str]) -> str:
    """解析 Accept-Language header，返回 zh 或 en。

    规则：以 zh 开头 → zh，其余 → en
    """
    if accept_language and accept_language.strip().lower().startswith("zh"):
        return "zh"
    return "en"
