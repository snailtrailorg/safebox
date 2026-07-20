# SafeBox curl 测试用例

覆盖 `docs/FEATURE_LIST.md` 全部端点。所有路径前缀 `/api/v1`，除标注外需 `Authorization: Bearer <access_token>`。

## 环境变量

```bash
BASE=http://127.0.0.1:8000          # 本地；服务器改 https://safebox.snailtrail.org
EMAIL=test$RANDOM@safebox.dev
PHONE="+8613800138000"               # 手机号注册用（需 Twilio 或 dev 手动存码）
AUTH_HASH="test_auth_hash_$(date +%s)"
LOGIN_SALT="aabbccdd11223344"
RECOVERY_SALT="eeff001122334455"
RECOVERY_CODE="abandon ability able about above absent absorb abstract accuse achieve acid acoustic"
RECOVERY_CODE_SALT="aabbccdd11223344eeff00112233445566778899001122334455667788990011"
# GOOGLE_ID_TOKEN="<真实 Google ID Token>"  # Google 注册/登录需，dev 通常跳过
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
# 200 {"local_salt":"...","kdf_settings":{"algorithm":"pbkdf2","iterations":600000},"mnemonic_salt":"..."}
# 不存在的用户返回确定性伪造 salt（base64(HMAC-SHA256(jwt_secret, target))），不可区分
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
curl -s -X POST $BASE/api/v1/auth/register/email \
  -H "Content-Type: application/json" \
  -d "{
    \"email\":\"$EMAIL\",
    \"verification_code\":\"123456\",
    \"local_password_hash\":\"$AUTH_HASH\",
    \"local_salt\":\"$LOGIN_SALT\",
    \"encrypted_user_key\":\"fake-euk\",
    \"mnemonic_salt\":\"$RECOVERY_SALT\",
    \"mnemonic\":\"$RECOVERY_CODE\",
    \"mnemonic_hmac_salt\":\"$RECOVERY_CODE_SALT\",
    \"device_name\":\"Web\",\"device_public_key\":\"web\",\"device_wrapped\":\"web\"
  }"
# 201 {"user_id":"...","access_token":"...","refresh_token":"..."}
```

## TC-05 手机号注册

```bash
curl -s -X POST $BASE/api/v1/auth/register/phone \
  -H "Content-Type: application/json" \
  -d "{
    \"phone\":\"$PHONE\",
    \"verification_code\":\"123456\",
    \"local_password_hash\":\"$AUTH_HASH\",
    \"local_salt\":\"$LOGIN_SALT\",
    \"encrypted_user_key\":\"fake-euk\",
    \"mnemonic_salt\":\"$RECOVERY_SALT\",
    \"mnemonic\":\"$RECOVERY_CODE\",
    \"mnemonic_hmac_salt\":\"$RECOVERY_CODE_SALT\",
    \"device_name\":\"Web\",\"device_public_key\":\"web\",\"device_wrapped\":\"web\"
  }"
# 201 {"user_id":"...","access_token":"...","refresh_token":"..."}
# 注册成功后清该手机号登录失败计数（与 email 一致）
```

## TC-06 Google 注册

```bash
curl -s -X POST $BASE/api/v1/auth/register/google \
  -H "Content-Type: application/json" \
  -d "{
    \"google_id_token\":\"$GOOGLE_ID_TOKEN\",
    \"local_password_hash\":\"$AUTH_HASH\",
    \"local_salt\":\"$LOGIN_SALT\",
    \"encrypted_user_key\":\"fake-euk\",
    \"mnemonic_salt\":\"$RECOVERY_SALT\",
    \"mnemonic\":\"$RECOVERY_CODE\",
    \"mnemonic_hmac_salt\":\"$RECOVERY_CODE_SALT\",
    \"device_name\":\"Web\",\"device_public_key\":\"web\",\"device_wrapped\":\"web\"
  }"
# 201 {"user_id":"...","access_token":"...","refresh_token":"..."}
# 不验验证码（Google ID Token 验身份）
```

## TC-07 邮箱登录

```bash
curl -s -X POST $BASE/api/v1/auth/login/email \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"local_password_hash\":\"$AUTH_HASH\"}"
# 200 {"user_id":"...","access_token":"...","refresh_token":"...","local_salt":"...","encrypted_user_key":"...","mnemonic_salt":"...","devices":[...]}
# 限流：第 1 次不限制；2-4 次 1/2/4 秒退避；第 5 次起 429 login_rate_limited(seconds=N) + 锁 1h
```

## TC-08 手机号登录

```bash
curl -s -X POST $BASE/api/v1/auth/login/phone \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\",\"verification_code\":\"123456\",\"local_password_hash\":\"$AUTH_HASH\"}"
# 200 响应同 login/email
```

## TC-09 Google 登录

```bash
curl -s -X POST $BASE/api/v1/auth/login/google \
  -H "Content-Type: application/json" \
  -d "{\"google_id_token\":\"$GOOGLE_ID_TOKEN\"}"
# 200 响应同 login/email（凭 Google ID Token 登录，不校验 local_password_hash）
```

## TC-11 改密

```bash
TOKEN="<从 TC-07 获取>"
curl -s -X POST $BASE/api/v1/auth/change-password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"target\":\"email\",\"value\":\"$EMAIL\",\"verification_code\":\"123456\",
    \"current_local_password_hash\":\"$AUTH_HASH\",
    \"new_local_password_hash\":\"new_hash\",
    \"new_local_salt\":\"new_salt\",
    \"new_encrypted_user_key\":\"fake-euk-new\"
  }"
# 200 {"success":true,"access_token":"...","refresh_token":"..."}
# target/value 字段保留兼容但服务端忽略，验证码必须发到用户注册邮箱/手机
# 主密码参与 K 派生，K 变 -> new_encrypted_user_key 重新包裹 + 单 commit 原子吊销所有 token
```

## TC-12 refresh token

```bash
REFRESH="<从 TC-07 获取>"
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
# 204（撤销该用户所有 token family；本地 cached_K 等密钥材料保留）
```

## TC-14 设备注册

```bash
curl -s -X POST $BASE/api/v1/auth/register-device \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"device_name\":\"Web\",\"device_public_key\":\"web\",\"device_wrapped\":\"web\"}"
# 200 {"device_id":"..."}
# 合并主密码模型下 device_public_key/device_wrapped 为占位值，跨设备用助记词
```

## TC-15 注销账号

```bash
curl -s -X DELETE $BASE/api/v1/auth/account \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"verification_code\":\"123456\",
    \"current_local_password_hash\":\"$AUTH_HASH\"
  }"
# 204（需当前密码 + 验证码；验证码绑定用户注册联系方式；FK 级联删全数据，不可恢复）
```

---

# 二、助记词

## TC-16 恢复 initiate（换设备）

```bash
curl -s -X POST $BASE/api/v1/auth/recovery/initiate \
  -H "Content-Type: application/json" \
  -d "{
    \"target\":\"email\",\"value\":\"$EMAIL\",
    \"mnemonic\":\"$RECOVERY_CODE\"
  }"
# 200 {"encrypted_user_key":"...","mnemonic_salt":"..."}
# 验助记词返回 encrypted_user_key + mnemonic_salt（换设备用；web 实际走 login + recoverAndRewrap，端点为死代码）
# 助记词错 / 用户不存在 -> 均返回 401 mnemonic_invalid（防枚举，不返回 404）
```

---

# 三、同步

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

# 四、错误场景

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
# 连续失败登录：第 2-4 次 1/2/4 秒退避，第 5 次起锁 1h
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/api/v1/auth/login/email \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"local_password_hash\":\"wrong\"}"
done
# 401 401 401 401 429（第 5 次起 429 login_rate_limited(seconds=3600)）
```
