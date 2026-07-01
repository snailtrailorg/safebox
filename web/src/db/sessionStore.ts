/**
 * Session 持久化 — IndexedDB
 */
import { getDb } from "./database";
import type { SessionData } from "../types/domain";

const SESSION_KEY = "current";

const EMPTY_SESSION: SessionData = {
  accessToken: "",
  refreshToken: "",
  serverUserId: "",
  email: "",
  passwordSalt: "",
  passwordWrapped: "",
  recoveryWrapped: "",
  encryptedPrivate: "",
  rsaPublicKey: "",
  lastSyncTime: "2020-01-01T00:00:00+00:00",
};

export async function getSession(): Promise<SessionData> {
  const db = await getDb();
  const session = await db.get("session", SESSION_KEY);
  return session ?? { ...EMPTY_SESSION };
}

export async function saveSession(data: Partial<SessionData>): Promise<void> {
  const db = await getDb();
  const existing = await db.get("session", SESSION_KEY);
  const merged = { ...EMPTY_SESSION, ...(existing ?? {}), ...data, key: SESSION_KEY };
  await db.put("session", merged);
}

export async function clearSession(): Promise<void> {
  const db = await getDb();
  await db.delete("session", SESSION_KEY);
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getSession();
  return session.accessToken || null;
}

export async function getRefreshToken(): Promise<string | null> {
  const session = await getSession();
  return session.refreshToken || null;
}

export async function updateTokens(
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  await saveSession({ accessToken, refreshToken });
}

export async function getLastSyncTime(): Promise<string> {
  const session = await getSession();
  return session.lastSyncTime || "2020-01-01T00:00:00+00:00";
}

export async function updateLastSyncTime(time: string): Promise<void> {
  await saveSession({ lastSyncTime: time });
}

export async function hasSession(): Promise<boolean> {
  const session = await getSession();
  return !!session.accessToken;
}

/** 获取当前用户 ID（即 serverUserId UUID） */
export async function getCurrentUserId(): Promise<string> {
  const session = await getSession();
  return session.serverUserId || "00000000-0000-0000-0000-000000000000";
}
