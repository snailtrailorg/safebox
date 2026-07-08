import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "../../components/layout/AppLayout";
import { Toast } from "../../components/ui/Toast";
import { useVault } from "../../context/VaultContext";
import { buildItemTypeConfigs } from "../../config/itemTypes";
import type { Item } from "../../types/domain";

export function VaultListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { items, isLoading, error, deleteItem, clearError, conflicts, resolveConflict } = useVault();
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [swiping, setSwiping] = useState<number | null>(null);
  const swipeRef = useRef({ offset: 0 });
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const configs = buildItemTypeConfigs(t);
  const typeConfigMap = Object.fromEntries(configs.map((c) => [c.type, c]));

  const handleTouchStart = (did: number, e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setSwiping(did);
    swipeRef.current.offset = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (swiping === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (Math.abs(dy) > Math.abs(dx)) return;
    swipeRef.current.offset = Math.min(0, dx);
    // 强制重渲染让 transform 更新
    setSwiping(swiping);
  };

  const performDelete = async (item: Item) => {
    if (!item.did) return;
    if (!confirm(t("vault.list.confirmDelete", { name: item.name }))) return;
    setDeleting(item.did);
    try {
      await deleteItem(item.did);
      setToast({ message: t("vault.list.deleted"), type: "success" });
    } catch (e: any) {
      setToast({ message: e.message || t("vault.list.deleteFailed"), type: "error" });
    } finally {
      setDeleting(null);
    }
  };

  const handleTouchEnd = async (item: Item) => {
    if (swipeRef.current.offset < -80) {
      await performDelete(item);
    }
    setSwiping(null);
    swipeRef.current.offset = 0;
  };

  const handleDelete = async (item: Item) => {
    await performDelete(item);
  };

  // 根据 item.type 获取配置，旧类型 fallback
  const getTypeInfo = (type: string) => {
    const cfg = typeConfigMap[type as keyof typeof typeConfigMap];
    if (cfg) return cfg;
    // fallback for old types
    return { icon: "🔒", label: type };
  };

  return (
    <AppLayout title={t("vault.list.title")}>
      {conflicts.length > 0 && (
        <div style={{
          background: "#fff3cd",
          border: "1px solid #ffeaa7",
          borderRadius: 10,
          padding: "1rem",
          marginBottom: "1rem",
        }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "#856404" }}>
            {t("vault.conflict.title")}
          </div>
          {conflicts.map((c) => {
            const localItem = items.find((i) => i.did === c.localDid);
            return (
              <div key={c.localDid} style={{
                borderTop: "1px solid #ffeaa7",
                paddingTop: "0.5rem",
                marginTop: "0.5rem",
              }}>
                <div style={{ fontSize: "0.9rem", marginBottom: "0.5rem", color: "#856404" }}>
                  {localItem?.name ?? t("vault.conflict.unknownItem")}
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    onClick={() => resolveConflict(c, true)}
                    style={{
                      flex: 1, padding: "0.5rem", border: "1px solid #d39e00",
                      background: "#fff", borderRadius: 6, cursor: "pointer",
                      fontSize: "0.85rem",
                    }}
                  >
                    {t("vault.conflict.keepLocal")}
                  </button>
                  <button
                    onClick={() => resolveConflict(c, false)}
                    style={{
                      flex: 1, padding: "0.5rem", border: "1px solid #d39e00",
                      background: "#fff", borderRadius: 6, cursor: "pointer",
                      fontSize: "0.85rem",
                    }}
                  >
                    {t("vault.conflict.useServer")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {isLoading && items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem 0", color: "#666" }}>
          <p>{t("common.loading")}</p>
        </div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem 0", color: "#666" }}>
          <p style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>🔒</p>
          <p style={{ fontSize: "1.1rem", fontWeight: 500, marginBottom: "0.25rem" }}>{t("vault.list.emptyTitle")}</p>
          <p style={{ fontSize: "0.85rem" }}>{t("vault.list.emptySubtitle")}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {items.map((item) => {
            const typeInfo = getTypeInfo(item.type);
            return (
              <div
                key={item.did}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  borderRadius: 10,
                  background: "#fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                }}
              >
                <div style={{
                  position: "absolute",
                  top: 0, bottom: 0, right: 0, width: 80,
                  background: "#e74c3c",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontSize: "0.85rem", fontWeight: 500,
                  borderRadius: "0 10px 10px 0",
                }}>
                  {t("vault.list.deleteSwipe")}
                </div>
                <div
                  onClick={() => {
                    if (swiping !== null) return;
                    navigate(`/item/${item.did}`);
                  }}
                  onTouchStart={(e) => handleTouchStart(item.did!, e)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={() => handleTouchEnd(item)}
                  style={{
                    padding: "1rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    cursor: "pointer",
                    background: "#fff",
                    borderRadius: 10,
                    transform: swiping === item.did ? `translateX(${swipeRef.current.offset}px)` : "translateX(0)",
                    transition: swiping === item.did ? "none" : "transform 0.2s",
                    position: "relative",
                    zIndex: 1,
                    touchAction: "pan-y",
                  }}
                >
                  <span style={{ fontSize: "1.5rem" }}>{typeInfo.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.name}
                    </div>
                    {item.description && (
                      <div style={{ fontSize: "0.8rem", color: "#999", marginTop: "0.15rem" }}>
                        {item.description}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#aaa" }}>
                    {typeInfo.label}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(item);
                    }}
                    disabled={deleting === item.did}
                    style={{
                      background: "none", border: "none", color: "#e74c3c",
                      cursor: deleting === item.did ? "not-allowed" : "pointer", fontSize: "0.85rem", padding: "0.25rem",
                      opacity: deleting === item.did ? 0.3 : 0.6,
                    }}
                    title={t("common.delete")}
                  >
                    {deleting === item.did ? "⏳" : "🗑️"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 50 }}>
        <button
          onClick={() => navigate("/item/new/login")}
          style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "#0f3460",
            color: "#fff", border: "none",
            fontSize: "1.5rem", cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            display: "flex", justifyContent: "center", alignItems: "center",
          }}
        >
          +
        </button>
      </div>

      {error && <Toast message={error} type="error" onClose={clearError} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AppLayout>
  );
}
