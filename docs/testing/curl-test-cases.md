# SafeBox curl 测试用例

> 基于 API_CONTRACT.md 的 25 个端点，覆盖核心流程、错误处理、认证边界。
> 加密参数（auth_key_hash/password_wrapped 等）用 mock 值，服务端不验证加密正确性，只验证流程。

## 环境变量

```bash
BASE=http://127.0.0.1:8000          # 本地；服务器改 https://safebox.snailtrail.org
EMAIL=test$RANDOM@safebox.dev        # 随机邮箱避免冲突
PHONE=+8613800000000
AUTH_HASH="test_auth_hash_$(date +%s)"  # 注册和登录用同一个值
SALT="aabbccdd11223344"
MOCK='{"encrypted_key":"mock","ciphertext":"mock"}'
```

## 获取验证码（dev 模式）

SMTP/Twilio 未配置时，验证码存 Redis。注册/登录前从 Redis 取：

```bash
# 实际 key 格式是 vc:{target}:{value}（不是 verification:）
redis-cli GET "vc:email:$EMAIL"
redis-cli GET "vc:phone:$PHONE"

# 绕过 60s 限流直接注入验证码（测试用）：
redis-cli SET "vc:email:$EMAIL" "123456" EX 300
```

---

## 一、健康检查与基础

### TC-01 健康检查
```bash
curl -s $BASE/health
```
**预期**：`{"status":"ok"}`

### TC-02 salt - 用户不存在（返回随机 salt + 默认 600K）
```bash
curl -s "$BASE/api/v1/auth/salt?email=nonexistent@safebox.dev"
```
**预期**：`password_salt` 32 字符 hex，`kdf_settings.iterations` = 600000

### TC-03 salt - 参数缺失
```bash
curl -s "$BASE/api/v1/auth/salt"
```
**预期**：200，返回随机 salt + 600K fallback（防止用户枚举，不报错）

---

## 二、注册流程

### TC-04 发送验证码（邮箱）
```bash
curl -s -X POST $BASE/api/v1/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"target":"email","value":"'$EMAIL'"}'
```
**预期**：`{"expires_in":300}`

### TC-05 注册 - 邮箱
```bash
CODE=$(redis-cli GET "verification:email:$EMAIL")
curl -s -X POST $BASE/api/v1/auth/register/email \
  -H "Content-Type: application/json" \
  -d '{
    "email":"'$EMAIL'",
    "verification_code":"'$CODE'",
    "auth_key_hash":"'$AUTH_HASH'",
    "password_salt":"'$SALT'",
    "password_wrapped":"mock_wrapped",
    "recovery_wrapped":"",
    "encrypted_private":"mock_priv",
    "rsa_public_key":"mock_rsa_pub",
    "kdf_settings":{"algorithm":"pbkdf2","iterations":600000}
  }'
```
**预期**：201，返回 `access_token` + `refresh_token`。保存 token：
```bash
TOKEN=$(curl -s ... | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
```

### TC-06 注册 - 重复邮箱
```bash
# 用同一邮箱再注册
curl -s -X POST .../register/email -d '{...同上...}'
```
**预期**：409 `email_already_registered`

### TC-07 注册 - 错误验证码
```bash
curl -s -X POST .../register/email -d '{"verification_code":"000000",...}'
```
**预期**：400 `verification_code_invalid`

---

## 三、登录流程

### TC-08 登录 - 邮箱（正确密码）
```bash
curl -s -X POST $BASE/api/v1/auth/login/email \
  -H "Content-Type: application/json" \
  -d '{"email":"'$EMAIL'","auth_key_hash":"'$AUTH_HASH'"}'
```
**预期**：200，返回 `access_token` + `refresh_token` + 密钥材料

### TC-09 登录 - 错误密码
```bash
curl -s -X POST .../login/email -d '{"email":"'$EMAIL'","auth_key_hash":"wrong_hash"}'
```
**预期**：401 `email_or_password_wrong`

### TC-10 登录 - 不存在的用户
```bash
curl -s -X POST .../login/email -d '{"email":"nobody@safebox.dev","auth_key_hash":"x"}'
```
**预期**：401（不泄露用户是否存在）

---

## 四、Token 管理

### TC-11 刷新 token
```bash
curl -s -X POST $BASE/api/v1/auth/refresh-token \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"'$REFRESH'"}'
```
**预期**：200，返回新 access_token + refresh_token

### TC-12 登出
```bash
curl -s -X POST $BASE/api/v1/auth/logout -H "Authorization: Bearer $TOKEN"
```
**预期**：204。登出后旧 refresh_token 失效

### TC-13 无 token 访问受保护端点
```bash
curl -s "$BASE/api/v1/sync/pull?since=2020-01-01T00:00:00Z"
```
**预期**：403（FastAPI HTTPBearer 无 Authorization 头）

### TC-14 无效 token
```bash
curl -s "$BASE/api/v1/sync/pull?since=..." -H "Authorization: Bearer invalid.token.here"
```
**预期**：401

---

## 五、同步

### TC-15 push - 创建条目
```bash
# name/data 是字符串化的 EncryptedField JSON（后端 schema 是 string）
FIELD='{"encrypted_key":"k1","ciphertext":"c1"}'
curl -s -X POST $BASE/api/v1/sync/push \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"client_did":1,"type":"login","icon":null,
    "name":"'"$FIELD"'","description":null,"data":"'"$FIELD"'",
    "version":1,"updated_at":"2026-07-09T00:00:00+00:00"}]}'
```
**预期**：200，`results[0].status` = "created"，返回 `server_id`

### TC-16 pull - 拉取更新
```bash
# since 的 + 要用 -G --data-urlencode 编码，否则 + 被当空格
curl -s -G "$BASE/api/v1/sync/pull" --data-urlencode "since=2020-01-01T00:00:00+00:00" \
  -H "Authorization: Bearer $TOKEN"
```
**预期**：200，`items` 含 TC-15 创建的条目

### TC-17 push - 冲突（旧时间戳）
```bash
# 用更早的 updated_at 再 push 同一 client_did
curl -s -X POST .../sync/push -d '{"items":[{"client_did":1,...,"updated_at":"2020-01-01T00:00:00Z"}]}'
```
**预期**：`results[0].status` = "conflict"

### TC-18 delete - 软删除
```bash
curl -s -X POST $BASE/api/v1/sync/delete \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"server_ids":["'$SERVER_ID'"]}'
```
**预期**：200，`results[0].status` = "deleted"

---

## 六、恢复码

### TC-19 生成恢复码（需登录）
```bash
# 先发验证码
curl -s -X POST $BASE/api/v1/auth/send-code -d '{"target":"email","value":"'$EMAIL'"}'
CODE=$(redis-cli GET "verification:email:$EMAIL")

curl -s -X POST $BASE/api/v1/auth/recovery/generate \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"verification_code":"'$CODE'","current_auth_key_hash":"'$AUTH_HASH'"}'
```
**预期**：200，返回 12 词 BIP39 恢复码

### TC-20 查询恢复码状态
```bash
curl -s "$BASE/api/v1/auth/recovery/status" -H "Authorization: Bearer $TOKEN"
```
**预期**：`status` = "active"

### TC-21 发起恢复（进入冷却期）
```bash
curl -s -X POST $BASE/api/v1/auth/recovery/initiate \
  -d '{
    "target":"email","value":"'$EMAIL'",
    "recovery_code":"'$RECOVERY_CODE'",
    "new_auth_key_hash":"new_hash",
    "new_password_salt":"new_salt",
    "new_kdf_settings":{"algorithm":"pbkdf2","iterations":600000},
    "new_wrapped_user_key":"new_wrapped"
  }'
```
**预期**：200，返回 `cooldown_expires_at`（24h 后）

> 注意：`freeze_token` 不在响应中返回，只通过告警邮件发送。dev 模式邮件未配置时无法测试 TC-22。

### TC-22 冻结恢复（回滚）
> **dev 模式跳过**：`freeze_token` 仅在恢复告警邮件中，未配置 SMTP 时拿不到。生产环境从邮件链接获取。

---

## 七、改密与注销

### TC-23 改密（需验证码）
```bash
curl -s -X POST $BASE/api/v1/auth/change-password \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "target":"email","value":"'$EMAIL'",
    "verification_code":"'$CODE'",
    "current_auth_key_hash":"'$AUTH_HASH'",
    "new_auth_key_hash":"new_hash",
    "new_password_salt":"new_salt",
    "new_kdf_settings":{"algorithm":"pbkdf2","iterations":600000},
    "new_password_wrapped":"new_wrapped"
  }'
```
**预期**：200，返回新 token

### TC-24 注销账号
```bash
curl -s -X DELETE $BASE/api/v1/auth/account \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"target":"email","value":"'$EMAIL'","verification_code":"'$CODE'"}'
```
**预期**：204

---

## 八、限流与错误

### TC-25 限流 - 频繁请求
```bash
# 连续请求超 100 次（严格端点）
for i in $(seq 1 110); do curl -s -o /dev/null -w "%{http_code}\n" .../login/email -d '{...}'; done
```
**预期**：前 100 次可能 401，后续 429

### TC-26 Pydantic 校验 - 邮箱格式
```bash
curl -s -X POST .../register/email -d '{"email":"not-an-email",...}'
```
**预期**：422

### TC-27 手机号格式校验
```bash
curl -s -X POST .../register/phone -d '{"phone":"123",...}'
```
**预期**：422

---

## 注意事项

1. **验证码**：dev 模式从 Redis 取 `verification:email:{email}`
2. **加密参数**：`auth_key_hash` 注册和登录必须用同一个值（服务端 bcrypt 验证）
3. **EncryptedField**：name/description/data 现在是 JSON 对象，push 时需 `JSON.stringify`
4. **TOKEN 变量**：从注册/登录响应提取，后续请求复用
5. **测试顺序**：TC-04→05→08→15 有依赖关系，需顺序执行
