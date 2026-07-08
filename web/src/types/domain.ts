/** 业务领域类型 */

export type ItemType = "login" | "card" | "identity" | "note" | "file";

export interface Item {
  did?: number;            // 本地自增 ID
  uid: string;             // 用户 ID (serverUserId UUID)
  type: ItemType;
  icon: string | null;
  name: string;            // RSA 加密的 Base64
  description: string | null;
  data: string | null;     // RSA 加密的 JSON Base64
  serverId: string | null;
  version: number;
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
}

export interface SessionData {
  accessToken: string;
  refreshToken: string;
  serverUserId: string;
  email: string;
  passwordSalt: string;
  passwordWrapped: string;
  recoveryWrapped: string;
  encryptedPrivate: string;
  rsaPublicKey: string;
  lastSyncTime: string;
}
