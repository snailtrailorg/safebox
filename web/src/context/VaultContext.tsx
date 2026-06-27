/**
 * VaultContext — 密码库状态管理
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { Item, ItemType } from "../types/domain";
import { getUserItems, upsertItem, softDeleteItem, getItem } from "../db/itemsStore";
import { sync } from "../services/sync";
import { useAuth } from "./AuthContext";

interface VaultState {
  items: Item[];
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
}

interface VaultContextType extends VaultState {
  loadItems: (uid: number) => Promise<void>;
  saveItem: (item: Item) => Promise<number>;
  deleteItem: (did: number) => Promise<void>;
  syncNow: () => Promise<void>;
  clearError: () => void;
}

const VaultContext = createContext<VaultContextType | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth();
  const [state, setState] = useState<VaultState>({
    items: [],
    isLoading: false,
    isSyncing: false,
    error: null,
  });

  const loadItems = useCallback(async (uid: number) => {
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
      // 重新加载
      const items = await getUserItems(1); // TODO: use real uid
      setState((s) => ({ ...s, items, isSyncing: false }));
      console.log(`Synced: pushed ${result.pushed}, pulled ${result.pulled}`);
    } catch (e) {
      setState((s) => ({
        ...s,
        isSyncing: false,
        error: e instanceof Error ? e.message : "同步失败",
      }));
    }
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  // 登录后自动加载
  useEffect(() => {
    if (isLoggedIn) {
      loadItems(1); // TODO: use real uid
    }
  }, [isLoggedIn, loadItems]);

  return (
    <VaultContext.Provider
      value={{
        ...state,
        loadItems,
        saveItem: saveItemAction,
        deleteItem: deleteItemAction,
        syncNow,
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
