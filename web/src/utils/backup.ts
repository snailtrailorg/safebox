/**
 * 加密备份导出/导入
 *
 * 格式：JSON → AES-256-GCM(PBKDF2(backupPassword, salt)) → .safebox 文件
 */
import { deriveKey, generateSalt } from "../crypto/pbkdf2";
import { aesEncrypt, aesDecrypt } from "../crypto/aes";
import { getUserItems, upsertItem } from "../db/itemsStore";
import type { Item } from "../types/domain";

const BACKUP_EXTENSION = ".safebox";

interface BackupPayload {
  version: 1;
  items: Array<{
    type: string;
    icon: string | null;
    name: string;
    description: string | null;
    data: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
}

/** 导出加密备份 */
export async function exportBackup(password: string): Promise<void> {
  const items = await getUserItems(1);
  const payload: BackupPayload = {
    version: 1,
    items: items.map((i) => ({
      type: i.type,
      icon: i.icon,
      name: i.name,
      description: i.description,
      data: i.data,
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
  if (raw.length < 33) throw new Error("无效的备份文件");
  const salt = raw.slice(0, 32);
  const encoded = new TextDecoder().decode(raw.slice(32));

  const key = await deriveKey(password, salt);
  // aesDecrypt 自动从 base64 中提取 nonce
  const plainBytes = await aesDecrypt(key, encoded);
  if (!plainBytes) throw new Error("密码错误或文件损坏");

  const payload: BackupPayload = JSON.parse(new TextDecoder().decode(plainBytes));
  if (payload.version !== 1) throw new Error(`不支持的备份版本: ${payload.version}`);

  let count = 0;
  for (const item of payload.items) {
    await upsertItem({
      uid: 1,
      type: item.type as Item["type"],
      icon: item.icon,
      name: item.name,
      description: item.description,
      data: item.data,
      serverId: null,
      version: 1,
      isDirty: true,
      isDeleted: false,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt,
    });
    count++;
  }

  return count;
}
