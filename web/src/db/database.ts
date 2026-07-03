/**
 * IndexedDB 连接管理 — 使用 idb 库
 *
 * ## 版本升级指南
 *
 * 当前版本 DB_VERSION = 1（调试阶段）。
 * schema 变更时手工清 IndexedDB 即可，不需要改动版本号。
 *
 * 【投产前必做】将 DB_VERSION 设为当前数据库版本 +1，
 * 在 upgrade() 中用 oldVersion 分支编写迁移逻辑。
 * 例如从 v1 到 v2：
 *   if (oldVersion < 2) { db.createObjectStore("newStore", ...); }
 * 不要删除旧分支——用户可能从任何旧版本升级。
 */
import { openDB, DBSchema, IDBPDatabase } from "idb";
import type { Item, SessionData } from "../types/domain";

/** 当前数据库 schema 版本。发布后每改一次 schema +1 */
const DB_VERSION = 1;

export interface SafeBoxDB extends DBSchema {
  session: {
    key: string;
    value: SessionData;
  };
  items: {
    key: number;
    value: Item;
    indexes: {
      "by-uid": string;
      "by-serverId": string;
      "by-dirty": number;
    };
  };
  fileBlobs: {
    key: number;
    value: {
      did: number;
      encryptedBlob: string;  // Base64(nonce + ciphertext) from AES-GCM
    };
  };
}

let dbInstance: IDBPDatabase<SafeBoxDB> | null = null;

/** 检测 IndexedDB 是否可用 */
export function isIndexedDBAvailable(): boolean {
  try {
    if (typeof indexedDB === "undefined") return false;
    const test = indexedDB.open("__test__", 1);
    test.onblocked = () => {};
    return true;
  } catch {
    return false;
  }
}

export async function getDb(): Promise<IDBPDatabase<SafeBoxDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<SafeBoxDB>("safebox", DB_VERSION, {
    upgrade(db, oldVersion, newVersion) {
      if (!db.objectStoreNames.contains("session")) {
        db.createObjectStore("session", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("items")) {
        const store = db.createObjectStore("items", { keyPath: "did", autoIncrement: true });
        store.createIndex("by-uid", "uid");
        store.createIndex("by-serverId", "serverId");
        store.createIndex("by-dirty", "isDirty");
      }
      if (!db.objectStoreNames.contains("fileBlobs")) {
        db.createObjectStore("fileBlobs", { keyPath: "did" });
      }
    },
  });

  return dbInstance;
}
