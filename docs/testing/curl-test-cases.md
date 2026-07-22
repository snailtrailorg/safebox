# SafeBox curl 测试用例

覆盖 `docs/FEATURE_LIST.md` 全部端点。所有路径前缀 `/api/v1`，除标注外需 `Authorization: Bearer <access_token>`。

> SRP-6a 登录需客户端算 A/M1（BigInt + SHA-256），curl 单独无法完成。下文用 `server/` venv Python 算 SRP 值 + curl 发请求。完整 SRP 流程测试见 `server/tests/test_auth.py`。
> Phase 2 K 通信加密：认证 body + 响应 K 加密，curl 看不到明文，用 Python httpx + `tests/_srp.py` 模拟。

## 环境变量

```bash
BASE=http://127.0.0.1:8000          # 本地；服务器改 https://safebox.snailtrail.org
EMAIL=test$RANDOM@safebox.dev
PHONE="+8613800138000"
PASSWORD="MasterPass123!"
MNEMONIC="abandon ability able about above absent absorb abstract accuse achieve acid acoustic"
SRP_SALT="00112233445566778899aabbccddeeff"   # 16 字节 hex，客户端生成
LOCAL_SALT="aabbccdd11223344..."               # base64(32 字节)
MNEMONIC_SALT="eeff001122334455..."            # base64(32 字节)

# SRP verifier 由客户端派生（Python 示例）：
# cd server && PYTHONPATH=. venv/bin/python -c "
# from app.services import srp_service as srp
# x=srp.derive_x('$PASSWORD','$MNEMONIC',bytes.fromhex('$SRP_SALT'),'$EMAIL')
# print(hex(srp.compute_verifier(x))[2:])"
```

## 验证码（dev 模式）

SMTP/Twilio 未配置时验证码存 Redis（`vc:{target}:{value}`），dev 模式服务端打印到终端。也可直接设码（绕过 send-code，避免 SMTP 卡）：

```bash
redis-cli SET "vc:email:$EMAIL" "123456" EX 300
redis-cli SET "vc:phone:$PHONE" "123456" EX 300
```

---

# 一、认证

## TC-01 健康检查
```bash
curl -s $BASE/health
# 200 {"status":"ok"}
```

## TC-02 获取 salt（防枚举）
```bash
curl -s "$BASE/api/v1/auth/salt?email=$EMAIL"
# 200 {"srp_salt":"...","local_salt":"...","mnemonic_salt":"...","kdf_settings":{"algorithm":"pbkdf2","iterations":600000},"N":"<hex 4096-bit>","g":"2"}
# 不存在的用户返回确定性伪造 salt，SRP verify 必失败，不可区分
```

## TC-03 发送验证码
```bash
curl -s -X POST $BASE/api/v1/auth/send-code \
  -H "Content-Type: application/json" \
  -d "{\"target\":\"email\",\"value\":\"$EMAIL\"}"
# 200 {"expires_in":300}
# 60s 内同目标再发 -> 429 verification_code_rate_limited
```

## TC-04 邮箱注册
```bash
VERIFIER=$(cd server && PYTHONPATH=. venv/bin/python -c "
from app.services import srp_service as srp
x=srp.derive_x('$PASSWORD','$MNEMONIC',bytes.fromhex('$SRP_SALT'),'$EMAIL')
print(hex(srp.compute_verifier(x))[2:])")

curl -s -X POST $BASE/api/v1/auth/register/email \
  -H "Content-Type: application/json" \
  -d "{
    \"email\":\"$EMAIL\",\"verification_code\":\"123456\",
    \"srp_verifier\":\"$VERIFIER\",\"srp_salt\":\"$SRP_SALT\",
    \"local_salt\":\"$LOCAL_SALT\",\"encrypted_user_key\":\"fake-euk\",
    \"mnemonic_salt\":\"$MNEMONIC_SALT\",
    \"kdf_settings\":{\"algorithm\":\"pbkdf2\",\"iterations\":600000},
    \"device_name\":\"Web Browser\",\"device_public_key\":\"web\",\"device_wrapped\":\"web\"
  }"
# 201 {"user_id":"...","access_token":"...","refresh_token":"...","device_id":"..."}
# 助记词不上传；device_id token 绑定；注册建 UserDevice（client_name/os_name/last_auth_ip from UA+IP）
```

## TC-05 手机号注册
同 TC-04，`email` 换 `phone`，verifier 的 identifier 用 phone。

## TC-07 SRP 登录（challenge + verify）
SRP 两步，需客户端算 A/M1。完整脚本（Python 算 + curl 发）：

```bash
cd server && PYTHONPATH=. venv/bin/python -c "
import asyncio, httpx
from app.services import srp_service as srp
EMAIL='$EMAIL'; PASSWORD='$PASSWORD'; MNEMONIC='$MNEMONIC'
async def main():
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8000') as c:
        salt = (await c.get(f'/api/v1/auth/salt?email={EMAIL}')).json()
        a = srp.generate_private_ephemeral(); A = srp.compute_client_public(a)
        chal = (await c.post('/api/v1/auth/login/srp/challenge', json={
            'target_type':'email','target':EMAIL,'A':hex(A)[2:],'device_id':'<同设备>'})).json()
        B = int(chal['B'],16)
        x = srp.derive_x(PASSWORD, MNEMONIC, bytes.fromhex(salt['srp_salt']), EMAIL)
        u = srp.compute_u(A, B); S = srp.compute_client_S(B, a, u, x)
        K = srp.compute_K(S); M1 = srp.compute_M1(A, B, K)
        resp = (await c.post('/api/v1/auth/login/srp/verify', json={
            'session_id':chal['session_id'],'M1':M1.hex()})).json()
        assert srp.verify_M2(A, M1, K, bytes.fromhex(resp['M2'])), 'M2 验证失败'
        print(resp['access_token'], resp['device_id'])
asyncio.run(main())
"
# 输出 access_token + device_id；错密码/错助记词/用户不存在 -> 401（统一错误防枚举）
# verify 后 K_comm 存 Redis session_key:{device_id} TTL 30 天
```

## TC-11 改密
需 fresh token（前置 SRP 登录验旧密码）+ 验证码 + 新 SRP 材料：

```bash
TOKEN="<前置 SRP 登录获取的 fresh token>"
NEW_SRP_SALT="00112233445566778899aabbccddee11"
NEW_VERIFIER=$(cd server && PYTHONPATH=. venv/bin/python -c "
from app.services import srp_service as srp
x=srp.derive_x('NewPass456!','$MNEMONIC',bytes.fromhex('$NEW_SRP_SALT'),'$EMAIL')
print(hex(srp.compute_verifier(x))[2:])")

# 注意：change-password 是认证端点，body 需 K 加密（X-Safebox-Encrypted:1），curl 单独无法完成
# 用 Python httpx + K 加密 body，见 server/tests/test_auth.py
curl -s -X POST $BASE/api/v1/auth/change-password \
  -H "Authorization: Bearer $TOKEN" -H "X-Safebox-Encrypted: 1" \
  -H "Content-Type: application/json" \
  -d "{\"target\":\"email\",\"value\":\"$EMAIL\",\"verification_code\":\"123456\",\"new_srp_verifier\":\"$NEW_VERIFIER\",\"new_srp_salt\":\"$NEW_SRP_SALT\",\"new_local_salt\":\"new_salt_b64\",\"new_encrypted_user_key\":\"fake-euk-new\"}"
# 200 {"success":true,"access_token":"...","refresh_token":"..."}
# 副作用：revoke_all_user_tokens + 清其他 device session_key（当前保留）+ 异步通知邮件
```

## TC-12 refresh token
```bash
REFRESH="<从登录获取>"
curl -s -X POST $BASE/api/v1/auth/refresh-token \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH\"}"
# 200 {"access_token":"...","refresh_token":"..."}
# 重放旧 refresh -> 全线失效（TokenFamily + FOR UPDATE）；refresh 续 K_comm TTL
```

## TC-13 登出
```bash
# POST /auth/logout body 需 K 加密（X-Safebox-Encrypted:1），curl 单独无法完成
curl -s -X POST $BASE/api/v1/auth/logout \
  -H "Authorization: Bearer $TOKEN" -H "X-Safebox-Encrypted: 1" \
  -H "Content-Type: application/json" -d "<K 加密的 {}>"
# 204（撤销所有 token family + 清所有 device session_key；client 清 cached_K/mnemonic_encrypted/session_K，决策 A）
```

## TC-15 注销账号
```bash
TOKEN="<前置 SRP 登录获取的 fresh token>"
# DELETE /auth/account body 需 K 加密
curl -s -X DELETE $BASE/api/v1/auth/account \
  -H "Authorization: Bearer $TOKEN" -H "X-Safebox-Encrypted: 1" \
  -H "Content-Type: application/json" -d "<K 加密的 {verification_code}>"
# 204（fresh token + 验证码；FK 级联删全数据，不可恢复）
```

**已删除端点**：`/auth/login/email`、`/auth/login/phone`、`/auth/recovery/initiate`、`/auth/recovery/*`、`/auth/register-device`（冗余）。

---

## Phase 2：device + K 通信

### device 绑定（SRP challenge）
- SRP challenge 传 `device_id`（同设备，from IndexedDB）或 `device_name`（新设备，建 UserDevice）
- verify 响应含 `device_id`（token 绑定）
- challenge/verify 从 `User-Agent` + `X-Real-IP` 解析填充 device 的 `client_name`/`os_name`/`last_auth_ip`

### 设备管理
```bash
TOKEN="<登录 token>"
# 响应是 K 加密密文（X-Safebox-Encrypted:1），curl 看不到明文，需 K 解密
curl -s "$BASE/api/v1/auth/devices" -H "Authorization: Bearer $TOKEN"
# 200（密文）解密后: [{id, device_name, device_wrapped, client_name, os_name, last_auth_ip, last_active_at, created_at, is_revoked, is_current}]

curl -s -X DELETE "$BASE/api/v1/auth/devices/<device_id>" -H "Authorization: Bearer $TOKEN" -H "X-Safebox-Encrypted: 1"
# 204（该设备 access 立即失效 + 删该 device TokenFamily + Redis device:revoked，下次请求 401 device_revoked）
```

### SRP K 通信加密（对标 1Password SRP+GCM）
- K_comm = SRP 握手 H(S)，**session 级**（login 到 logout，TTL 30 天 = refresh 同期，refresh 续）
- 认证 POST body + 响应用 K_comm AES-256-GCM 加密，header `X-Safebox-Encrypted: 1`
- K 不存（session 过期/Redis 故障）-> **401 `session expired`**（强制重 SRP login，防 downgrade）
- curl 单独无法完成（需算 K + AES-GCM），用 Python httpx + `tests/_srp.py` 模拟，见 `server/tests/test_auth.py`

### Phase 2 测试用例（需 Python + K，curl 无法直接验）

| 用例 | 测 | 预期 |
|------|------|------|
| TC-P2-01 | register 响应 | 含 `device_id` |
| TC-P2-02 | SRP challenge 传 `device_id`（同设备） | verify 响应 device_id 一致 + devices[] is_current:true |
| TC-P2-03 | SRP challenge 传 `device_name`（新设备） | verify 响应新 device_id + devices[] 多一条 |
| TC-P2-04 | deauthorize 后该 device access 调 /sync/pull | 401 `device_revoked` |
| TC-P2-05 | 对已 revoked device 再 DELETE | 204（幂等） |
| TC-P2-06 | DELETE 他人 device_id | 404 `device_not_found` |
| TC-P2-07 | challenge 传已 revoked 的 device_id | 401 `device_revoked` |
| TC-P2-08 | 登录后 POST /auth/change-password 缺 `X-Safebox-Encrypted` header | **400** `encrypted body required`（非 401） |
| TC-P2-09 | 带 `X-Safebox-Encrypted:1` 但 body 非合法 AES-GCM | 400 `decrypt failed` |
| TC-P2-10 | GET /auth/devices 响应 | `Content-Type: application/octet-stream` + `X-Safebox-Encrypted:1`，body 密文（需 K 解） |
| TC-P2-11 | POST /auth/logout 缺 `X-Safebox-Encrypted` | 400（POST 属强制加密，即便 body={}） |
| TC-P2-12 | K 不存（删 Redis session_key）后认证 | 401 `session expired` |
| TC-P2-13 | 设备信息填充 | challenge/verify 后 device 有 client_name/os_name/last_auth_ip（从 User-Agent + IP） |

---

# 二、同步

## TC-22 sync push
```bash
# POST /sync/push body 需 K 加密
curl -s -X POST $BASE/api/v1/sync/push \
  -H "Authorization: Bearer $TOKEN" -H "X-Safebox-Encrypted: 1" \
  -H "Content-Type: application/json" -d "<K 加密的 items>"
# 200 {"results":[{"client_did":1,"server_id":"...","status":"created","version":1}]}
# status: created | updated | conflict（version 基线不等则 conflict）
```

## TC-23 sync pull（keyset 分页）
```bash
curl -s "$BASE/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00&limit=100" \
  -H "Authorization: Bearer $TOKEN"
# 200（密文）解密后: {"items":[...],"server_time":"...","server_id":"最后条 id 或 null","has_more":true}
# 翻页：用上一页 server_time + server_id 作复合游标，防同 updated_at 跨页丢失
```

## TC-24 sync delete
```bash
# POST /sync/delete body 需 K 加密
curl -s -X POST $BASE/api/v1/sync/delete \
  -H "Authorization: Bearer $TOKEN" -H "X-Safebox-Encrypted: 1" \
  -H "Content-Type: application/json" -d "<K 加密的 {server_ids:[...]}>"
# 200 {"results":[{"server_id":"...","status":"deleted|not_found"}]}
```

---

# 三、错误场景

## TC-25 重复注册 409
```bash
curl -s -X POST $BASE/api/v1/auth/register/email -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"verification_code\":\"123456\",...}"
# 409 email_already_registered
```

## TC-26 未认证访问 403
```bash
curl -s "$BASE/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00"
# 403（HTTPBearer 无 token 默认 403）；无效 token -> 401 invalid_token（JWT type="access" 校验）
# K 不存（有 token 但 session_key 过期）-> 401 session expired
```

## TC-27 登录限流 429
```bash
# SRP challenge 失败也累积计数。连续 5 次错密码 SRP verify 失败 -> 锁 1h
# （用 TC-07 脚本循环错密码，第 5 次起 429 login_rate_limited(seconds=3600)）
# 退避序列：0,0,1,2,4 秒 -> 第 5 次锁 1h
```
