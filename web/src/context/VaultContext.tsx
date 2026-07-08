/**
 * VaultContext — 密码库状态管理
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { Item, ItemType, ConflictInfo } from "../types/domain";
import { getUserItems, upsertItem, softDeleteItem, getItem, markSynced, softDeleteByServerId } from "../db/itemsStore";
import { getCurrentUserId } from "../db/sessionStore";
import { sync } from "../services/sync";
import { useAuth } from "./AuthContext";

interface VaultState {
  items: Item[];
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  conflicts: ConflictInfo[];
}

interface VaultContextType extends VaultState {
  loadItems: (uid: string) => Promise<void>;
  saveItem: (item: Item) => Promise<number>;
  deleteItem: (did: number) => Promise<void>;
  syncNow: () => Promise<void>;
  resolveConflict: (conflict: ConflictInfo, keepLocal: boolean) => Promise<void>;
  clearError: () => void;
}

const VaultContext = createContext<VaultContextType | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [state, setState] = useState<VaultState>({
    items: [],
    isLoading: false,
    isSyncing: false,
    error: null,
    conflicts: [],
  });

  const loadItems = useCallback(async (uid: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const items = await getUserItems(uid);
      setState((s) => ({ ...s, items, isLoading: false }));
    } catch (e) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: e instanceof Error ? e.message : "加载失败",
      }));
    }
  }, []);

  const saveItemAction = useCallback(async (item: Item): Promise<number> => {
    const did = await upsertItem(item);
    await loadItems(item.uid);
    return did;
  }, [loadItems]);

  const deleteItemAction = useCallback(async (did: number) => {
    await softDeleteItem(did);
    setState((s) => ({
      ...s,
      items: s.items.filter((i) => i.did !== did),
    }));
  }, []);

  const syncNow = useCallback(async () => {
    setState((s) => ({ ...s, isSyncing: true, error: null }));
    try {
      const result = await sync();
      const uid = await getCurrentUserId();
      const items = await getUserItems(uid);
      setState((s) => ({
        ...s,
        items,
        isSyncing: false,
        conflicts: result.conflicts,
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        isSyncing: false,
        error: e instanceof Error ? e.message : "同步失败",
      }));
    }
  }, []);

  const resolveConflict = useCallback(async (conflict: ConflictInfo, keepLocal: boolean) => {
    if (keepLocal) {
      // 保留本地：删除服务端版本记录（下次 sync 重新 push 本地版本）
      // 本地条目保持 isDirty，下次 sync 时服务端按 LWW 接受
      // 这里只需标记该 serverId 对应的远程条目为已处理（通过 markSynced 避免重复提示）
      await markSynced(conflict.localDid, conflict.serverId);
    } else {
      // 使用服务端版本：删除本地条目，下次 pull 时 upsertFromServer 写入服务端版本
      await softDeleteItem(conflict.localDid);
    }
    setState((s) => ({
      ...s,
      conflicts: s.conflicts.filter((c) => c.localDid !== conflict.localDid),
      items: s.items.filter((i) => i.did !== conflict.localDid || !keepLocal),
    }));
    // 重新同步以拉取服务端版本（useServer 场景）
    if (!keepLocal) {
      const uid = await getCurrentUserId();
      await loadItems(uid);
    }
  }, [loadItems]);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  // 登录后自动加载
  useEffect(() => {
    if (status === "ready") {
      getCurrentUserId().then((uid) => loadItems(uid));
    }
  }, [status, loadItems]);

  return (
    <VaultContext.Provider
      value={{
        ...state,
        loadItems,
        saveItem: saveItemAction,
        deleteItem: deleteItemAction,
        syncNow,
        resolveConflict,
        clearError,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVault(): VaultContextType {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used within VaultProvider");
  return ctx;
}
