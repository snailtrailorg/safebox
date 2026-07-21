# SafeBox curl 测试用例

覆盖 `docs/FEATURE_LIST.md` 全部端点。所有路径前缀 `/api/v1`，除标注外需 `Authorization: Bearer <access_token>`。

> SRP-6a 登录需客户端算 A/M1（BigInt + SHA-256），curl 单独无法完成。下文用 `server/` venv Python 算 SRP 值 + curl 发请求。完整 SRP 流程测试见 `server/tests/test_auth.py`。

## 环境变量

```bash
BASE=http://127.0.0.1:8000          # 本地；服务器改 https://safebox.snailtrail.org
EMAIL=test$RANDOM@safebox.dev
PHONE="+8613800138000"               # 手机号注册用（需 Twilio 或 dev 手动存码）
PASSWORD="MasterPass123!"
MNEMONIC="abandon ability able about above absent absorb abstract accuse achieve acid acoustic"
SRP_SALT="00112233445566778899aabbccddeeff"   # 16 字节 hex，客户端生成
LOCAL_SALT="aabbccdd11223344..."               # base64(32 字节)
MNEMONIC_SALT="eeff001122334455..."            # base64(32 字节)
# GOOGLE_ID_TOKEN="<真实 Google ID Token>"  # Google 注册/登录需，dev 通常跳过

# SRP verifier 由客户端派生（Python 示例，email 参与 deriveX 故每邮箱不同）：
# cd server && PYTHONPATH=. venv/bin/python -c "
# from app.services import srp_service as srp
# x=srp.derive_x('$PASSWORD','$MNEMONIC',bytes.fromhex('$SRP_SALT'),'$EMAIL')
# print(hex(srp.compute_verifier(x))[2:])"
```

## 验证码（dev 模式）

SMTP/Twilio 未配置时验证码存 Redis（`vc:{target}:{value}`），dev 模式服务端打印到终端：

```bash
redis-cli SET "vc:email:$EMAIL" "123456" EX 300
redis-cli SET "vc:phone:$PHONE" "123456" EX 300   # 手机号用
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
# 不存在的用户返回确定性伪造 salt（base64(HMAC-SHA256(jwt_secret, target))），SRP verify 必失败，不可区分
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
# 先算 SRP verifier（email 参与）
VERIFIER=$(cd server && PYTHONPATH=. venv/bin/python -c "
from app.services import srp_service as srp
x=srp.derive_x('$PASSWORD','$MNEMONIC',bytes.fromhex('$SRP_SALT'),'$EMAIL')
print(hex(srp.compute_verifier(x))[2:])")

curl -s -X POST $BASE/api/v1/auth/register/email \
  -H "Content-Type: application/json" \
  -d "{
    \"email\":\"$EMAIL\",
    \"verification_code\":\"123456\",
    \"srp_verifier\":\"$VERIFIER\",
    \"srp_salt\":\"$SRP_SALT\",
    \"local_salt\":\"$LOCAL_SALT\",
    \"encrypted_user_key\":\"fake-euk\",
    \"mnemonic_salt\":\"$MNEMONIC_SALT\",
    \"kdf_settings\":{\"algorithm\":\"pbkdf2\",\"iterations\":600000},
    \"device_name\":\"Web\",\"device_public_key\":\"web\",\"device_wrapped\":\"web\"
  }"
# 201 {"user_id":"...","access_token":"...","refresh_token":"..."}
# 助记词不上传（客户端本地持有 + 加密缓存）
```

## TC-05 手机号注册

同 TC-04，`email` 换 `phone`，verifier 的 identifier 用 phone（`deriveX(主密码, 助记词, srp_salt, phone)`）。

## TC-06 Google 注册

```bash
VERIFIER=$(... deriveX 用 identifier="google" ...)
curl -s -X POST $BASE/api/v1/auth/register/google \
  -H "Content-Type: application/json" \
  -d "{
    \"google_id_token\":\"$GOOGLE_ID_TOKEN\",
    \"srp_verifier\":\"$VERIFIER\",
    \"srp_salt\":\"$SRP_SALT\",
    \"local_salt\":\"$LOCAL_SALT\",
    \"encrypted_user_key\":\"fake-euk\",
    \"mnemonic_salt\":\"$MNEMONIC_SALT\",
    \"kdf_settings\":{\"algorithm\":\"pbkdf2\",\"iterations\":600000},
    \"device_name\":\"Web\",\"device_public_key\":\"web\",\"device_wrapped\":\"web\"
  }"
# 201（不验验证码；Google 用户也存 verifier 供改密/删号 SRP 验旧密码）
```

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
            'target_type':'email','target':EMAIL,'A':hex(A)[2:]})).json()
        B = int(chal['B'],16)
        x = srp.derive_x(PASSWORD, MNEMONIC, bytes.fromhex(salt['srp_salt']), EMAIL)
        u = srp.compute_u(A, B); S = srp.compute_client_S(B, a, u, x)
        K = srp.compute_K(S); M1 = srp.compute_M1(A, B, K)
        resp = (await c.post('/api/v1/auth/login/srp/verify', json={
            'session_id':chal['session_id'],'M1':M1.hex()})).json()
        assert srp.verify_M2(A, M1, K, resp['M2']), 'M2 验证失败'
        print(resp['access_token'])
asyncio.run(main())
"
# 输出 access_token；错密码/错助记词/用户不存在 -> 401（统一错误防枚举）
```

## TC-08 Google 登录

```bash
curl -s -X POST $BASE/api/v1/auth/login/google \
  -H "Content-Type: application/json" \
  -d "{\"google_id_token\":\"$GOOGLE_ID_TOKEN\"}"
# 200 响应同 SRP verify（无 M2，Google 不走 SRP）
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

curl -s -X POST $BASE/api/v1/auth/change-password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"target\":\"email\",\"value\":\"$EMAIL\",\"verification_code\":\"123456\",
    \"new_srp_verifier\":\"$NEW_VERIFIER\",
    \"new_srp_salt\":\"$NEW_SRP_SALT\",
    \"new_local_salt\":\"new_salt_b64\",
    \"new_encrypted_user_key\":\"fake-euk-new\"
  }"
# 200 {"success":true,"access_token":"...","refresh_token":"..."}
# 验证码必须发到用户注册邮箱/手机；主密码参与 K 派生，K 变 -> 重包裹 + 吊销所有旧 token
```

## TC-12 refresh token

```bash
REFRESH="<从登录获取>"
curl -s -X POST $BASE/api/v1/auth/refresh-token \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH\"}"
# 200 {"access_token":"...","refresh_token":"..."}
# 重放旧 refresh -> 全线失效（TokenFamily + FOR UPDATE）
```

## TC-13 登出

```bash
curl -s -X POST $BASE/api/v1/auth/logout \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{}"
# 204（撤销该用户所有 token family；本地 cached_K/mnemonic_encrypted 保留）
```

## TC-14 设备注册

```bash
curl -s -X POST $BASE/api/v1/auth/register-device \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"device_name\":\"Web\",\"device_public_key\":\"web\",\"device_wrapped\":\"web\"}"
# 200 {"device_id":"..."}
# device_public_key/device_wrapped 为占位值
```

## TC-15 注销账号

```bash
TOKEN="<前置 SRP 登录获取的 fresh token>"
curl -s -X DELETE $BASE/api/v1/auth/account \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"verification_code\":\"123456\"}"
# 204（fresh token + 验证码；验证码绑定用户注册联系方式；FK 级联删全数据，不可恢复）
```

---

# 二、同步

## TC-22 sync push

```bash
curl -s -X POST $BASE/api/v1/sync/push \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"client_did":1,"type":"login","name":"{\"encrypted_key\":\"...\",\"ciphertext\":\"...\"}","version":1,"updated_at":"2025-01-01T00:00:00+00:00"}]}'
# 200 {"results":[{"client_did":1,"server_id":"...","status":"created","version":1}]}
# status: created | updated | conflict（version 基线不等则 conflict，返回服务端当前 version）
```

## TC-23 sync pull（keyset 分页）

```bash
# 首页：since=起始时间，无 since_id
curl -s "$BASE/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00&limit=100" \
  -H "Authorization: Bearer $TOKEN"
# 200 {"items":[...],"server_time":"<最后条 updated_at>","server_id":"<最后条 id 或 null>","has_more":true}

# 翻页：用上一页的 server_time + server_id 作复合游标，防同 updated_at 跨页丢失
SERVER_TIME="<从上页获取>"
SERVER_ID="<从上页获取>"
curl -s "$BASE/api/v1/sync/pull?since=$SERVER_TIME&since_id=$SERVER_ID&limit=100" \
  -H "Authorization: Bearer $TOKEN"
```

## TC-24 sync delete

```bash
SID="<从 TC-22 获取>"
curl -s -X POST $BASE/api/v1/sync/delete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"server_ids\":[\"$SID\"]}"
# 200 {"results":[{"server_id":"...","status":"deleted|not_found"}]}
```

---

# 三、错误场景

## TC-25 重复注册 409

```bash
curl -s -X POST $BASE/api/v1/auth/register/email \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"verification_code\":\"123456\",...}"
# 409 email_already_registered
```

## TC-26 未认证访问 403

```bash
curl -s "$BASE/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00"
# 403（HTTPBearer 无 token 默认 403）；无效 token -> 401 invalid_token（JWT type="access" 校验）
```

## TC-27 登录限流 429

```bash
# SRP challenge 失败也累积计数。连续 5 次错密码 SRP verify 失败 -> 锁 1h
# （用 TC-07 脚本循环错密码，第 5 次起 429 login_rate_limited(seconds=3600)）
# 退避序列：0,0,1,2,4 秒 -> 第 5 次锁 1h
```
