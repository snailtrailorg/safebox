# SafeBox

端到端加密密码管理器。Web 客户端 + FastAPI 后端，零知识架构（SRP-6a 认证 + SRP K 通信加密），对标 1Password 白皮书。

## 架构

```
客户端 (Web)
  ├─ 所有加解密在本地完成（User Key + Item Key 字段级 AES-256-GCM）
  ├─ SRP-6a 登录（客户端算 A/M1，服务端只验，零知识）
  ├─ 助记词本地持有 + 加密缓存 IndexedDB，不上传
  ├─ SRP K 通信加密（登录后认证 body + 响应 AES-GCM(K)，TLS 之上第二层）
  └─ 三态 session：login（SRP）/ lock-unlock（autoLock 本地）/ logout（清缓存）

服务端 (FastAPI + PostgreSQL + Redis)
  ├─ 认证：SRP-6a challenge/verify + Google OAuth
  ├─ device 绑 token + deauthorize（access 立即失效）+ device info（浏览器/OS/IP）
  ├─ 只存 SRP verifier（不存密码/助记词明文）
  ├─ SRP K 通信加密 middleware（纯 ASGI，K 不存拒 401）
  └─ 条目同步（pull/push/delete，version 乐观并发）
```

## 技术栈

| 层 | 技术 |
|---|---|
| Web | React 19, TypeScript, Vite 6, Web Crypto API, IndexedDB (idb), react-router-dom, i18next |
| 后端 | Python FastAPI, SQLAlchemy (async), Alembic, PyJWT, cryptography (AES-GCM), PostgreSQL, Redis |
| 部署 | Nginx 反代（对外文档）/ Apache httpd（生产实际）, Gunicorn + Uvicorn, Systemd |

> SRP-6a 自实现（`server/app/services/srp_service.py` + `web/src/crypto/srp.ts`），无外部 SRP 库。
> K 通信加密 middleware 纯 ASGI（`server/app/middleware/transport_crypto.py`），因 BaseHTTPMiddleware 的 call_next 不传 receive body。

## 项目结构

```
safebox/
├── server/                 # FastAPI 后端
│   ├── app/
│   │   ├── api/            # 路由 (auth, sync)
│   │   ├── models/         # ORM (user, user_keys, token_families, user_devices, items)
│   │   ├── schemas/        # Pydantic 请求/响应
│   │   ├── services/       # srp, auth, token, verification, transport_crypto, bip39, email, sms
│   │   ├── middleware/     # JWT 中间件 + 纯 ASGI K 通信加密 middleware + 限流
│   │   └── i18n/           # en/zh
│   ├── migrations/         # Alembic（device_auth + device_info）
│   └── tests/             # 38 tests
├── web/                    # React Web 客户端
│   └── src/
│       ├── crypto/         # srp, transport(K 加解密), PBKDF2, AES-GCM, BIP39, KDF
│       ├── keychain/       # keyChain 全局单例（User Key 生命周期）
│       ├── services/       # api, srpAuth(performSrpLogin 公共)
│       ├── pages/          # auth, vault, settings(含 DevicesPage)
│       ├── routes/         # AuthGuard(GuestGuard + UnlockScreen)
│       ├── context/        # AuthContext(login/lock/unlock/logout)
│       └── types/          # api, domain
├── docs/                   # 架构文档
├── scripts/                # 服务器部署脚本（deploy-server/clear-db/deploy-web/migrate-db）
├── DEPLOY.md               # 生产部署指南
└── CLAUDE.md               # 项目约定
```

## 快速开始

### 本地开发（手动，不跑部署脚本）

```bash
# 后端
cd server
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. venv/bin/alembic upgrade head
PYTHONPATH=. venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Web 前端
cd web
npm install
npm run dev        # http://localhost:5173
```

> 服务器部署用 `scripts/deploy-*.sh`（脚本，`sudo -u michael` 推服务器）；本地调试手动起 uvicorn + npm run dev，**不要本地跑部署脚本**（会清生产库）。详见 `docs/dev-debug.md`。

## 安全模型

### 核心原则：服务端零知识

**包括服务器管理员在内，任何人都无法获取密码和条目明文。所有加解密在客户端本地完成，登录走 SRP-6a（服务端只存 verifier），密码和明文从不离开设备。SRP K 通信加密在 TLS 之上加第二层，防反代日志/Nginx 终止点/中间人看到认证通信明文。**

### 密钥层次（SRP + 合并主密码 + K 通信）

```
助记词[BIP39 12 词] + 主密码
   │
   ├── 2SKD: x = PBKDF2(主密码, HKDF拉伸(srp_salt,邮箱), 600k) XOR HKDF(助记词, salt=邮箱)
   │        -> verifier v = g^x mod N（存服务器，SRP 认证）
   │
   ├── K 派生: K = PBKDF2(助记词+主密码, mnemonic_salt, 600k)（永久不变，不存服务器）
   │          -> encrypted_user_key = AES(K, UserKey)（存服务器）
   │             -> User Key（随机 AES-256，包裹 Item Keys）
   │                -> Item Key（每条目独立）
   │                   -> 条目字段 AES-256-GCM + AAD
   │
   ├── 通信 K: K_comm = H(S)（SRP 握手派生，session 级 30 天，login 存/logout 清）
   │          -> 认证 POST body + 响应 AES-GCM(K_comm) 加密
   │
   └── 主密码（参与 K + x 派生，可改，需助记词+邮箱）:
        ├── localDerivedKey = PBKDF2(主密码, local_salt, 600k)
        ├── cached_K = AES(localDerivedKey, K)（本地缓存，lock/unlock 用）
        └── mnemonic_encrypted = AES(localDerivedKey, 助记词)（本地，同设备登录算 x 用）
```

### 三态 session 模型（对标 1Password）

| 状态 | 触发 | 动作 | session_K |
|---|---|---|---|
| **login** | 用户输主密码+助记词（或同设备从缓存取）| SRP 握手建 session + session_K（client IndexedDB + server Redis） | 建立 |
| **lock** | autoLock 20min 空闲 | `keyChain.lock()` 清内存 UserKey，不清 session（cached_K 保留） | 不变 |
| **unlock** | 锁屏输主密码 | `unlockWithPassword` 本地解 cached_K（不走 SRP） | 不变 |
| **logout** | 用户主动退出 | 清整个 session（cached_K + mnemonic_encrypted + session_K + token），重登需助记词+主密码（走 RecoveryPage） | 清除 |

> **决策 A**（对标 1Password）：logout 清缓存，重登走换设备流程（助记词+主密码 SRP + recoverAndRewrap 重建缓存），不是同设备登录（主密码）。忘主密码 = 数据丢失（主密码参与 K + x 派生，无服务端重置）。

### SRP K 通信加密（对标 1Password SRP+GCM）

- SRP verify 后 `K=H(S)` 存 Redis `session_key:{device_id}` TTL **session 级 30 天**（refresh 续，login 存/logout 清）+ client IndexedDB
- 认证 POST body + 响应用 K AES-256-GCM 加密，header `X-Safebox-Encrypted: 1`（强制）
- **K 不存拒 401 `session expired`**（不透传，防 downgrade；强制重 SRP login 重建 K）
- middleware 纯 ASGI（BaseHTTPMiddleware 的 call_next 不传 receive body，故用纯 ASGI 直接控制 scope/receive/send）
- 登录前 API（/salt/register/login/refresh）不加密

### 设备 deauthorize + device info

- `device_id` 绑 access/refresh token（JWT claim）
- `UserDevice` 表：device_name + client_name/os_name/last_auth_ip（challenge/verify 从 User-Agent + X-Real-IP 解析填充）+ is_revoked/revoked_at + last_active_at/created_at/updated_at
- `DELETE /auth/devices/{id}` deauthorize：标记 is_revoked + 删该 device TokenFamily + Redis `device:revoked:{id}` TTL 30min（中间件查，access 立即失效，解决 access 30min 重用）
- `GET /auth/devices` 设备列表（含 is_current/is_revoked/client_name/os_name/last_auth_ip）
- 改密时清**其他设备** session_key（当前 device 保留）-> 其他设备 K 不存 401 -> 踢到 RecoveryPage 重登

### 服务端存储了什么

| 字段 | 实际内容 | 谁能解密 |
|---|---|---|
| `srp_verifier` | hex(v=g^x mod N)，2SKD x 派生 | 仅 SRP 认证（不可反推密码） |
| `encrypted_user_key` | AES-GCM(K, UserKey)（K 不在服务器） | 拥有 K（助记词+主密码）的人 |
| `items.*` | EncryptedField `{encrypted_key, ciphertext}` | 拥有 UserKey 的人 |
| `session_key:{device_id}` | Redis，K_comm hex，TTL 30 天 | 通信加密用（不解数据） |
| `device:revoked:{id}` | Redis，TTL 30min | deauthorize 标记 |

> 助记词不上传（废除 mnemonics 表），客户端本地持有 + 加密缓存。

### 攻击场景分析

1. **服务器被入侵，数据库泄露**：拿到 verifier + 密文，但无密码/助记词。verifier 泄露无法重放（SRP）；2SKD 双秘密缺一不可；K 不在服务器。
2. **管理员/内部人员作恶**：同上，密码/助记词不出客户端。
3. **TLS 终止点/反代日志/中间人**：SRP K 通信加密第二层，认证 body + 响应密文，K 不存拒 401（防 downgrade 注入）。
4. **忘主密码**：数据永久丢失（主密码参与 K + x 派生，无后门）。
5. **设备失守**：cached_K/mnemonic_encrypted 被 localDerivedKey 包裹（需主密码解）；logout 清缓存（决策 A）减少暴露。

### 用户必须知道的事

1. **主密码不要忘记**（忘 = 数据丢失，无找回）。
2. **助记词妥善保存**（12 词，换设备 + logout 重登要用，建议打印离线存放）。
3. **换设备需助记词 + 主密码**（RecoveryPage，SRP + recoverAndRewrap 重建缓存）。

详见 `docs/`。

## 部署

- **服务器**：`scripts/deploy-*.sh`（deploy-server/clear-db/deploy-web/migrate-db，`sudo -u michael` 免密推服务器）。详见 `DEPLOY.md`。
- **本地**：手动 uvicorn + npm run dev（不跑部署脚本）。详见 `docs/dev-debug.md`。

## License

MIT
