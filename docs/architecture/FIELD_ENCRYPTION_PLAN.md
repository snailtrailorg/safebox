# SafeBox v2 字段级加密落地计划（调试版）

> 版本: v1.1
> 关联文档: KEY_HIERARCHY.md, DATA_FLOW.md, OVERALL_PLAN.md, REFACTOR_PLAN.md
> 适用阶段: Step 2.5（VaultContext 适配 + Item Key 加密）

**重要说明**：项目当前处于调试阶段，未上线生产，因此不需要向前兼容。所有 v1 旧代码直接删除，数据直接清空重建。

---

## 一、背景

当前条目加密实现与 v2 架构设计文档存在严重差距：

| 维度 | 设计文档要求 | 当前实现 |
|------|-------------|---------|
| name 字段 | EncryptedField（AES-GCM + AAD） | 明文字符串 |
| description 字段 | EncryptedField | 明文字符串 |
| data 字段 | EncryptedField（Item Key 加密） | RSA 加密的 JSON |
| encryption_version | 每条目标记 1 或 2 | 不存在该字段 |
| Item Key | 每条目独立随机生成 | 不生成 |
| AAD | 每字段唯一（防密文替换） | 无 AAD |

**零知识合规影响**：当前 `items.name` 明文存储。数据库泄露后攻击者直接看到所有条目名称，违反 README"服务端只存密文"的零知识声明。

---

## 二、调试阶段的简化决策

| 之前复杂的设计 | 调试阶段简化为 |
|---------------|--------------|
| v1/v2 双格式共存 | 直接干掉 v1 格式，全部走 v2 |
| encryption_version 字段 + 格式检测 + 分发调度 | 不需要，所有条目都是 v2，直接解密 |
| Feature Flag（开关开/关） | 不需要，直接写 v2 |
| RSA 条目加密（encryptItemData/decryptItemData）| 直接删除，统一用 encryptItemField |
| Android 兼容性等待 | 不相关，两端同步开发，统一走 v2 |
| IndexedDB schema 版本升级 | 直接 wipe + 重建 |
| 回滚策略（避免新数据不可读） | 不需要，调试阶段可随时重建 |

---

## 三、服务端说明

服务端表结构不需要修改。`items` 表保持现有字段不变，只是存入的内容发生变化：

| 字段 | v1 存的内容 | v2 存的内容 |
|------|-----------|-----------|
| name | `"Gmail"`（明文） | `{"encrypted_key":"...","ciphertext":"..."}` |
| data | RSA 加密后的 JSON 字符串 | `{"encrypted_key":"...","ciphertext":"..."}` |

服务端只存储和返回字符串，不解析内容。加密/解密全部在客户端完成。

---

## 四、简化后的类型定义

```typescript
// keychain/types.ts
interface EncryptedField {
  encrypted_key: string;   // AES-GCM(User Key, Item Key) - base64
  ciphertext: string;      // AES-GCM(plaintext, Item Key, AAD) - base64
}

// types/domain.ts
interface Item {
  id: string;
  vault_id: string;
  type: string;
  // 所有字段都是 v2 加密格式，没有明文版本，没有联合类型
  name: EncryptedField;
  description: EncryptedField | null;
  data: EncryptedField;
  // 不需要 encryption_version
}

// 不再需要 isEncryptedField() 类型守卫（所有字段都是 EncryptedField）
```

---

## 五、简化后的前端实现

**写入**（`ItemEditPage.tsx`）：

```typescript
async function handleSave() {
  const item: Item = {
    ...
    name: await keyChain.encryptItemField(name, 'name', selectedType),
    description: description
      ? await keyChain.encryptItemField(description, 'description', selectedType)
      : null,
    data: await keyChain.encryptItemField(JSON.stringify(dataFields), 'data', selectedType),
  };
  await saveItem(item);
}
```

**读取**（`ItemDetailPage.tsx`）：

```typescript
async function loadItem(id: string) {
  const item = await getItem(id);
  const name = await keyChain.decryptItemField(item.name, 'name', item.type);
  const data = await keyChain.decryptItemField(item.data, 'data', item.type);
  const description = item.description
    ? await keyChain.decryptItemField(item.description, 'description', item.type)
    : null;
}
```

**列表**（`VaultListPage.tsx`）：

```typescript
function renderItemName(item: Item) {
  return keyChain.decryptItemField(item.name, 'name', item.type);
}
```

---

## 六、需要删除的 v1 旧代码清单

| 文件 | 要删除的内容 |
|------|------------|
| `keychain/keyChain.ts` | `encryptItemData()` 方法、`decryptItemData()` 方法、RSA 相关 import |
| `keychain/types.ts` | 任何 v1 相关的类型定义 |
| `types/domain.ts` | Item 类型中的 string 联合、encryption_version 字段 |
| 任何调用 encryptItemData/decryptItemData 的地方 | 替换为 encryptItemField/decryptItemField |

---

## 七、执行计划

| 阶段 | 内容 |
|------|------|
| Phase 1 | 删除 v1 旧代码：encryptItemData/decryptItemData、RSA import、encryption_version、string 联合、类型守卫 |
| Phase 2 | 统一使用 v2 加密：ItemEditPage/ItemDetailPage/VaultListPage/VaultContext 全部调用 encryptItemField/decryptItemField |
| Phase 3 | 清理测试数据：wipe IndexedDB + 服务端 items 表，重新注册测试 |
| Phase 4 | 验证：创建 -> 列表 -> 详情 -> 编辑 -> 保存，检查服务端 name 是 JSON 密文 |

---

## 八、AAD 拼接规则

```typescript
function buildAAD(itemType: string, fieldName: string): string {
  return `safebox:v2:${itemType}:${fieldName}`;
}

// 示例
const aadName = "safebox:v2:login:name";
const aadData = "safebox:v2:login:data";
const aadNote = "safebox:v2:note:data";
```

不同 itemType 的 data 字段 AAD 不同，防止 login 的 data 被移动到 note 中。

---

## 九、验收标准

| 测试场景 | 步骤 | 期望结果 |
|---------|------|---------|
| 创建条目 | 创建新条目 | IndexedDB 中 name/description/data 均为 EncryptedField |
| 条目解密显示 | 查看条目详情 | 所有字段正确解密显示 |
| 条目列表显示 | 返回列表页 | 条目名称正确显示（解密后） |
| 编辑条目 | 编辑条目并保存 | 保持 v2 格式 |
| 服务端存储 | 检查数据库 items 表 | name 列存储的是 EncryptedField JSON |
| 无明文残留 | 检查 items 表中的 name 列 | 全部是 JSON，没有明文 |

---

## 十、一句话总结

因为项目在调试阶段，所有向前兼容的负担全部砍掉。直接走纯 v2 加密：ItemKey + AES-GCM + AAD，所有字段加密，无明文残留，无版本检测，无格式分发。删除旧代码，清空数据，重头测试。

---

## 十一、版本历史

| 版本 | 日期 | 变更说明 |
|------|------|---------|
| v1.0 | 2026-07-08 | 初始版本（兼容版） |
| v1.1 | 2026-07-08 | 调试版：移除所有兼容性设计，简化为纯 v2 |