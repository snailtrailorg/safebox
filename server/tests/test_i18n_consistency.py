"""i18n 一致性闸门 —— 把「后端 i18n 漏扫」这个教训变成红灯。

背景（为什么要有这个文件）：
    提交 59ee30b "i18n: 补全硬编码中文 + 清死 key" 自称「5 维度检测全绿：
    en/zh 241 一致 + t() 全覆盖 + 硬编码 0 + 未翻译 0 + 死 key 0」，
    但那次检测**只扫了前端 web/src/i18n/**，后端 server/app/i18n/ 从未被扫过。
    后果：后端长期存在 10 处硬编码用户可见错误文案（含中间件的
    "Too many requests..."）、4 个零引用死 key、以及 email_service 里
    服务已取消的恢复机制残留的三条死分支。

    这类"自称扫了一类，其实只扫了半边"的失败模式，靠文档提醒是拦不住的。
    本文件把它变成可执行断言：任何一项不合规，pytest 直接红。

覆盖 5 项：
    1. zh / en key 集合必须完全一致
    2. 代码引用的 key 必须都有定义（无缺失）
    3. 定义的 key 必须都被引用（无死 key）
    4. 后端不得有面向用户的硬编码文案（中文 or 协议层英文）
    5. 中间件/服务里的错误 detail 必须走 i18n

若某 key 确需保留但暂无引用（如预留），加进 ALLOWED_UNUSED 并注明原因 —— 
不要为了过闸门而把死 key 删了又加。
"""

import json
import re
from pathlib import Path

import pytest

APP_DIR = Path(__file__).resolve().parent.parent / "app"
LOCALES_DIR = APP_DIR / "i18n" / "locales"

# 允许「已定义但未引用」的 key。每项必须带原因。
# 空集合是常态 —— 真要放东西进来，先想清楚为什么。
ALLOWED_UNUSED: set[str] = set()

# 允许的硬编码例外（精确匹配 "文件:行内容"），每项要带原因。
# 例：密码学协议层返回给客户端的错误码（非用户文案），客户端自己做映射。
ALLOWED_HARDCODED_PATTERNS: tuple[str, ...] = (
    # SRP 协议层错误码：客户端 srpAuth 依赖这些字符串做逻辑判断，不是展示文案
    # （若将来要改，需同步改 web/src/services/srpAuth.ts）
    "srp_handshake_invalid",
)


def _load_keys(lang: str) -> set[str]:
    return set(json.loads((LOCALES_DIR / f"{lang}.json").read_text(encoding="utf-8")))


def _iter_py_files():
    for f in APP_DIR.rglob("*.py"):
        # i18n 模块自身与 locales 不算
        if "i18n" in f.parts:
            continue
        if "__pycache__" in f.parts:
            continue
        yield f


def _collect_used_keys() -> set[str]:
    r"""扫描所有 get_text(...) 与 _t(request, "...") 的 key 引用。

    注意 \b 词边界：不加的话 _load_keys("en") 会被 _t\( 误匹配
    （_load_keys 含子串 _t），把语言代码当成 key，产生假阳性。
    闸门的假阳性会诱使人去改活代码 —— 必须修到精确。
    """
    used: set[str] = set()
    patterns = (
        re.compile(r'\bget_text\(\s*"([^"]+)"'),
        re.compile(r'\bget_text\(\s*\n?\s*"([^"]+)"'),      # 换行调用
        re.compile(r'(?<![\w])_t\([^,)]+,\s*"([^"]+)"'),     # _t(request, "key")
    )
    for f in _iter_py_files():
        text = f.read_text(encoding="utf-8")
        for pat in patterns:
            used |= set(pat.findall(text))
        # 变量形式 sms_key = "xxx"（email_service 里用）
        used |= set(re.findall(r'sms_key\s*=\s*"([^"]+)"', text))
    return used


def _collect_returned_keys() -> set[str]:
    """形如 `return "some_key" if ... else "other_key"` 的间接引用（auth._login_err_key）。

    必须用**完整三元正则**抓，不能单独匹配 `else "..."` ——
    否则会把语言默认值 `get_lang(...) if request else "en"` 里的 "en"
    当成 key（假阳性），进而误报 key 缺失。
    早期版本正是这样翻车的：闸门的假阳性会诱使人去改活代码。
    """
    keys: set[str] = set()
    # if 分支的条件里可能自带引号（如 `if target_type == "email"`），
    # 故中间段不能用 [^"]+ 排除引号，改用非贪婪的 .+? 且不跨行。
    ternary = re.compile(r'return\s+"([a-z_]+)"\s+if\s+.+?\s+else\s+"([a-z_]+)"')
    for f in _iter_py_files():
        text = f.read_text(encoding="utf-8")
        for m in ternary.finditer(text):
            keys.add(m.group(1))
            keys.add(m.group(2))
    return keys


class TestLocaleConsistency:
    def test_zh_en_key_sets_identical(self):
        zh, en = _load_keys("zh"), _load_keys("en")
        assert zh == en, (
            f"zh/en key 集合不一致。仅 zh: {sorted(zh - en)}；仅 en: {sorted(en - zh)}"
        )

    def test_no_missing_keys(self):
        """代码引用的 key 必须有定义。缺失会导致 get_text 原样返回 key 名，
        用户界面直接出现 'alert_subject_xxx' 这种内部标识符。"""
        defined = _load_keys("zh") | _load_keys("en")
        used = _collect_used_keys() | _collect_returned_keys()
        missing = used - defined
        assert not missing, f"以下 key 被引用但未定义：{sorted(missing)}"

    def test_no_dead_keys(self):
        """定义的 key 必须被引用（否则是历史残留，会误导后来者以为有功能）。"""
        defined = _load_keys("zh") | _load_keys("en")
        used = _collect_used_keys() | _collect_returned_keys()
        dead = (defined - used) - ALLOWED_UNUSED
        assert not dead, (
            f"以下 key 已定义但零引用（死 key）：{sorted(dead)}。"
            f"确认无用后请删除；确需保留请加入 ALLOWED_UNUSED 并注明原因。"
        )


class TestNoHardcodedUserFacingText:
    """后端不得把用户可见文案硬编码。

    两类目标：
      a) 中文硬编码（用户会直接看到）
      b) HTTPException/JSONResponse 里的硬编码英文 detail
    """

    def test_no_hardcoded_chinese_in_detail(self):
        offenders = []
        for f in _iter_py_files():
            for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                s = line.strip()
                if s.startswith("#") or "get_text" in s or "logger" in s:
                    continue
                if re.search(r"[一-龥]", s) and ("detail=" in s or '"detail"' in s):
                    offenders.append(f"{f.relative_to(APP_DIR.parent)}:{i}: {s}")
        assert not offenders, "以下位置有硬编码中文 detail（应走 get_text）：\n" + "\n".join(offenders)

    def test_no_hardcoded_english_detail(self):
        """HTTPException(status_code=..., detail="...") 与 JSONResponse content={"detail": "..."}
        必须是 _t(...) / get_text(...)，不得是字面英文串。"""
        offenders = []
        lit = re.compile(r'(?:detail\s*=\s*"([^"]{3,})"|"detail"\s*:\s*"([^"]{3,})")')
        for f in _iter_py_files():
            for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                if "get_text" in line or "_t(" in line:
                    continue
                for m in lit.finditer(line):
                    text = m.group(1) or m.group(2)
                    if any(p in text for p in ALLOWED_HARDCODED_PATTERNS):
                        continue
                    offenders.append(
                        f"{f.relative_to(APP_DIR.parent)}:{i}: {line.strip()[:100]}"
                    )
        assert not offenders, (
            "以下位置有硬编码英文 detail（应走 get_text/_t）：\n" + "\n".join(offenders)
        )


class TestNoDeadRecoveryBranches:
    """恢复机制（冷却/加速/冻结）已在 e8acba4 取消，端点 /auth/recovery/* 已删。
    不要再出现该机制的残留分支 —— 它们永不触达，且构造的 URL 指向不存在的路由。
    """

    def test_no_recovery_dead_code(self):
        offenders = []
        banned = ("alert_subject_initiate", "alert_btn_accelerate", "alert_btn_freeze",
                  "sms_alert_initiate", "sms_alert_accelerate", "sms_alert_freeze",
                  "recovery_already_pending", "recovery_not_pending",
                  "recovery_token_invalid", "account_in_cooldown")
        for f in _iter_py_files():
            text = f.read_text(encoding="utf-8")
            for b in banned:
                if b in text:
                    offenders.append(f"{f.relative_to(APP_DIR.parent)}: {b}")
        assert not offenders, (
            "检测到已取消的恢复机制残留（死代码）：\n" + "\n".join(offenders) +
            "\n详见 docs/RECOVERY_MECHANISM.md §11「已删除 /auth/recovery/*」"
        )
