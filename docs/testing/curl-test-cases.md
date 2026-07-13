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
# 200 {"login_salt":"...","kdf_settings":{"algorithm":"pbkdf2","iterations":600000},"recovery_salt":"...","has_master_password":false}
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
    \"auth_key_hash\":\"$AUTH_HASH\",
    \"login_salt\":\"$LOGIN_SALT\",
    \"encrypted_user_key\":\"fake-euk\",
    \"recovery_salt\":\"$RECOVERY_SALT\",
    \"has_master_password\":false,
    \"recovery_code\":\"$RECOVERY_CODE\",
    \"recovery_code_salt\":\"$RECOVERY_CODE_SALT\",
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
    \"auth_key_hash\":\"$AUTH_HASH\",
    \"login_salt\":\"$LOGIN_SALT\",
    \"encrypted_user_key\":\"fake-euk\",
    \"recovery_salt\":\"$RECOVERY_SALT\",
    \"has_master_password\":false,
    \"recovery_code\":\"$RECOVERY_CODE\",
    \"recovery_code_salt\":\"$RECOVERY_CODE_SALT\",
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
    \"auth_key_hash\":\"$AUTH_HASH\",
    \"login_salt\":\"$LOGIN_SALT\",
    \"encrypted_user_key\":\"fake-euk\",
    \"recovery_salt\":\"$RECOVERY_SALT\",
    \"has_master_password\":false,
    \"recovery_code\":\"$RECOVERY_CODE\",
    \"recovery_code_salt\":\"$RECOVERY_CODE_SALT\",
    \"device_name\":\"Web\",\"device_public_key\":\"web\",\"device_wrapped\":\"web\"
  }"
# 201 {"user_id":"...","access_token":"...","refresh_token":"..."}
# 不验验证码（Google ID Token 验身份）
```

## TC-07 邮箱登录

```bash
curl -s -X POST $BASE/api/v1/auth/login/email \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"auth_key_hash\":\"$AUTH_HASH\"}"
# 200 {"user_id":"...","access_token":"...","refresh_token":"...","login_salt":"...","encrypted_user_key":"...","recovery_salt":"...","has_master_password":false,"devices":[...]}
# 限流：第 1 次不限制；2-4 次 1/2/4 秒退避；第 5 次起 429 login_rate_limited(seconds=N) + 锁 1h
# 恢复冷却期 -> 403 account_in_cooldown
```

## TC-08 手机号登录

```bash
curl -s -X POST $BASE/api/v1/auth/login/phone \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\",\"verification_code\":\"123456\",\"auth_key_hash\":\"$AUTH_HASH\"}"
# 200 响应同 login/email
```

## TC-09 Google 登录

```bash
curl -s -X POST $BASE/api/v1/auth/login/google \
  -H "Content-Type: application/json" \
  -d "{\"google_id_token\":\"$GOOGLE_ID_TOKEN\"}"
# 200 响应同 login/email（凭 Google ID Token 登录，不校验 auth_key_hash）
# 冷却期内 403 account_in_cooldown（与 email/phone 登录一致，零窗口）
```

## TC-10 密码校验（每次解锁）

```bash
TOKEN="<从 TC-07 获取>"
curl -s -X POST $BASE/api/v1/auth/verify \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"auth_key_hash\":\"$AUTH_HASH\",\"password_version\":0}"
# 200 {"password_version":0,"status":"ok"}
# 密码错 -> 401；别处改密 version 不符 -> 409 password_changed_elsewhere
# 冷却期仍 200（纯认证校验，不下发数据）
```

## TC-11 改密

```bash
curl -s -X POST $BASE/api/v1/auth/change-password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"target\":\"email\",\"value\":\"$EMAIL\",\"verification_code\":\"123456\",
    \"current_auth_key_hash\":\"$AUTH_HASH\",
    \"new_auth_key_hash\":\"new_hash\",
    \"new_login_salt\":\"new_salt\"
  }"
# 200 {"success":true,"access_token":"...","refresh_token":"..."}
# target/value 字段保留兼容但服务端忽略，验证码必须发到用户注册邮箱/手机
# password_version+1 + 单 commit 原子吊销所有 token
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
# 串行化模型下 device_public_key/device_wrapped 为占位值，跨设备用恢复码
```

## TC-15 注销账号

```bash
curl -s -X DELETE $BASE/api/v1/auth/account \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"verification_code\":\"123456\",
    \"current_auth_key_hash\":\"$AUTH_HASH\"
  }"
# 204（需当前密码 + 验证码；验证码绑定用户注册联系方式；FK 级联删全数据，不可恢复）
```

---

# 二、恢复码

## TC-16 恢复 initiate（步骤1）

```bash
curl -s -X POST $BASE/api/v1/auth/recovery/initiate \
  -H "Content-Type: application/json" \
  -d "{
    \"target\":\"email\",\"value\":\"$EMAIL\",
    \"recovery_code\":\"$RECOVERY_CODE\",
    \"new_auth_key_hash\":\"new_hash\",
    \"new_login_salt\":\"new_salt\"
  }"
# 200 {"encrypted_user_key":"...","recovery_salt":"...","initiate_token":"..."}
# 15min 有效；不改正式字段、不进冷却
# 恢复码错 / 用户不存在 -> 均返回 401 recovery_code_invalid（防枚举，不返回 404）
# 已有未过期 pending_initiate -> 409 recovery_already_pending
```

## TC-17 恢复 confirm（步骤2）

```bash
INIT_TOKEN="<从 TC-16 获取>"
curl -s -X POST $BASE/api/v1/auth/recovery/confirm \
  -H "Content-Type: application/json" \
  -d "{\"initiate_token\":\"$INIT_TOKEN\"}"
# 200 {"cooldown_until":"<ISO8601, now+24h>"}
# 写正式新密码 + 存 rollback + status=cooldown + revoke 所有 token + 发告警（含 accelerate/freeze 签名链接）
```

## TC-18 恢复 status

```bash
curl -s $BASE/api/v1/auth/recovery/status \
  -H "Authorization: Bearer $TOKEN"
# 200 {"status":"active|cooldown","cooldown_until":"ISO8601|null"}
```

## TC-19 恢复 accelerate（验证码 + 签名 token 解除冷却）

```bash
# signed_token 从 TC-17 confirm 的告警邮件获取（含 cd 绑定本次冷却实例，24h 有效，一次性）
SIGNED_TOKEN="<从告警邮件 accelerate 链接获取>"
curl -s -X POST $BASE/api/v1/auth/recovery/accelerate \
  -H "Content-Type: application/json" \
  -d "{\"signed_token\":\"$SIGNED_TOKEN\",\"verification_code\":\"123456\"}"
# 204（验证码发到用户注册联系方式；手机用户走 SMS；status=active，清 rollback）
# cd 与当前冷却实例不符 -> 400 recovery_token_invalid（防跨冷却周期重放）
```

> dev 模式无邮件，可手动签发（密钥为 `SAFEBOX_RECOVERY_SIGNING_KEY`，留空回退 `jwt_secret_key`）：
> ```python
> import jwt
> tok = jwt.encode({"sub":"<user_id>","action":"accelerate","rc_id":"<rc_id>","cd":"<cooldown_until iso>"}, RECOVERY_SIGNING_KEY or JWT_SECRET, algorithm="HS256")
> ```

## TC-20 恢复 freeze（签名 token 回滚旧密码）

```bash
SIGNED_TOKEN="<从告警邮件 freeze 链接获取>"
curl -s -X POST $BASE/api/v1/auth/recovery/freeze \
  -H "Content-Type: application/json" \
  -d "{\"signed_token\":\"$SIGNED_TOKEN\"}"
# 204（无需验证码；回滚 authKey+login_salt+password_version = rollback_*；status=active）
```

## TC-21 恢复 revoke（主动作废恢复码）

```bash
curl -s -X POST $BASE/api/v1/auth/recovery/revoke \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"target\":\"email\",\"value\":\"$EMAIL\",\"verification_code\":\"123456\",
    \"current_auth_key_hash\":\"$AUTH_HASH\"
  }"
# 204（清空 recovery_code_hash/salt，恢复码真正作废无法再 initiate；用户失去恢复能力）
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
    -d "{\"email\":\"$EMAIL\",\"auth_key_hash\":\"wrong\"}"
done
# 401 401 401 401 429（第 5 次起 429 login_rate_limited(seconds=3600)）
```

## TC-28 冷却期访问 403

```bash
# TC-17 confirm 后账户进 24h 冷却期
curl -s -X GET "$BASE/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00" \
  -H "Authorization: Bearer $TOKEN"
# 403 account_in_cooldown（require_not_in_cooldown 挡所有数据访问端点，零窗口）
# /verify 仍 200（纯认证）；accelerate/freeze/status 豁免
```
