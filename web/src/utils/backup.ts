/**
 * 加密备份导出/导入
 *
 * 格式：JSON → AES-256-GCM(PBKDF2(backupPassword, salt)) → .safebox 文件
 */
import { deriveKey, generateSalt } from "../crypto/kdf";
import i18n from "../i18n";
import { aesEncrypt, aesDecrypt } from "../crypto/aes";
import { getDb } from "../db/database";
import { getUserItems, upsertItem } from "../db/itemsStore";
import { getCurrentUserId } from "../db/sessionStore";
import type { Item, EncryptedField } from "../types/domain";

const BACKUP_EXTENSION = ".safebox";

interface BackupPayload {
  version: 1;
  items: Array<{
    type: string;
    icon: string | null;
    name: EncryptedField;
    description: EncryptedField | null;
    data: EncryptedField;
    serverId: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
}

/** EncryptedField 形状校验：必须是带 ciphertext 字符串的对象 */
function isEncryptedField(v: unknown): v is EncryptedField {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as EncryptedField).ciphertext === "string" &&
    typeof (v as EncryptedField).encrypted_key === "string"
  );
}

/**
 * 备份体结构校验。
 *
 * 备份文件来自用户磁盘，可被任意篡改或损坏；早期实现直接 JSON.parse 后
 * `for (const item of payload.items)`，后果分三类：
 *   - items 是字符串 -> **逐字符迭代**，"n"、"o" 各成一个"条目"，静默导入垃圾；
 *   - items 是数字/对象 -> for...of 抛 TypeError，错误信息与"密码错"无法区分；
 *   - 条目缺 name/data -> `undefined` 直接落库，污染本地库存（后续解密全崩）。
 * 这里统一拦在写入前，宁可整份拒绝，也不落半份脏数据。
 */
function validateBackupPayload(raw: unknown): BackupPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("backup_invalid_payload");
  }
  const p = raw as Record<string, unknown>;
  if (p.version !== 1) {
    throw new Error(i18n.t("backup.unsupportedVersion", { version: String(p.version) }));
  }
  if (!Array.isArray(p.items)) {
    throw new Error("backup_invalid_items");
  }
  for (const [idx, item] of p.items.entries()) {
    if (!item || typeof item !== "object") {
      throw new Error(`backup_invalid_item:${idx}`);
    }
    const it = item as Record<string, unknown>;
    if (typeof it.type !== "string") {
      throw new Error(`backup_invalid_item_type:${idx}`);
    }
    if (!isEncryptedField(it.name)) {
      throw new Error(`backup_invalid_item_name:${idx}`);
    }
    if (!isEncryptedField(it.data)) {
      throw new Error(`backup_invalid_item_data:${idx}`);
    }
    if (it.description != null && !isEncryptedField(it.description)) {
      throw new Error(`backup_invalid_item_description:${idx}`);
    }
    if (it.serverId != null && typeof it.serverId !== "string") {
      throw new Error(`backup_invalid_item_server_id:${idx}`);
    }
    // 时间戳缺失时给 0 兜底（备份格式早期版本可能没这两个字段），
    // 但不能是 NaN —— NaN 会让条目在按 updatedAt 排序时永久失序。
    if (it.createdAt != null && !Number.isFinite(it.createdAt)) {
      throw new Error(`backup_invalid_item_created_at:${idx}`);
    }
    if (it.updatedAt != null && !Number.isFinite(it.updatedAt)) {
      throw new Error(`backup_invalid_item_updated_at:${idx}`);
    }
  }
  return raw as BackupPayload;
}

/** 导出加密备份 */
export async function exportBackup(password: string): Promise<void> {
  const uid = await getCurrentUserId();
  const items = await getUserItems(uid);
  const payload: BackupPayload = {
    version: 1,
    items: items.map((i) => ({
      type: i.type,
      icon: i.icon,
      name: i.name,
      description: i.description,
      data: i.data,
      serverId: i.serverId ?? null,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    })),
  };

  const plaintext = JSON.stringify(payload);
  const salt = generateSalt();
  const key = await deriveKey(password, salt);
  // aesEncrypt 返回 base64(nonce + ciphertext)
  const encrypted = await aesEncrypt(key, new TextEncoder().encode(plaintext));

  // 文件格式: salt(32字节) + base64(nonce+ciphertext)
  const header = new Uint8Array(salt);
  const body = new TextEncoder().encode(encrypted!);
  const combined = new Uint8Array(header.length + body.length);
  combined.set(header);
  combined.set(body, header.length);
  const blob = new Blob([combined], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `safebox-backup-${new Date().toISOString().slice(0, 10)}${BACKUP_EXTENSION}`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 导入加密备份，返回导入的条目数 */
export async function importBackup(password: string, file: File): Promise<number> {
  const raw = new Uint8Array(await file.arrayBuffer());

  // 解析: 前 32 字节是 salt，剩余是 base64(nonce+ciphertext)
  if (raw.length < 33) throw new Error(i18n.t("backup.invalidFile"));
  const salt = raw.slice(0, 32);
  const encoded = new TextDecoder().decode(raw.slice(32));

  const key = await deriveKey(password, salt);
  // aesDecrypt 自动从 base64 中提取 nonce
  const plainBytes = await aesDecrypt(key, encoded);
  if (!plainBytes) throw new Error(i18n.t("backup.wrongPassword"));

  // 解密成功不等于文件合法：JSON.parse 与结构校验都必须兜住，
  // 否则损坏文件会以未捕获异常或脏数据形式漏出去。
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plainBytes));
  } catch {
    throw new Error(i18n.t("backup.invalidFile"));
  }
  const payload = validateBackupPayload(parsed);

  const uid = await getCurrentUserId();
  const db = await getDb();
  let count = 0;
  for (const item of payload.items) {
    // 按 serverId 去重：已存在的条目跳过，避免重复导入产生重复
    if (item.serverId) {
      const existing = await db.getAllFromIndex("items", "by-serverId", item.serverId);
      if (existing.length > 0) continue;
    }
    await upsertItem({
      uid,
      type: item.type as Item["type"],
      icon: item.icon,
      name: item.name,
      description: item.description,
      data: item.data,
      serverId: item.serverId,
      version: 1,
      isDirty: true,
      isDeleted: false,
      updatedAt: item.updatedAt ?? 0,
      createdAt: item.createdAt ?? 0,
    });
    count++;
  }

  return count;
}
