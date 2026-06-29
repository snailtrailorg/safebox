import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "../../components/layout/AppLayout";
import { Toast } from "../../components/ui/Toast";
import { useVault } from "../../context/VaultContext";
import type { Item, ItemType } from "../../types/domain";

const TYPE_ICONS: Record<ItemType, string> = {
  android: "🤖",
  account: "🔑",
  file: "📁",
};

export function VaultListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { items, isLoading, error, deleteItem, clearError, syncNow, isSyncing } = useVault();
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const fabRef = useRef<HTMLDivElement>(null);
  const [swiping, setSwiping] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const TYPE_LABELS: Record<ItemType, string> = {
    android: t("vault.list.typeAndroid"),
    account: t("vault.list.typeAccount"),
    file: t("vault.list.typeFile"),
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const handleTouchStart = (did: number, e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setSwiping(did);
    setSwipeOffset(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (swiping === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (Math.abs(dy) > Math.abs(dx)) return;
    setSwipeOffset(Math.min(0, dx));
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

  const handleTouchEnd = useCallback(async (item: Item) => {
    if (swipeOffset < -80) {
      await performDelete(item);
    }
    setSwiping(null);
    setSwipeOffset(0);
  }, [swipeOffset, performDelete]);

  const handleAdd = (type: ItemType) => {
    setMenuOpen(false);
    navigate(`/item/new/${type}`);
  };

  const handleDelete = async (item: Item) => {
    await performDelete(item);
  };

  return (
    <AppLayout title={t("vault.list.title")}>
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
          {items.map((item) => (
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
                  transform: swiping === item.did ? `translateX(${swipeOffset}px)` : "translateX(0)",
                  transition: swiping === item.did ? "none" : "transform 0.2s",
                  position: "relative",
                  zIndex: 1,
                  touchAction: "pan-y",
                }}
              >
                <span style={{ fontSize: "1.5rem" }}>{TYPE_ICONS[item.type] || "🔒"}</span>
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
                  {TYPE_LABELS[item.type]}
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
          ))}
        </div>
      )}

      <div ref={fabRef} style={{ position: "fixed", bottom: 24, right: 24, zIndex: 50 }}>
        {menuOpen && (
          <div style={{
            position: "absolute", bottom: 60, right: 0,
            background: "#fff", borderRadius: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
            overflow: "hidden", minWidth: 180,
          }}>
            {(["android", "account", "file"] as ItemType[]).map((type) => (
              <button
                key={type}
                onClick={() => handleAdd(type)}
                style={{
                  display: "block", width: "100%", padding: "0.75rem 1rem",
                  background: "none", border: "none", borderBottom: "1px solid #f0f0f0",
                  cursor: "pointer", fontSize: "0.9rem", textAlign: "left",
                }}
              >
                {TYPE_ICONS[type]} {TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            width: 56, height: 56, borderRadius: "50%",
            background: menuOpen ? "#e74c3c" : "#0f3460",
            color: "#fff", border: "none",
            fontSize: "1.5rem", cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            display: "flex", justifyContent: "center", alignItems: "center",
            transform: menuOpen ? "rotate(45deg)" : "rotate(0)",
            transition: "all 0.2s",
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
