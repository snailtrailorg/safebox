/** 业务领域类型 */

export type ItemType = "android" | "account" | "file";

export interface Item {
  did?: number;            // 本地自增 ID
  uid: number;
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

export interface SessionData {
  accessToken: string;
  refreshToken: string;
  serverUserId: string;
  passwordSalt: string;
  passwordWrapped: string;
  recoveryWrapped: string;
  encryptedPrivate: string;
  rsaPublicKey: string;
  lastSyncTime: string;
}
