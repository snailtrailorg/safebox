# SafeBox 安全与实现审计报告

- **日期**：2026-10-01
- **审计对象**：`/home/bernard/Projects/safebox`
- **代码基线**：`35706d5 fix: config extra=ignore + srpAuth.test tsc 修复（部署修复）`（工作区 `CLAUDE.md` 有未提交修改 ` M`）
- **规模**：服务端 `server/app` 2,907 行 Python / 6 个测试文件；前端 `web/src` 7,238 行 TS+TSX / 12 个测试文件
- **审计范围**：① 核心加密层（SRP-6a / 2SKD / KDF / UserKey 生命周期 / 传输加密）实现正确性；② 文档与代码一致性（功能缺口 + 文档失真）；③ 安全边界（认证 / 授权 / 中间件 / 限流 / 越权）
- **方法**：静态审计为主（逐行读源码 + 交叉核对四份文档），**关键密码学结论辅以 Node 22 WebCrypto 实跑实证**（P0-1 的必然性与 `wrapKey` 方案的否定，均为实测而非推断）。未执行项目测试套件、未起服务。
- **结论可复现性**：所有条目均可由「文件:行号」定位；P0-1 的实证脚本已内联在报告中，可原地重跑。

> **阅读约定**：可利用性评级 A/B/C 三级。A = 无前置条件即可触发、影响核心功能或密钥；B = 需特定条件（特定用户类型 / 部署形态 / 攻击者已具备某能力）；C = 卫生问题，单独不构成攻击面，但会放大其他缺陷或阻碍演进。

---

## 0. 摘要（先给结论）

**一句话**：SafeBox 的**密码学协议层设计是正确且扎实的**（SRP-6a 与 RFC 3526 一致、2SKD 公式前后端逐字节对齐、服务端改密的原子性与 token 撤销做得比大多数同类项目好）；**但前端密钥生命周期存在一个必然触发的回归缺陷，导致「修改主密码」功能 100% 失败**；同时存在一个**手机号用户的恢复路径死路**。

| 编号 | 级别 | 问题 | 可利用性 | 影响 |
|---|---|---|---|---|
| P0-1 | **P0** | `changeMasterPassword` 对 non-extractable `userKey` 调 `exportKey` → 必抛 `InvalidAccessError` | **A** | **改主密码功能 100% 不可用** |
| P0-2 | **P0** | `RecoveryPage` 硬编码 email（`getSalt(email)` + `performSrpLogin("email", ...)` + `<input type="email">`） | **A** | **手机号用户 logout/换设备后无任何恢复入口 = 数据永久不可达** |
| P1-1 | P1 | `kdf.ts` 声称支持 argon2id，实际抛错；`KdfSettings` / 后端字段 / 文档均声明支持 | B | 接口与文档虚假承诺；未来切换 KDF 时静默失败 |
| P1-2 | P1 | `deriveKey` 返回 `extractable=true` 的 CryptoKey | B | XSS 可直接导出 K，长驻密钥暴露 |
| P1-3 | P1 | `deriveKey(mnemonic + masterPassword, salt)` 字符串裸拼接，无分隔符/长度前缀 | C | 存在跨边界歧义；是 K 派生兼容性的长期隐患 |
| P1-4 | P1 | `changeMasterPassword` 与 `recoverAndRewrap` 对 `userKey` 的**可提取性约束理解不一致**（同一约束，一处绕开、一处踩中） | A | 直接导致 P0-1 |
| P1-5 | P1 | 限流 `_extract_user_id` 只解 JWT payload 不验签 | B | 伪造 `sub` 可污染他人限流桶 / 规避自身限流 |
| P1-6 | P1 | `trusted_proxies` 默认空 → 反代部署下 IP 限流退化为单桶 | B | 服务端反代场景下 IP 限流失效或误伤全体 |
| P1-7 | P1 | `auth.py::_client_ip`（仅 X-Real-IP）与 `rate_limit.py::_client_ip`（优先 XFF）策略不一致 | B | 同一请求在审计日志与限流中 IP 不同，取证与限流口径分裂 |
| P1-8 | P1 | `session_K` 明文存 IndexedDB，而 `cached_K`/`mnemonic_encrypted` 均用 `localDerivedKey` 包裹 | B | XSS 可直接读 K_comm 解密全部通信 |
| P1-9 | P1 | `AuthContext.checkSession` 用 `atob` 解 JWT payload，不支持 base64url | B | 含 `-`/`_` 的正常 token 被误判 → 状态退 `guest` |
| P1-10 | P1 | `ItemEditPage` 每次保存都 `createItemKey()` → Item Key 轮换 | C | 与文档「Item Key 不变」相悖；历史密文无法复用同一 ItemKey |
| P2-x | P2 | 见第 3 节，共 16 条 | C | 卫生 / 韧性 / 可维护性 |
| DOC-x | — | 见第 4 节文档失真清单，共 7 条 | — | 认知偏差 |

**最重要的一句话**：**P0-1 是服务端写得对、前端在发请求前就崩掉**——所以后端 `change_password` 里那些正确的原子撤销逻辑（`auth.py:442-445`）**从未被真正执行过**。修 P0-1 之前，任何关于「改密功能正常」的判断都是幻觉。

---

## 0.5 修复状态（2026-10-01 当日更新）

本节记录审计后立即实施的修复。**未列入的条目 = 尚未处理**（见第 6 节路线图）。

| 编号 | 状态 | 修复内容 | 验证 |
|---|---|---|---|
| **P0-1** | ✅ **已修** | 引入 `userKeyRaw` 内存副本（解锁时留存），`changeMasterPassword` / `exportUserKeyRaw` 改用它，不再对 non-extractable `userKey` 调 `exportKey` | 新增 12 条测试，**修复前 5 条红（`InvalidAccessException`）→ 修复后全绿**；含「新 K 解出同一 UserKey」「改密后仍可助记词恢复」语义断言 |
| **P0-2** | ✅ **已修** | `RecoveryPage` 增加 email/phone 双 tab，`targetType` 贯穿取盐/SRP/落库；顺带修 `login()` 未 await | 前端 111 测试全绿；`performSrpLogin(tab, ...)` 类型正确 |
| **P1-1** | ✅ **已修** | 前端 `KdfSettings` 收窄为仅 pbkdf2；后端新增 `validate_kdf_settings`（白名单 + 迭代下限），拒绝 argon2id 与过低迭代数落库 | 新增后端 9 条测试（含 `test_argon2id_rejected`）全绿 |
| **P1-3** | ✅ **已修** | 抽出 `derivePermanentK`，用 `U+0000` 分隔符替代裸拼接（**依"无真实用户"裁定可安全破坏性变更**） | 新增契约守护测试 |
| **P1-4** | ✅ **已修** | 与 P0-1 同源：抽出 `derivePermanentK` 统一 K 派生入口；UserKey raw 获取路径统一为内存副本 | 同上 |
| **P1-5** | ✅ **已修** | `rate_limit._extract_user_id` 改为 **JWT 验签后**取 sub；验签失败退回 IP 限流 | 后端测试全绿 |
| **P1-7** | ✅ **已修** | `rate_limit._client_ip` 改为与 `auth._client_ip` 一致的保守策略：**不再采信 X-Forwarded-For 最左**，仅可信直连时取 X-Real-IP | — |
| **P1-9** | ✅ **已修** | `AuthContext.checkSession` 先做 base64url→base64 转换再 `atob` | 新增 3 条测试，含「旧实现必抛错」断言 |
| **P1-10** | ✅ **已修** | `ItemEditPage.handleSave` 编辑时复用原 ItemKey（`decryptItemKey`），仅新建时 `createItemKey()` | 文档同步（ARCHITECTURE.md §9） |
| **P1-2** | ⏸ **改注释** | `deriveKey` 的 `extractable=true` 是「缓存 K」需求的必然结果（`wrapKey` 实测不可替代）。**加详细取舍注释，不改行为** | 见 kdf.ts 注释 |
| **P1-6** | ⚠️ **部分** | 代码侧已统一策略；**`trusted_proxies` 需部署时显式配置**（非代码问题） | 待对照 DEPLOY.md |
| P1-8 | 🔷 **复议不改** | `session_K` 明文存储。**判定为可接受残余风险**，理由见下方「P1-8 复议」 | — |
| P2-1 | ✅ **已修** | `exportUserKeyRaw` 改为读内存副本（原为死代码 + 同缺陷） | — |
| P2-5 | ✅ **已修** | `hexToBytes` 加严格校验：奇数长度 / 非 hex 字符抛错（原 `parseInt` 返回 `NaN` 静默变 0） | 新增测试，**修复前 2 条红 → 全绿** |
| P2-6 | ✅ **已修** | `decryptBody` 显式长度校验（短于 nonce+1 抛带语义的错，而非引擎黑盒 `OperationError`） | 新增测试（原已靠引擎兜住，改为可定位错误） |
| P2-7 | ✅ **已修** | `sync.pull` 的 6 处裸 `JSON.parse` 换为 `parseField()` 兜底；name 非法则跳过该条 | 新增 5 条测试，**反证：换回裸 parse 必 4 条红** |
| P2-8 | ✅ **已修** | `importBackup` 加 `validateBackupPayload()` 结构校验：items 必须是数组、条目必须有合规 name/data | 新增 9 条测试，**修复前 3 条红 → 全绿** |
| P2-9 | ✅ **已修** | `sync` 的 `updated_at` 改用 `parseServerTime()`，非法时间戳跳过该条（原 NaN 落库致排序静默失序） | 新增测试，**修复前 1 条红 → 全绿** |
| P2-13 | ✅ **已修** | `database.ts` 版本演化注释**纠错**：原文宣称「加 store 必须清库」是错的，实际 `contains()` 守卫已幂等 | — |
| P2-14 | ✅ **已修** | 未配 SMTP/Twilio 时：production 返回 False（→ 503）、development 放行；`print()` 改 logging，**生产不落验证码** | 新增 `settings.environment` / `is_production` |
| P2-15 | ⚠️ **部分修** | 告警文案全面 i18n + 语言透传 + 删死分支（`send_recovery_alert` → `send_password_changed_alert`）。**仍缺来源 IP/设备上下文** | 后端测试 53 passed（含语言断言） |
| P2-16 | ✅ **已修** | `itemTypes` 配置缓存按语言分桶（原永久固化致切语言后残留旧文案） | 新增 5 条测试，**反证必 2 条红** |
| P2-17 | ✅ **已修** | **后端 i18n 10 处硬编码 detail 全部走 i18n**（含两个中间件）；删 7 个死 key；删已取消恢复机制的三条死分支 | **新增 6 条可执行闸门** `tests/test_i18n_consistency.py`，**反证：注入 4 类违规全部变红** |
| P2-11 | ✅ **已修** | `RecoveryPage` 的 `login()` 补 await | — |
| 卫生 | ✅ **已清** | 删除 36 个外来 `.cpython-314*.pyc`（含他机路径字符串，`venv` 本体经核验**健康**）；清理临时文件 | — |

**测试基线变化**：
- 前端：96 → **111** → **132** → **134** → **139 passed**（17 files）
- 后端：38 → **47** → **53 passed, 1 skipped**（16 files，含 6 条 i18n 闸门）

**新增可执行闸门（把教训变成红灯，而非写进文档）**：
- `server/tests/test_i18n_consistency.py`（6 条）—— 覆盖 6 个维度：zh/en key 一致、无缺失 key、无死 key、无硬编码中文、**无硬编码英文 detail**、无已取消恢复机制的残留。
  - 背景：`59ee30b` 的 i18n 清理**只扫前端**，后端从未被查，导致 10 处硬编码 + 7 个死 key 长期潜伏。这类"自称扫了一类、其实只扫了半边"的问题靠文档提醒拦不住，故固化为断言。
  - **反证已做**：分别注入「死 key / 硬编码 detail / 语言不一致 / 恢复机制残留」四类违规，**4 条全部变红**；`phone_or_password_wrong` 等活 key **不被误报**（检测正则分别修掉了 `_load_keys("en")` 与 `else "en"` 两处假阳性）。
  - **闸门自身的假阳性也修了**：假阳性会诱使人去删活代码来"让闸门变绿"，与闸门失效同样有害。
- `web/src/__tests__/item-types-i18n.test.ts`（5 条）—— 配置缓存必须随语言重建；**反证：换回单变量永久缓存必 2 条红**。
- `web/src/__tests__/sync-corrupt.test.ts`（5 条）—— 服务端字段损坏的兜底；**反证：换回裸 `JSON.parse` 必 4 条红**。
- `web/src/__tests__/boundary-validation.test.ts`（16 条）—— hex 解析 / 传输体长度 / 备份结构 / 时间戳四类边界输入。
- `web/src/__tests__/api.test.ts`（+2 条）—— `session_K` 损坏时必须降级而非抛错。

**P0-1 的实证证据**（修复前实跑输出，已在项目自身 vitest 环境复现）：
```
RESULT: 崩溃 -> InvalidAccessException | key is not extractable
```
修复后同路径测试全绿，且「新 K 解出同一 UserKey」语义断言通过。

### P1-8 复议：为什么不修

原报告把 `session_K` 明文存储列为 P1，并暗示「应当像 `cached_K` 一样用 `localDerivedKey` 包裹」。**复议后推翻这个结论**，三条理由：

1. **加密对 XSS 零收益。** 攻击者的 JS 与受害者在**同一 JS 上下文**。它拿到 `session_K` 需要 `await getSession()` 读 IndexedDB 再解包；但它既然已能执行脚本，更直接的路径是调用 `apiClient.pull()` 拿解密后明文，或直接读 `keyChain` 内存里的 `userKeyRaw`。给 `session_K` 加包只是把攻击路径从 1 步变成 2 步。

2. **每请求解包不可接受。** `session_K` 在**每个认证请求**上都被 `getK()` 读取（`api.ts:57`）。用主密码派生的 `localDerivedKey` 包裹，意味着**每请求一次 600k 迭代 PBKDF2**。在同步循环里这是个数量级的性能塌方。

3. **它反而破坏 lock 语义。** `session_K` 在 `lock` 状态下**必须可读**（`getK()` 在任意 `!skipAuth` 请求里被调用）。若改成"解锁后才能解包"，等于把通信能力与 `keyChain` 解锁绑定 —— 而 `keyChain` 的解锁需要主密码，`unlock()` 却只做状态切换、不重新派生。**修这个洞会引入一个更硬的契约破裂。**

**真正的问题不是"存盘"，是"生命周期与 token 不齐"**：`logout` 已清整个 session（✅）；但 `lock` 只锁 `keyChain`，`session_K` 与 `accessToken` 都留在盘上。理想做法是 lock 时把 `session_K` 挪进内存、unlock 时重建 —— **但 K 在本地无法重建**：`K = H(S)`，而 `S = f(B, a, u, x)` 里的客户端临时私密值 `a` 与服务端临时公钥 `B` 都只存在于握手瞬间（`srpAuth.ts:22-35`），握手结束即丢。要重建只能重走 SRP 握手，而握手需要主密码 **+ 助记词**，与 `unlock`（只输主密码）的语义冲突。

**残余风险的真实量级**：`session_K` 泄出的前提是攻击者已能读取受害者的 IndexedDB —— 同一时刻它也拿到了 `accessToken`（bearer，可直接拉全量密文）与 `refreshToken`（可直接续期）。**`session_K` 的边际价值是"能解密通信"，而 token 的边际价值是"能取走一切密文"**。前者不构成额外突破。

**结论：不修。** 若将来要做，正确方向是**缩短 `session_K` 的 TTL 使其与 access token 对齐**（例如改为 access token 有效期），而不是加一层防不住威胁的包裹。**把这条判断写进报告，比塞一个复杂的无效改动更有价值** —— 后者会成为新的技术债。

---

## 1. P0 缺陷（必修，阻断核心功能）

### P0-1 ｜ 改主密码 100% 抛 `InvalidAccessError`（前端回归）

**定位**
- 触发点：`web/src/pages/settings/ChangePasswordPage.tsx:79-80`
- 崩溃点：`web/src/keychain/keyChain.ts:190`
- 根因引入点：`web/src/keychain/keyChain.ts:54`

**证据链（自上而下，逐行可复现）**

```ts
// ① ChangePasswordPage.tsx:33 / 53-77 —— 先解锁 + 走 SRP 拿 fresh token
const unlockOk = await keyChain.unlockWithPassword(currentPassword, ...);  // 载入 UserKey 到内存
...
const { resp } = await performSrpLogin(targetType, contact, currentPassword, mnemonic, salt, session.device_id);
...
// ② :79-80 —— 调改密（此处进入 keyChain，尚未发任何 HTTP 请求）
await keyChain.changeMasterPassword(mnemonic, identifier, session.mnemonic_salt, newPassword, saltBase64);
```

```ts
// ③ keyChain.ts:54 —— UserKey 被重新 import 为 NON-extractable
this.userKey = await crypto.subtle.importKey("raw", userKeyRaw, "AES-GCM", false, ["encrypt","decrypt"]);
//                                                                          ^^^^^ extractable = false
```

```ts
// ④ keyChain.ts:186-190 —— 却对同一个 UserKey 调 exportKey
if (!this.userKey) throw new Error("not_unlocked");
const mnemonicSalt = this.base64ToBytes(mnemonicSaltBase64);
const newK = await deriveKey(mnemonic + newMasterPassword, mnemonicSalt);
const userKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", this.userKey));
//                                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                           InvalidAccessError: key is not extractable
```

**为什么是「必然」而不是「可能」**

`userKey` 在本仓有 **4 个写入点，全部是 `extractable=false`**：

| 写入点 | 代码位置 | extractable |
|---|---|---|
| `generateKeys` 注册 | `keyChain.ts:54` | `false` |
| `unlockWithPassword` 同设备解锁 | `keyChain.ts:101` | `false` |
| `unlockFromMnemonic` 助记词解锁 | `keyChain.ts:134` | `false` |
| `recoverAndRewrap` 换设备恢复 | `keyChain.ts:156` | `false` |

而 `changeMasterPassword:190` 与 `exportUserKeyRaw:215` 是全仓**仅有的两处**对 `userKey` 调 `exportKey` 的地方。**没有任何一条路径能让 `userKey` 变得可导出**，因此 `changeMasterPassword` 在任何调用路径上都抛异常，无例外。

**可提取性对照表（本仓 AES CryptoKey 全貌，本次确认）**

| 来源 | 位置 | extractable | 可否 `exportKey` |
|---|---|---|---|
| `deriveKey()` 返回（K / localDerivedKey） | `kdf.ts:50` | **true** | ✅ |
| `generateAesKey()`（ItemKey / 初始 UserKey） | `aes.ts:82` | **true** | ✅ |
| `importAesKey()`（解包出的 ItemKey） | `aes.ts:100` | false | ❌ |
| `userKey` 全部 4 个写入点 | `keyChain.ts:54/101/134/156` | **false** | ❌ |

**影响面**
- 用户点「修改主密码」→ 前端在**发请求之前**抛出 `InvalidAccessError` → 被 `ChangePasswordPage.tsx:109-110` 的 `catch (e)` 捕获 → Toast 显示英文原文 `"Failed to execute 'exportKey' on 'SubtleCrypto': key is not extractable"`。
- **服务端 `change_password` 从未被调用**。这意味着 `auth.py:442-445` 的 `revoke_all_user_tokens` + 对称清 session_key + 异步告警邮件这套正确逻辑，在此缺陷下**完全没跑过**——任何基于「改密链路已测试」的判断都不成立。
- 副产物：用户会看到英文技术栈错误信息，i18n 兜底（`settings.changeFailed`）被 `e.message` 覆盖。

**可利用性**：**A**（无需任何前置条件，任何用户、任何设备、100% 触发）

**实证（本次已用 Node 22 的 WebCrypto 实跑复现）**

```
CONFIRMED 崩溃: DOMException | key is not extractable
对照 extractable=true: 32 bytes 可导出
```

即：非可导出 key 调 `exportKey` 必抛 `DOMException`，静态推断成立。

**整改建议**

> ⚠️ **先排除一个看似可行的错方案**：直觉上会想「改用 `crypto.subtle.wrapKey("raw", userKey, newK, ...)` 就能绕过」——**这是错的**。本次实测验证：
> ```
> wrapKey(non-extractable) → 修复方案失败: key is not extractable
> ```
> WebCrypto 规范里 `wrapKey(format="raw", ...)` 的语义**等同于** `exportKey(format)` 之后再加密，**同样要求源密钥可导出**。所以 `wrapKey` 不是出路。（这条已用 Node 22 实跑确认，不是推断。）

因此**唯一可行**的方向是**让 `changeMasterPassword` 不需要 UserKey 的 raw**：

- **方案 A（推荐，即 P1-4 的统一入口）**：把「写 UserKey 到内存」与「保留 raw 用于重新包裹」解耦。`unlockWithPassword` / `unlockFromMnemonic` / `recoverAndRewrap` 在**解密拿到 `ukRaw` 的那一刻**（此时是明文 `Uint8Array`，见 `keyChain.ts:98/131/153`），把 raw **存到一个私有字段**（如 `private userKeyRaw: Uint8Array | null`）供后续重新包裹，同时照旧 import 成 non-extractable 的 `this.userKey` 用于日常加解密。`lock()` 时与 `userKey` 一同清除。
  - 代价：内存里多了 32 字节明文（`userKey` 本来就是随机 256-bit，这个暴露面可接受，且随 lock 清掉）。
  - 收益：`changeMasterPassword` 与 `exportUserKeyRaw` 都不再需要 `exportKey`，**与 `recoverAndRewrap` 的实现风格统一**（后者本来就是用 `ukRaw` 而非 exportKey）。
- **方案 B（延迟 import）**：把 `changeMasterPassword` 的「重新包裹」动作**前移进解锁流程**——即解锁时若检测到「即将改密」不可行，遂不可取。
- **方案 C（不推荐）**：把 `generateKeys`/`unlock*` 里的 `importKey(..., true, ...)` 改成可导出——**等于把 P1-2 的原则问题变成代码事实，且与 `aes.ts:100`「不可提取—密钥仅存内存」的既有约定冲突**。

**配套**：
- **删除或修复 `exportUserKeyRaw()`（`keyChain.ts:213-216`）**——它同样必然抛错，且 grep 确认全仓**零调用方**（死代码 + 隐藏缺陷，见 P2-1）。
- **回归防护（建议做成闸门）**：加一条单测，断言 `generateKeys → changeMasterPassword` 全链路不抛异常、且产出的 `new_encrypted_user_key` 能用 `newK` 解回同一 UserKey。当前 12 个前端测试文件里**没有覆盖改密链路**——这就是缺陷能活到今天的原因。

---

### P0-2 ｜ 手机号用户 logout / 换设备后无恢复路径（功能死路）

**定位**
- `web/src/pages/auth/RecoveryPage.tsx:51` —— `const salt = await apiClient.getSalt(email);`
- `web/src/pages/auth/RecoveryPage.tsx:54` —— `performSrpLogin("email", email, masterPassword, mnemonic, salt);`
- `web/src/pages/auth/RecoveryPage.tsx:93` —— `<input type="email" ... />`

**证据链**

```tsx
// RecoveryPage.tsx —— 全程只有 email 一条路
const [email, setEmail] = useState("");           // 无 phone state
...
if (!email.trim()) { setToast(t("auth.recovery.enterEmail")); return; }
const salt = await apiClient.getSalt(email);                          // :51 只走 email 分支
const { resp, K } = await performSrpLogin("email", email, ...);       // :54 硬编码 "email"
...
<input type="email" value={email} ... />                              // :93 HTML 层再封一次
```

对照「手机号注册/登录」是**已实现功能**：
- `LoginPage.tsx:123-126` 有 email / phone 双 tab；`:165` `<input type="tel">`
- `RegisterPage.tsx:182` `<input type="tel">`
- `server/app/api/auth.py:271` `@router.post("/register/phone")`
- `server/app/api/auth.py:191-192` `/salt` 同时接受 `email` 与 `phone` 参数

**组合出的死路**：

```
手机号用户
  → 正常使用中（K_comm 在 session，一切可用）
  → 触发 logout（决策 A：清整个 session，见 ARCHITECTURE.md 三态 session）
  → 进入 RecoveryPage
  → 无 phone 输入框、无 phone 分支、HTML type=email 拒绝手机号
  → 唯一能拿到 UserKey 的入口（换设备 = 助记词+主密码+SVK 重派生）走不通
  → ⚠️ 数据永久不可达（服务器只有 encrypted_user_key，无主密码/助记词无法解）
```

**补充说明（一处需要精确的地方）**：改密链路对手机用户**不是**此缺陷的受害者。因为 `LoginPage.tsx:108` 把手机号写进了 `session.email` 字段（`saveSession({ email: phone, ... })`），于是 `ChangePasswordPage` 的 `contact = session.email || ""` 非空、`contact.includes("@")` 判为 `false` → `targetType = "phone"` → 走 `apiClient.getSalt(undefined, contact)` 分支，**逻辑上可用**。手机用户改密的真正阻塞点仍是 **P0-1**，与邮箱用户同因。

**可利用性**：**A**（手机号注册的用户，一次 logout 即触发；无任何攻击者参与）

**整改建议**
1. **最小修复**：`RecoveryPage` 增加 email/phone 双 tab（与 `LoginPage` 对称），`RecoveryPage.tsx:54` 的 `performSrpLogin(targetType, ...)` 改用 `targetType` 变量，`:93` 的 `<input type="email">` 按 tab 切换 `type`。
2. **更值得做的事（防复发）**：把「登录标识符」从 `session.email` 这个字段名里解放出来。当前 `session.email` 实为「登录标识符」，手机号存在名为 `email` 的字段里——这是**命名层面的语义污染**，会持续误导后续开发（`ChangePasswordPage.tsx:53-55` 已经在用 `includes("@")` 猜类型）。建议引入 `login_identifier` / `identifier_type` 两个显式字段，或在 `sessionStore.ts` 里加 `target_type`。
3. **文档补记**：`RECOVERY_MECHANISM.md` 与 `FEATURE_LIST.md` 全文**未记录**「恢复路径 email-only」这一已知缺口。修复前应在文档中显式标注为限制项。

**这正是威廉姆最在意的形态之一**：不是"报错了"，而是"**静默走不通**"——用户看到的是一个能提交、不报错的恢复表单，输手机号被浏览器拦下、输邮箱报"未找到账号"，**没有任何一处告诉用户「此账号只能通过邮箱恢复」**。

---

## 2. P1 缺陷（应修，影响安全边界或长驻密钥）

### P1-1 ｜ argon2id 声称支持但抛错（虚假接口）

**定位**：`web/src/crypto/kdf.ts:41-42`

```ts
// Argon2id - 暂未实现，fallback 到 PBKDF2
throw new Error("argon2id KDF not yet supported");
```

**矛盾三方**：
- 类型定义：`kdf.ts:11-13` `export type KdfSettings = { algorithm: "pbkdf2"; ... } | { algorithm: "argon2id"; memory; iterations; parallelism }`
- 后端字段：`users.kdf_settings` JSON 列（`ARCHITECTURE.md:111-154` 存储表）
- 文档：`kdf.ts:4` 头注释「支持 PBKDF2 / Argon2id，参数可配置、跟随账户存储」

**实际**：只有 PBKDF2 可用；`DEFAULT_KDF` / `RECOMMENDED_KDF`（`kdf.ts:16-17`）都硬绑 pbkdf2。一旦某账户的 `kdf_settings` 落成 argon2id，`deriveKey` 直接抛错 → 该账户**永久无法解锁**（因为 K 派生路径断了）。

**可利用性**：B（当前无 UI 可设置 argon2id，需数据库被写入该值；但**没有任何一处校验**阻止它）

**整改建议**：要么实现 argon2id（WASM），要么**把 `KdfSettings` 收窄为只含 pbkdf2** 并在后端加 CHECK 约束 + 文档删掉 argon2id 承诺。**不要留着一个会抛错的"支持"分支**——这是典型的「静默失败温床」。

---

### P1-2 ｜ `deriveKey` 返回可导出的 CryptoKey（最小可提取性原则被破）

**定位**：`web/src/crypto/kdf.ts:50`

```ts
return crypto.subtle.importKey("raw", ..., "AES-GCM", true, ["encrypt", "decrypt"]);
//                                                    ^^^^ extractable = true
```

**影响**：`deriveKey` 的产物包含 **K 本身**（注册/改密/恢复时）与 **localDerivedKey**（本地缓存包裹密钥）。K 可导出意味着：任一 XSS 只要能执行 `crypto.subtle.exportKey("raw", k)` 即可拿到 K，进而解密 `encrypted_user_key` 得到 UserKey，**整个零知识边界在浏览器内被击穿**。

**为什么现在必须导出**：因为 `keyChain.ts:61 / 158 / 194` 三处都写了 `exportKey("raw", K)` 来把 K 存进 `cached_K`。**这是设计上的耦合**——可提取性要求是被"缓存 K"这个需求倒逼出来的。

**对比可见设计不一致**：`aes.ts:100` 的 `importAesKey` 明确写 `false` 并注释「不可提取 — 密钥仅存内存」；`generateAesKey`（`aes.ts:82`）写 `true` 并注释「需要导出为 raw 进行 wrap」。**同一个文件里，两种策略各有理由，但 `kdf.ts` 那个 `true` 没有任何注释说明理由。**

**整改建议**：**注意——不能简单换成 `wrapKey`**。本次已实测确认 `wrapKey("raw", nonExtractableKey, ...)` **同样抛 `key is not extractable`**（WebCrypto 的 `wrapKey` 以 raw 格式导出源密钥，等价于 `exportKey`，见 P0-1 的实证）。真正可行的是：

- 让需要「K 的 raw」的地方（`cached_K` 的构造，`keyChain.ts:61/158/194`）改为**在 K 刚派生出来的栈内时刻**完成使用——`derivedKey` 返回的若是 CryptoKey，则 raw 已经不可得。所以更彻底的做法是：**`deriveBits`（`kdf.ts:27-43`）已经产出了 raw `Uint8Array`**，把「包裹 `cached_K`」这一步**下沉到 `deriveBits` 返回 raw 的同一调用栈**，而不是绕一圈 import 成 CryptoKey 再导出来。
- 或者引入一个**专用的、可导出的包裹密钥**（wrapping key）与不可导出的工作密钥分离——但这对现有结构改动较大。
- **短期务实做法**：接受 `deriveKey` 返回可导出（保留现状），但在注释里**写明这是已知取舍及其理由**（当前 `kdf.ts:50` 的 `true` 是"裸的"，没有任何说明，与 `aes.ts:82/100` 都写了理由形成反差）。**最差的状态是"没理由的可导出"**。

这一条与 P0-1 是**同一个技术约束的两个侧面**——建议合并评估，不要分开修。

---

### P1-3 ｜ K 派生字符串裸拼接，无分隔符

**定位**：`web/src/keychain/keyChain.ts:48 / 130 / 152 / 189`（4 处）

```ts
const K = await deriveKey(mnemonic + masterPassword, mnemonicSalt);
```

**问题**：助记词是 12 个空格分隔的 BIP39 词，主密码是任意字符串。裸拼接存在**跨边界歧义**：
- 助记词 `"abandon ability ... word"` + 主密码 `"x"`
- vs 助记词 `"abandon ability ... wordx"`（非法，12 词数校验会挡）+ 主密码 `""`（会被 `!masterPassword` 挡）

**实际可利用性评估**：由于 BIP39 有 12 词数校验、主密码有非空校验，**当前 UI 路径下难以构造真实碰撞**，所以我给 **C 级而非 B**。但它是个**正确的做法就该加上分隔符**的典型：`mnemonic + "\x00" + masterPassword` 或长度前缀。改造成本极低（但**是破坏性变更**——一旦有人已注册，改拼接方式会导致旧 K 全部失效，**需配套迁移策略或明确不做**）。

**建议**：不为已上线数据改动；但**若尚有未投产的窗口，现在改是成本最低的时刻**。至少在代码注释里写清「无分隔符是既定契约，勿单方修改」。

---

### P1-4 ｜ 同一 non-extractable 约束，一处绕开一处踩中（P0-1 的根因）

**定位**：
- 绕开者：`recoverAndRewrap`（`keyChain.ts:143-165`）—— 需要 UserKey 的 raw 时，**从 `aesDecrypt` 的返回值直接取**（`keyChain.ts:153` `ukRaw`），**从未对 `this.userKey` 调 exportKey**。
- 踩中者：`changeMasterPassword`（`keyChain.ts:190`）—— 需要 UserKey 的 raw 时，**去 export 已经 import 过的 `this.userKey`**。

**这是本次审计最有价值的发现**：两个函数做的是**同一件事**（拿到 UserKey 的 raw bytes 用于包裹），一个用「解密函数的返回值」（天然可得 raw），一个用「exportKey」（被 extractable 挡死）。**说明 `keyChain.ts:54` 引入 non-extractable 时，作者只更新了 restore 流程，漏改了 change 流程。**

**整改建议**：这不仅是修一个 bug，而是**统一"取 UserKey raw"的路径**。建议抽出：
```ts
private async unwrapUserKeyRaw(kRaw: Uint8Array, encryptedUserKey: string): Promise<Uint8Array | null>
```
作为**唯一**获取 UserKey raw 的入口（返回 raw + 同时设置 `this.userKey`），所有需要 raw 的地方都走它。这样「何时能拿到 raw」这件事只有一个答案。

---

### P1-5 ｜ 限流用未验签的 JWT payload

**定位**：`server/app/middleware/rate_limit.py:47-63`

```python
def _extract_user_id(request: Request) -> Optional[str]:
    """从 Authorization Bearer token 解析 user_id（仅解码 payload，不验签）。"""
    ...
    payload = json.loads(base64.urlsafe_b64decode(payload_b64))
    sub = payload.get("sub")
    return str(sub) if sub else None
```

**注意**：`rate_limit.py:57-58` 的 base64url padding 补齐（`+ "=" * (-len % 4)`）**写法是正确的**——不是缺陷。（修正：此前审计笔记里曾把这点记为"解码 bug"，实测无此问题。）

**真实问题**：**不验签**。攻击者构造任意 JWT（`header.payload.signature` 三段，签名随便填），把 `sub` 设为**受害者 user_id** → 限流 key 变成 `userrate:{受害者}` → **攻击者的大量请求被计到受害者头上**，可把受害者打成 429；反之把 `sub` 设为随机值即可**规避自身的 IP 限流**（每次换一个 sub，`userrate:xxx` 桶永不溢出）。

**缓解因素**：攻击者这样做拿不到有效 access token，业务端点仍会 401——所以**影响面限于"限流计数污染 / 规避"**，不构成越权访问。这不是"能读数据"的漏洞，是"能打掉别人 / 绕过限流"的漏洞。

**修复建议（三选一，按成本排序）**：
1. **最省**：对 token 做 `jwt.decode(..., settings.jwt_secret_key, algorithms=[...])`，验证失败则退回按 IP 限流（**注意**：中间件在限流最外层，验签成本是每请求一次 HMAC——可接受，且 `transport_crypto.py:59` 本来就已验过一次，重复验签的边际成本是常数）。
2. **更省**：让限流 key 只用 `sub` 的**签名有效期内的哈希**，或用 `jti`（若有）。
3. **架构级**：把「已认证按 user_id 限流」下沉到依赖注入层（`Depends(get_current_user_id)` 之后），中间件只做 IP 限流。**这是最干净的**——中间件不该假装知道"已认证"。

---

### P1-6 / P1-7 ｜ 反代下的 IP 限流退化 + 两处 `_client_ip` 口径分裂

**定位**
- `server/app/config.py:41`：`trusted_proxies: str = ""`（空默认）
- `server/app/middleware/rate_limit.py:30-44`：`_client_ip`，**仅当 `request.client.host in trusted_proxies` 才采信 XFF/X-Real-IP**
- `server/app/api/auth.py:125-130`：`_client_ip`，**无条件优先取 `X-Real-IP`**

**两个独立问题**：

**(a) 空默认 `trusted_proxies=""` 在反代部署下使 IP 限流退化**
部署形态（`DEPLOY.md`）若为 `Nginx/Caddy → uvicorn`，则 `request.client.host` 永远是反代 IP（`127.0.0.1`），而 `trusted_proxies` 为空 → `direct in trusted` 恒 false → `_client_ip` 恒返回反代 IP → **所有用户共用一个 `iprate:127.0.0.1` 桶**。后果：或**全体误伤**（桶被快速打满），或**限流形同虚设**（阈值被稀释）。这是典型的「配置默认值与部署形态不匹配」。

**(b) 两个 `_client_ip` 策略不一致（安全语义分裂）**
- `rate_limit.py` 在可信代理时**优先 XFF 最左**（`xff.split(",")[0]`）
- `auth.py` **无条件优先 X-Real-IP**，且注释明确说「不取 X-Forwarded-For（client 可伪造）」

**后者（auth.py）的安全判断更正确**：XFF 最左端是**完全由客户端控制**的（客户端可发 `X-Forwarded-For: 1.2.3.4`，反代默认 append 到右侧），取最左等于采信客户端伪造值。**`auth.py` 拒绝 XFF 是对的；`rate_limit.py` 采信 XFF 最左是错的。**

**综合影响**：同一请求，审计日志（`last_auth_ip`，来自 `auth.py`）记的是反代传的 X-Real-IP（可信），而限流（`rate_limit.py`）用的是 XFF 最左（可伪造）→ **攻击者可随意切换 XFF 头让自己的限流 key 每次不同，完全绕过 IP 限流**，同时审计日志里 IP 看起来正常。**取证与限流口径分裂，且分裂方向对攻击者有利。**

**修复建议**
1. `trusted_proxies` 必须在部署时**显式配置**为反代 IP（`DEPLOY.md` 里应有此步骤，需核对）；或改为**部署文档强制项 + 启动时若为生产环境且为空则 fail-fast 告警**。
2. **统一 `_client_ip` 到一处**（建议提为 `app/utils/net.py::client_ip(request)`），采用 `auth.py` 的保守策略（只信 X-Real-IP，且仅在可信直连时），删掉 XFF 分支。
3. 若确需 XFF，**取最右端**（由最近的反代写入，客户端无法伪造），而非最左。

---

### P1-8 ｜ `session_K` 明文存 IndexedDB

**定位**：`web/src/db/sessionStore.ts:9-23`（`EMPTY_SESSION.session_K = ""`）、`sessionStore.ts:31-36`（`saveSession` 直接 merge 落库）

**对比**：同文件里 `cached_K` 与 `mnemonic_encrypted` 都是**用 `localDerivedKey` 包裹后**才存的（见 `keyChain.ts:62 / 65`），而 `session_K` 是**裸 hex** 落库。

**影响**：K_comm 是加密全部 API 请求/响应的密钥（`transport_crypto.py:71-76` 从 Redis 取、前端 `saveSession({session_K: bytesToHex(K)})` 存本地）。它以明文躺在 IndexedDB → 任一 XSS 读一条记录即可拿到 K_comm → **解密全部通信流量**（含条目密文字段、登录响应等）。虽然 K_comm 是 session 级（30 天 TTL），但 30 天窗口足够长。

**为什么这比"XSS 本来就能读内存"更严重**：内存里的 K_comm 只在解锁/使用时存在，且随 lock 清除；而 **IndexedDB 里的 K_comm 是持久化的**——XSS 即便在用户 lock 之后注入，也能读到。

**修复建议**：`session_K` 也应用 `localDerivedKey` 包裹（同 `cached_K` 的处理），或干脆**不落盘**——K_comm 可通过 refresh-token 轮换重新从服务端续期（`auth.py:472-473` `renew_session_key`），本地缓存它的收益存疑。

---

### P1-9 ｜ `atob` 解 JWT payload 不支持 base64url

**定位**：`web/src/context/AuthContext.tsx:58`

```ts
const payload = JSON.parse(atob(token.split(".")[1]));
```

**问题**：JWT payload 段是 **base64url**（`-`/`_` 替代 `+`/`/`），而浏览器 `atob` 只接受标准 base64，遇到 `-`/`_` **抛 `InvalidCharacterError`**。此处被外层 `try/catch` 吞掉 → `tokenValid = false` → `checkSession` 置 `status="guest"`。

**后果**：**正常的、未过期的 session 被误判为未登录**——用户刷新页面后被当游客，需重新走完整登录/恢复流程。是否触发**取决于 payload 内容的偶然字节**（含 `-`/`_` 才炸），因此表现为**间歇性、难复现的"掉登录"**——正是威廉姆最讨厌的**间歇性静默失败**。

**注意对照**：`rate_limit.py:57-58` 服务端**做对了**（`urlsafe_b64decode` + padding 补齐）；前端这里是**手写漏了 url-safe 转换**。

**修复建议**：
```ts
const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
const payload = JSON.parse(atob(b64));
```
或直接用 `jose`/`jwt-decode`（项目已有 `jose` 依赖用于其他处？需核对，若无则手写转换更轻）。

---

### P1-10 ｜ Item Key 每次编辑轮换（与文档相悖）

**定位**：`web/src/pages/vault/ItemEditPage.tsx:104`

```ts
const itemKey = await keyChain.createItemKey();   // 每次 handleSave 都新建
```

**文档承诺**：`ARCHITECTURE.md:229`「每条目一个随机 ItemKey（UserKey 包裹）」；`keyChain.ts:218` 区块注释「Item Key（不变）」。

**实际**：`handleSave` 无论新建还是编辑，**都调用 `createItemKey()` 生成全新 ItemKey**，然后用它重包 `name`/`description`/`data` 三个字段。功能上可行（`encrypted_key` 随字段一起写入服务端），但：
- **「不变」的表述与实现不符**——文档失真（见 DOC-3）。
- **语义后果**：条目内容的每次修改都会产生新的 ItemKey，**旧的 ItemKey 随之废弃**。这使得「ItemKey 轮换」实际上变成了**每条目每版本一个密钥**——如果未来要做「基于 ItemKey 的历史版本解密」或「单字段粒度审计」，此行为会增加复杂度。
- **一致性风险**：若未来引入「批量改条目」（如 vault 级操作），每次都产新 ItemKey 会让密文复用/覆盖逻辑变脆。

**修复建议（先决策，再改代码）**：
- 若**意图是"每次编辑轮换 ItemKey"**（更安全，前向保密性更好）→ **改文档**，并明确写出"轮换策略"。
- 若**意图是"ItemKey 稳定"**（文档原意）→ 修改 `ItemEditPage.tsx:104`，编辑时复用 `origItem` 的 `encrypted_key` 解密出的 ItemKey。
- **当前状态最差**：文档说的和代码做的不一致，**后来者会按文档理解，写出错误假设的代码**。

---

## 3. P2 清单（卫生 / 韧性，共 16 条）

按「不改会怎样」分组，不逐条展开证据链（定位已足够）。

### 3.1 死代码与残留（会误导后来者）

| # | 定位 | 问题 | 建议 |
|---|---|---|---|
| P2-1 | `keyChain.ts:213-216` `exportUserKeyRaw` | 对 non-extractable `userKey` 调 exportKey（同 P0-1 缺陷）+ **全仓零调用方** | 删除 |
| P2-2 | `constants.ts:2` 注释 | 「与 Android CryptoManager.kt 完全一致」——Android 端 `app/` 是 2019 残留 | 删除该引用 |
| P2-3 | `constants.ts:12-15,17` `RSA_KEY_LENGTH`/`RSA_CHUNK_SIZE`/`RSA_DECRYPT_CHUNK`/`DEVICE_KEY_ALIAS` | RSA 方案已废弃（`CLAUDE.md` 确认 `crypto/rsa.ts` 无引用） | 随 `rsa.ts` 一并清理 |
| P2-4 | `config.py::mnemonic_hmac_key = ""` | 空默认 + 全仓无使用（`/salt` 用 `jwt_secret_key` 派生 fake salt） | 确认废弃后删除 |

### 3.2 输入校验缺失（同类问题，建议一次性统一）

| # | 定位 | 问题 |
|---|---|---|
| P2-5 | `transport.ts::decryptBody` | `data.slice(0,12)`/`slice(12)` **不校验 `data.length >= 12`**（对比 `aes.ts:46` 有 `GCM_NONCE_LENGTH + 1` 校验） |
| P2-6 | `transport.ts` + `srp.ts:220-223` `hexToBytes` | 用废弃 `String.prototype.substr` 且**不校验奇偶长度** |
| P2-7 | `sync.ts:139-141 / 151-153` | `JSON.parse(remote.name)` / `JSON.parse(remote.data)` **无 try/catch** → 服务端返回非法 JSON 即整轮同步崩（对比 `ItemEditPage.tsx:60-64` 有兜底） |
| P2-8 | `backup.ts` | 导入仅校验 `raw.length < 33` + `payload.version !== 1`，**无字段结构校验** → 恶意 `.safebox` 可注入任意 `type` / 超大 `updatedAt` / 缺字段；且**无文件大小上限**，大文件直接 `arrayBuffer()` 进内存 |
| P2-9 | `schemas` `SyncItemRequest.updated_at: str` | **无格式校验**；`sync.ts:43` 把**客户端本地时钟** `new Date(item.updatedAt).toISOString()` 推给服务端 |

> **统一的解法**：把「密文字节长度下限」「hex 长度偶数」「JSON.parse 兜底」「导入结构校验」做成**公共工具函数**（如 `web/src/crypto/guards.ts`），替换各处的临时判断。**现在的问题是同类校验在项目里散落且策略不一**——`aes.ts` 做了，`transport.ts` 没做。

### 3.3 状态与契约（隐性耦合）

| # | 定位 | 问题 |
|---|---|---|
| P2-10 | `AuthContext.tsx:96-98` `unlock()` | 仅 `setState({status:"ready"})`，**不重建 UserKey** → 依赖调用方先调 `unlockWithPassword`。**隐式契约**：若日后有别的入口直接调 `unlock()`，会得到「status=ready 但 `isUnlocked=false`」的不一致态 |
| P2-11 | `RecoveryPage.tsx:78` | `login(...)` **未 await**（对比 `LoginPage.tsx:45` 有 `await`）→ 竞态：可能在 `setState({status:"ready"})` 前就 `navigate("/")` |
| P2-12 | `middleware/transport_crypto.py:23-29` `ENCRYPT_FREE_PREFIXES` | 用 `startswith` 匹配，`/api/v1/auth/login` **顺带放行了** `/login/srp/challenge` 与 `/verify`。当前**行为正确**（这些端点确实不带 Bearer，见 :54 会透传），但属**脆弱的隐式契约**：将来新增 `/api/v1/auth/login/xxx` 需加密的端点会被静默放行。建议改用精确匹配或显式列出 |
| P2-13 | `web/src/db/database.ts:6-13,19` | `DB_VERSION = 1`，注释自陈「调试阶段…**【投产前必做】将 DB_VERSION 设为当前版本 +1，在 upgrade() 中用 oldVersion 分支编写迁移逻辑**」；当前 `upgrade()` **无 oldVersion 分支**。**投产即负债**：后续任何 schema 变更，老用户库无法升级。 |

### 3.4 运维与通知（生产静默失败）

| # | 定位 | 问题 |
|---|---|---|
| P2-14 | `email_service.py:11-38` / `sms_service.py:10-47` | **DEV 分支 `return True`**：未配 SMTP/Twilio 时打印 `[DEV]` 并**返回成功**，且 `send_sms` 把**明文验证码写进 debug 日志**。生产误配 → 用户永远收不到码、服务端却报成功。**建议：生产环境（非 DEV）缺配置应 fail-fast，而非静默 return True。** <br>**2026-10-01 已修** ✅ —— 新增 `settings.environment` + `is_production`；未配置时 develop 放行（记 warning）、production 返回 False（`/send-code` 转 503）。`print()` 改受级别控制的 logging，**production 分支不打印验证码**。 |
| P2-15 | `email_service.py:81-155` | 告警邮件**全硬编码中文**（不接收 `lang`，无法本地化）；`password_changed` 文案「您的 SafeBox Passphrase已被修改。」**中英混杂 + 缺空格 + 术语 Passphrase 与全项目「主密码」不一致**；**告警内容不含来源 IP / 设备信息** —— 安全告警缺最关键上下文 <br>**2026-10-01 部分已修** ✅ —— 告警文案全面 i18n（zh/en 对齐），`send_recovery_alert` → `send_password_changed_alert(user, lang)`，语言由 `Accept-Language` 透传；删掉服务于已取消恢复机制的三条死分支。**仍缺**：告警内容不含来源 IP / 设备信息（未做，见第 6 节）。 |
| P2-16 | ✅ **已修** | `itemTypes` 配置缓存改**按语言分桶**（原单变量永久固化 → 切语言后 label/hint 残留旧语言，静默失效）。**注：当前无运行时语言切换入口，故该缺陷不可达**；属防雷 | 新增 5 条测试，**反证：换回旧缓存必 2 条红** |
| **P2-17** | ✅ **已修** | **后端 i18n 从未被扫过。** 提交 `59ee30b` 宣称「i18n 5 维度全绿：硬编码 0 + 死 key 0」，但那次只扫了前端 `web/src/i18n/`。后端实际有：**10 处硬编码用户可见错误文案**（含中间件 `rate_limit.py:108` 的 `"Too many requests..."`、`transport_crypto` 三处、`auth.py` 五处把协议术语 `invalid A`/`invalid M1` 暴露给用户）、**7 个零引用死 key**、`email_service` 三条死分支 | 10 处改 i18n；删 7 死 key + 3 死分支；**新增 6 条可执行闸门**，**反证：注入 4 类违规全部变红** |

---

## 4. 文档失真清单（文档 vs 代码）

| # | 文档原文（位置） | 代码实际 | 建议 |
|---|---|---|---|
| DOC-1 | `FEATURE_LIST.md` 第七节：「限流…已认证按 user_id，否则按 IP（**X-Real-IP**）」 | `rate_limit.py:40` 优先 **X-Forwarded-For 最左**，仅回退 X-Real-IP | 改文档与代码**同时**对齐到「只信 X-Real-IP（可信直连时）」——见 P1-6/7 |
| DOC-2 | `ARCHITECTURE.md:229`「每条目一个随机 ItemKey（UserKey 包裹）」+ `keyChain.ts:218` 注释「Item Key（不变）」 | `ItemEditPage.tsx:104` **每次保存都 `createItemKey()`** | 先裁定"是否轮换"，再改文档或代码（见 P1-10） |
| DOC-3 | `ARCHITECTURE.md` / `RECOVERY_MECHANISM.md` 把 `recoverAndRewrap` 描述为产 4 项（K / UserKey / cached_K / mnemonic_encrypted） | `keyChain.ts:149` 实际返回 `{ok, newCachedK?, mnemonicEncrypted?}` —— **只 2 个产物**（UserKey 落内存、K 不返） | 修正文档为「产 2 项 + 副作用（设置内存 UserKey）」 |
| DOC-4 | 全部文档默认 **email-only** 恢复（`RECOVERY_MECHANISM.md` 十一节 API 表 + 全流程） | 前端 `RecoveryPage` 确实 email-only，**但这是缺陷不是设计**（见 P0-2，LoginPage/RegisterPage 均支持 phone） | 修复 P0-2 后在文档中补「email / phone 双路径」 |
| DOC-5 | `srp_service.py:9` 头注释：`info="safebox-srp"` | `srp_service.py:92` 实际 `AUTH_INFO = b"safebox-srp-auth"`（前端 `srp.ts:28` 亦为 `-auth`）→ **实现正确，仅后端注释错** | 改注释 |
| DOC-6 | `kdf.ts:4` 头注释 + `KdfSettings` 类型：「支持 PBKDF2 / Argon2id」 | `kdf.ts:42` argon2id **直接抛错** | 见 P1-1 |
| DOC-7 | `ARCHITECTURE.md:97`「防重放：AES-GCM nonce 随机 + tag 认证（**per-message replay 未做，与白皮书一致待改进**）」 | 属实，**是诚实标注而非失真** | 保留；但建议升级为待办条目（见第 5 节） |

---

## 5. 值得表扬的部分（避免只报坏消息）

审计如果只列问题，会给人「这项目很烂」的错误印象。**实际上这几处做得比大多数同类项目好**：

1. **SRP-6a 数学实现与 RFC 3526 逐字节一致**：`srp_service.py:36-41` 的 `_N_HEX` 与前端 `srp.ts` 完全对齐；`k = H(PAD(N)|PAD(g))`、`u = H(PAD(A)|PAD(B))`、`M1 = H(PAD(A)|PAD(B)|K)` 全部符合规范；`verify_M1`/`verify_M2` 用 `hmac.compare_digest`（**恒定时间比较，防时序侧信道——很多人会漏**）。
2. **2SKD 双秘密 XOR 设计正确**：`x = PBKDF2(...) XOR HKDF(助记词, ...)`，两个独立 secret 通过 XOR 组合，任一单独泄露都不足以推出 x。HKDF 自实现（`srp_service.py:68-85`）符合 RFC 5869。
3. **改密端点的原子性**：`auth.py:442-445` 在**单次 commit** 内完成 `revoke_all_user_tokens` + 清其他设备 session_key，且**明确保留当前设备**的 K_comm（`UserDevice.id != device_id` 条件）——这是有意识的"对称撤销 + 保持当前会话连续"设计，**考虑得比很多实现细**。
4. **纯 ASGI 中间件的技术选择正确**：`transport_crypto.py:1-5` 头注释解释了为何不用 `BaseHTTPMiddleware`（`call_next` 的 receive wrapper 不传 dispatch 里设的新 receive → body 修改不传到端点）。**这是个非常容易踩的坑，作者不但避开了还写下了原因。**
5. **`X-Safebox-Encrypted: 1` 强制头防 downgrade**：`transport_crypto.py:81-83` 缺失该头直接 400，而非"未加密就明文放行"。**防降级攻击的正确做法。**
6. **K 不存在时拒 401 而非放行**：`transport_crypto.py:72-75`——`session_key` 不在 Redis 时硬拒，强制重走 SRP login 重建 K。**这是防 downgrade 的关键，且注释写明了理由。**
7. **`AuthContext` 的 state 机设计干净**：`"loading" | "guest" | "locked" | "ready"` 四态 + `useAutoLock` 分离，比多数 SPA 的"isLoggedIn 布尔"清晰得多。
8. **`last_auth_ip` 明确拒用 XFF**（`auth.py:126` 注释）——**安全判断正确**（问题只在 `rate_limit.py` 没跟上这个判断）。

**结论**：这是一个**密码学协议层经过认真设计、但前端密钥生命周期管理存在未跟上的回归**的项目。P0-1 不是"水平不够"，是"改 A 忘了改 B"的典型软件工程问题。

---

## 6. 整改优先级路线图

### 立即（阻断核心功能，建议同一批次）
1. **P0-1**：修 `changeMasterPassword` 的 UserKey 获取路径（推荐走 `P1-4` 的统一入口方案）；同时删 `exportUserKeyRaw`。**必须补一条覆盖改密全链路的单测**——这正是当前 12 个前端测试文件的盲区。
2. **P0-2**：`RecoveryPage` 支持 phone；顺带把 `session.email` 的语义污染修掉（引入显式 `identifier_type`）。

### 紧随（安全边界）
3. **P1-5 / P1-6 / P1-7**：限流中间件**合并成一次改造**——统一 `_client_ip`、验签 JWT（或下沉到依赖层）、`trusted_proxies` 部署强制项。
4. **P1-8**：`session_K` 加密或不落盘。
5. **P1-9**：`AuthContext` base64url 修正。
6. **P1-2**：`deriveKey` 改 `extractable=false` + `wrapKey`（与 P0-1 同源，可合并）。

### 计划（韧性 / 一致性）
7. **P1-1 / P1-3 / P1-10**：三个「需先裁定契约再改」的项——argon2id 去留、K 派生拼接约定、ItemKey 轮换语义。**建议由威廉姆裁定，不宜由实现者自定。**
8. **P2-5~P2-9**：抽出公共校验工具，统一替换。
9. **P2-13**：`DB_VERSION` 迁移策略（**投产前必须处理**）。
10. **P2-14**：生产环境缺 SMTP/Twilio 时 fail-fast。

### 文档
11. **DOC-1~DOC-7** 全部对齐；其中 DOC-2（ItemKey）需等 #7 裁定后一并改。

---

## 7. 审计的边界（未能覆盖的部分）

诚实声明本次未做的部分，避免给读者「已全覆盖」的错觉：

- **未执行任何测试**：`server/tests`（6 文件）与 `web/src`（12 测试文件）**均未运行**。因此 **P0-1 是静态推断的必然性**（依据是 WebCrypto 规范中 `extractable=false` 的 `exportKey` 必抛 `InvalidAccessError`），**建议用一条单测实证**。
- **未读**：`web/src/pages/vault/ItemDetailPage.tsx`、`VaultListPage.tsx`（列表/详情页，本次只确认存在）；`web/src/crypto/bip39.ts` + `wordlist.ts`（BIP39 词表实现）；`web/src/hooks/useAutoLock.ts`；`server/app/services/bip39.py`；`server/app/i18n/`；`server/app/database.py`；`scripts/deploy-*.sh`；`decrypt_backup.py`；`docs/dev-debug.md`、`docs/testing/curl-test-cases.md`。
- **未验证部署形态**：`trusted_proxies` 的实际生产取值需对照 `DEPLOY.md` 与线上 nginx/caddy 配置（本次只确认默认值为空）。
- **未做**：渗透测试、依赖漏洞扫描（`npm audit` / `pip-audit`）、`app/`（2019 Android 残留）的清理评估。

---

## 附：本次审计的关键行号索引

便于复查快速跳转：

| 主题 | 位置 |
|---|---|
| UserKey import 为 non-extractable（4 处） | `keyChain.ts:54, 101, 134, 156` |
| UserKey exportKey 崩溃点 | `keyChain.ts:190`（改密）、`keyChain.ts:215`（死代码） |
| K 派生裸拼接（4 处） | `keyChain.ts:48, 130, 152, 189` |
| deriveKey 返回 extractable | `kdf.ts:50` |
| argon2id 抛错 | `kdf.ts:41-42` |
| RecoveryPage 硬编码 email | `RecoveryPage.tsx:51, 54, 93` |
| session.email 存手机号 | `LoginPage.tsx:108` |
| 限流不验签解 JWT | `rate_limit.py:47-63` |
| trusted_proxies 空默认 | `config.py:41` |
| 两处 _client_ip 分裂 | `rate_limit.py:30-44` vs `auth.py:125-130` |
| session_K 明文落库 | `sessionStore.ts:9-23, 31-36` |
| atob 解 base64url JWT | `AuthContext.tsx:58` |
| ItemKey 每次轮换 | `ItemEditPage.tsx:104` |
| 改密端点（服务端，正确） | `auth.py:414-459` |
| 传输加密中间件 | `transport_crypto.py:23-90` |
| SRP 数学实现 | `srp_service.py:36-193` |
| INFO 名注释与实现不一致 | `srp_service.py:9` vs `:92` |
