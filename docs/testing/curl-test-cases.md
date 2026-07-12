# SafeBox curl 测试用例

## 环境变量

```bash
BASE=http://127.0.0.1:8000          # 本地；服务器改 https://safebox.snailtrail.org
EMAIL=test$RANDOM@safebox.dev
AUTH_HASH="test_auth_hash_$(date +%s)"
LOGIN_SALT="aabbccdd11223344"
RECOVERY_SALT="eeff001122334455"
RECOVERY_CODE="abandon ability able about above absent absorb abstract accuse achieve acid acoustic"
RECOVERY_CODE_SALT="aabbccdd11223344eeff0011223344556677889900112233445566778899001122"
```

## 验证码（dev 模式）

SMTP 未配置时验证码存 Redis：

```bash
redis-cli SET "vc:email:$EMAIL" "123456" EX 300
```

---

## TC-01 健康检查

```bash
curl -s $BASE/health
# {"status":"ok"}
```

---

## TC-02 获取 salt

```bash
curl -s "$BASE/api/v1/auth/salt?email=$EMAIL"
# {"login_salt":"...","kdf_settings":{...},"recovery_salt":"...","has_master_password":false}
```

---

## TC-03 邮箱注册

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

---

## TC-04 邮箱登录

```bash
curl -s -X POST $BASE/api/v1/auth/login/email \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"auth_key_hash\":\"$AUTH_HASH\"}"
# 200 {"access_token":"...","refresh_token":"...","login_salt":"...","encrypted_user_key":"...","recovery_salt":"...","has_master_password":false}
```

---

## TC-05 重复注册 409

```bash
curl -s -X POST $BASE/api/v1/auth/register/email \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"verification_code\":\"123456\",...}"
# 409
```

---

## TC-06 密码校验

```bash
TOKEN="<从 TC-04 获取>"
curl -s -X POST $BASE/api/v1/auth/verify \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"auth_key_hash\":\"$AUTH_HASH\",\"password_version\":0}"
# 200 {"password_version":0,"status":"ok"}
```

---

## TC-07 改密

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
```

---

## TC-08 refresh token

```bash
REFRESH="<从 TC-04 获取>"
curl -s -X POST $BASE/api/v1/auth/refresh-token \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH\"}"
# 200 {"access_token":"...","refresh_token":"..."}
```

---

## TC-09 恢复 initiate（步骤1）

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
```

---

## TC-10 恢复 confirm（步骤2）

```bash
INIT_TOKEN="<从 TC-09 获取>"
curl -s -X POST $BASE/api/v1/auth/recovery/confirm \
  -H "Content-Type: application/json" \
  -d "{\"initiate_token\":\"$INIT_TOKEN\"}"
# 200 {"cooldown_until":"..."}
```

---

## TC-11 恢复 status

```bash
curl -s $BASE/api/v1/auth/recovery/status \
  -H "Authorization: Bearer $TOKEN"
# 200 {"status":"cooldown","cooldown_until":"...","failed_attempt_count":0}
```

---

## TC-12 sync push

```bash
curl -s -X POST $BASE/api/v1/sync/push \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"client_did":1,"type":"login","name":"mock","version":1,"updated_at":"2025-01-01T00:00:00+00:00"}]}'
# 200 {"results":[{"client_did":1,"server_id":"...","status":"created","version":1}]}
```

---

## TC-13 sync pull

```bash
curl -s "$BASE/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00&limit=100" \
  -H "Authorization: Bearer $TOKEN"
# 200 {"items":[...],"server_time":"...","has_more":false}
```

---

## TC-14 sync delete

```bash
SID="<从 TC-12 获取>"
curl -s -X POST $BASE/api/v1/sync/delete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"server_ids\":[\"$SID\"]}"
# 200 {"results":[{"server_id":"...","status":"deleted"}]}
```

---

## TC-15 登出

```bash
curl -s -X POST $BASE/api/v1/auth/logout \
  -H "Authorization: Bearer $TOKEN"
# 204
```

---

## TC-16 未认证访问 403

```bash
curl -s "$BASE/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00"
# 403
```
