/**
 * IndexedDB 连接管理 — 使用 idb 库
 *
 * ## 版本升级指南
 *
 * 当前 DB_VERSION = 1。
 *
 * **演化规则**（重要，别被旧注释误导）：
 *
 * 1. **新增** object store / index
 *    upgrade() 里的 objectStoreNames.contains(...) 守卫已经幂等，
 *    只需把 DB_VERSION 加 1，并在 upgrade 中追加同样写法的守卫式创建即可。
 *    老用户库会自动补建，**不需要清库**。
 *
 * 2. **修改 / 删除** 已有 store 的结构
 *    （改 keyPath、删 index、改字段语义）—— 这类变更 contains() 守卫覆盖不到，
 *    必须用 oldVersion 分支显式迁移：在 upgrade(db, oldVersion) 内判断
 *    oldVersion 小于目标版本时执行对应改造。
 *    且**不要删除旧分支** —— 用户可能从任何旧版本直接升级。
 *
 * 3. 调试期（未投产）若嫌麻烦，手工清 IndexedDB 也可以：
 *    F12 -> Application -> IndexedDB -> 删 safebox。
 *
 * 注：早期注释曾宣称 store 数量变化就必须清库，那是错的 —— 见规则 1。
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
    const request = indexedDB.open("__safebox_test__", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains("_t")) return;
      db.createObjectStore("_t", { keyPath: "id" });
    };
    // 同步不能等，只能假设可用
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
