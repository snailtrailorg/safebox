/** 业务领域类型 */

import type { EncryptedField } from "../keychain/types";
export type { EncryptedField };

export type ItemType = "login" | "card" | "identity" | "note" | "file";

export interface Item {
  did?: number;            // 本地自增 ID
  uid: string;             // 用户 ID (serverUserId UUID)
  type: ItemType;
  icon: string | null;
  name: EncryptedField;            // v2 AES-GCM + Item Key + AAD
  description: EncryptedField | null;
  data: EncryptedField;            // v2 AES-GCM + Item Key + AAD
  serverId: string | null;
  version: number;          // 同步版本号
  isDirty: boolean;
  isDeleted: boolean;
  updatedAt: number;       // epoch ms
  createdAt: number;       // epoch ms
}

/** 同步冲突信息（本地版本与服务端版本不一致） */
export interface ConflictInfo {
  localDid: number;
  serverId: string;
  localUpdatedAt: number;   // epoch ms
  serverUpdatedAt: number;  // epoch ms
  /** 冲突时捕获的服务端版本（供「使用服务端」时本地应用，避免条目消失） */
  serverItem?: {
    type: string;
    icon: string | null;
    name: EncryptedField;
    description: EncryptedField | null;
    data: EncryptedField;
    version: number;
    updatedAt: number;  // epoch ms
  };
}

export interface SessionData {
  accessToken: string;
  refreshToken: string;
  serverUserId: string;
  email: string;
  passwordSalt: string;
  passwordWrapped: string;
  encryptedPrivate: string;
  rsaPublicKey: string;
  lastSyncTime: string;
}
