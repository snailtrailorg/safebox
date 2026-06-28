# SafeBox 项目约定

## 技术约定

### 密码哈希
- 服务端使用 `bcrypt` 库（不是 passlib），直接调用 `hashpw`/`checkpw`
- 输入是客户端 PBKDF2 hash 的 base64 字符串（44 字符）
- `hashpw` 接受 `bytes`，输出 `bytes`，需要 `.encode()` / `.decode()` 转换
- `gensalt()` 默认 12 rounds，无需手动指定

### 依赖管理
- `requirements.txt` 中 `bcrypt` 不设版本上限（bcrypt 5.x API 稳定）
- 不用 passlib——它只是 bcrypt 的薄包装，且 1.7.4 与 bcrypt 5.x 不兼容
