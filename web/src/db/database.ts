/**
 * IndexedDB 连接管理 — 使用 idb 库
 */
import { openDB, DBSchema, IDBPDatabase } from "idb";
import type { Item, SessionData } from "../types/domain";

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

export async function getDb(): Promise<IDBPDatabase<SafeBoxDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<SafeBoxDB>("safebox", 1, {
    upgrade(db) {
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
