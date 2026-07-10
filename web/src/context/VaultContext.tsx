/**
 * VaultContext — 密码库状态管理
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { Item, ItemType, ConflictInfo } from "../types/domain";
import { getUserItems, upsertItem, softDeleteItem, getItem, markSynced, markForRepush, upsertFromServer, softDeleteByServerId } from "../db/itemsStore";
import { getCurrentUserId } from "../db/sessionStore";
import { sync } from "../services/sync";
import { keyChain } from "../keychain/keyChain";
import { useAuth } from "./AuthContext";

interface VaultState {
  items: Item[];
  itemNames: Record<number, string>;
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
    itemNames: {},
    isLoading: false,
    isSyncing: false,
    error: null,
    conflicts: [],
  });

  const decryptNames = useCallback(async (items: Item[]): Promise<Record<number, string>> => {
    const names: Record<number, string> = {};
    await Promise.all(items.map(async (item) => {
      if (item.did) {
        const name = await keyChain.decryptItemField(item.name, "name", item.type);
        names[item.did] = name || "";
      }
    }));
    return names;
  }, []);

  const loadItems = useCallback(async (uid: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const items = await getUserItems(uid);
      const itemNames = await decryptNames(items);
      setState((s) => ({ ...s, items, itemNames, isLoading: false }));
    } catch (e) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: e instanceof Error ? e.message : "加载失败",
      }));
    }
  }, [decryptNames]);

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
      const itemNames = await decryptNames(items);
      setState((s) => ({
        ...s,
        items,
        itemNames,
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
  }, [decryptNames]);

  const resolveConflict = useCallback(async (conflict: ConflictInfo, keepLocal: boolean) => {
    if (keepLocal) {
      // 保留本地：把基线设为服务端当前版本（认基线），保持 dirty，
      // 下次 push 基线匹配 -> 接受，本地内容胜出（方案 A 乐观并发）
      await markForRepush(conflict.localDid, conflict.serverItem?.version);
    } else {
      // 使用服务端版本：本地应用 pull 时捕获的服务端版本（按 serverId 原地更新，不删除）
      if (conflict.serverItem) {
        await upsertFromServer([{
          type: conflict.serverItem.type,
          icon: conflict.serverItem.icon,
          name: conflict.serverItem.name,
          description: conflict.serverItem.description,
          data: conflict.serverItem.data,
          serverId: conflict.serverId,
          version: conflict.serverItem.version,
          isDirty: false,
          updatedAt: conflict.serverItem.updatedAt,
        }]);
      }
    }
    setState((s) => ({
      ...s,
      conflicts: s.conflicts.filter((c) => c.localDid !== conflict.localDid),
      items: s.items.filter((i) => i.did !== conflict.localDid || !keepLocal),
    }));
    // 重新加载本地列表反映变更
    const uid = await getCurrentUserId();
    await loadItems(uid);
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
