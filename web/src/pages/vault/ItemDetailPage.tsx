import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "../../components/layout/AppLayout";
import { Toast } from "../../components/ui/Toast";
import { getItem, softDeleteItem, getFileBlob } from "../../db/itemsStore";
import { keyChain } from "../../keychain/keyChain";
import { formatFileSize } from "../../utils/format";
import { buildItemTypeConfigs } from "../../config/itemTypes";
import type { Item } from "../../types/domain";

function SensitiveField({ label, value }: { label: string; value: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      alignItems: "center", padding: "0.5rem 0",
      borderBottom: "1px solid #f0f0f0",
    }}>
      <span style={{ fontSize: "0.85rem", color: "#666" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{
          fontSize: "0.95rem", fontWeight: 500, fontFamily: "monospace", color: "#333",
          filter: visible ? "none" : "blur(5px)",
          transition: "filter 0.15s",
        }}>
          {value}
        </span>
        <button
          onClick={() => setVisible(!visible)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.85rem", padding: "0.25rem" }}
        >
          {visible ? "🙈" : "👁️"}
        </button>
      </div>
    </div>
  );
}

export function ItemDetailPage() {
  const { t } = useTranslation();
  const { did } = useParams<{ did: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSensitive, setShowSensitive] = useState(false);
  const [decryptedData, setDecryptedData] = useState<Record<string, string> | null>(null);
  const [decryptedName, setDecryptedName] = useState("");
  const [decryptedDesc, setDecryptedDesc] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const typeConfigs = buildItemTypeConfigs(t);
  const typeConfigMap = Object.fromEntries(typeConfigs.map((c) => [c.type, c]));

  const getTypeLabel = (type: string): string => {
    const cfg = typeConfigMap[type as keyof typeof typeConfigMap];
    return cfg ? cfg.label : type;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!did) return;
      const found = await getItem(parseInt(did));
      if (cancelled) return;
      setItem(found ?? null);
      setLoading(false);
      if (found) {
        const name = await keyChain.decryptItemField(found.name, "name", found.type);
        if (!cancelled) setDecryptedName(name || "");
        if (found.description) {
          const desc = await keyChain.decryptItemField(found.description, "description", found.type);
          if (!cancelled) setDecryptedDesc(desc);
        }
        if (found.type === "file" && found.data) {
          const plain = await keyChain.decryptItemField(found.data, "data", found.type);
          if (!cancelled && plain) {
            try {
              setDecryptedData(JSON.parse(plain));
            } catch {
              setDecryptedData({});
            }
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [did]);

  const handleShowSensitive = async () => {
    if (!item?.data) return;
    if (!decryptedData) {
      const plain = await keyChain.decryptItemField(item.data, "data", item.type);
      if (plain) {
        try {
          setDecryptedData(JSON.parse(plain));
        } catch {
          setDecryptedData({ raw: plain });
        }
      } else {
        setDecryptedData({ raw: "" });
      }
    }
    setShowSensitive(true);
  };

  const handleHideSensitive = () => {
    setShowSensitive(false);
  };

  const handleDelete = async () => {
    if (!item?.did || !confirm(t("vault.detail.confirmDelete"))) return;
    await softDeleteItem(item.did);
    navigate("/");
  };

  const handleDownload = async () => {
    if (!item?.did) return;
    setDownloading(true);
    try {
      const blob = await getFileBlob(item.did);
      if (!blob) {
        setToast({ message: t("vault.detail.fileNotFound"), type: "error" });
        setDownloading(false);
        return;
      }
      const decrypted = await keyChain.decryptFileBlob(blob.encryptedBlob);
      if (!decrypted) {
        setToast({ message: t("vault.detail.decryptFailed"), type: "error" });
        setDownloading(false);
        return;
      }
      const fileName = decryptedData?.fileName || "download";
      const mimeType = decryptedData?.fileType || "application/octet-stream";
      const downloadBlob = new Blob([decrypted], { type: mimeType });
      const url = URL.createObjectURL(downloadBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setToast({ message: e.message || t("vault.detail.downloadFailed"), type: "error" });
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return <AppLayout title={t("common.loading")}><p style={{ textAlign: "center", padding: "3rem", color: "#666" }}>{t("common.loading")}</p></AppLayout>;
  }

  if (!item) {
    return <AppLayout title={t("vault.detail.title")}><p style={{ textAlign: "center", padding: "3rem", color: "#666" }}>{t("vault.detail.notFound")}</p></AppLayout>;
  }

  return (
    <AppLayout
      title={t("vault.detail.title")}
      actions={
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={() => navigate(`/item/${did}/edit`)}
            style={{
              background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
              padding: "0.4rem 0.8rem", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem",
            }}
          >
            {t("vault.detail.edit")}
          </button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "inline-flex" }}>
          <span style={{
            background: "#0f3460", color: "#fff",
            padding: "0.25rem 0.75rem", borderRadius: 20,
            fontSize: "0.8rem", fontWeight: 500,
          }}>
            {getTypeLabel(item.type)}
          </span>
        </div>

        <div style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <div style={{ fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>{t("vault.detail.name")}</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "#333" }}>{decryptedName}</div>
        </div>

        {decryptedDesc !== null && (
          <div style={{
            background: "#fff", borderRadius: 10, padding: "1.25rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}>
            <div style={{ fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>{t("vault.detail.notes")}</div>
            <div style={{ fontSize: "0.95rem", color: "#555" }}>{decryptedDesc}</div>
          </div>
        )}

        {/* 文件类型：文件信息 + 下载 */}
        {item.type === "file" && decryptedData?.fileName && (
          <div style={{
            background: "#fff", borderRadius: 10, padding: "1.25rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}>
            <div style={{ fontSize: "0.8rem", color: "#999", marginBottom: "0.5rem" }}>📁 {t("vault.detail.typeFile")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.85rem", color: "#666" }}>{t("vault.detail.fileName")}</span>
                <span style={{ fontSize: "0.9rem", fontWeight: 500, color: "#333" }}>{decryptedData.fileName}</span>
              </div>
              {decryptedData.fileSize && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.85rem", color: "#666" }}>{t("vault.detail.fileSize")}</span>
                  <span style={{ fontSize: "0.9rem", color: "#555" }}>{formatFileSize(Number(decryptedData.fileSize))}</span>
                </div>
              )}
              <button
                onClick={handleDownload}
                disabled={downloading}
                style={{
                  width: "100%", padding: "0.6rem", marginTop: "0.25rem",
                  background: downloading ? "#95a5a6" : "#3498db", color: "#fff",
                  border: "none", borderRadius: 8, fontSize: "0.9rem", fontWeight: 600,
                  cursor: downloading ? "not-allowed" : "pointer",
                }}
              >
                {downloading ? t("common.loading") : t("vault.detail.downloadFile")}
              </button>
            </div>
          </div>
        )}

        {/* 非文件类型：敏感数据 */}
        {item.type !== "file" && item.data && (
          <div style={{
            background: "#fff", borderRadius: 10, padding: "1.25rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}>
            <div style={{ fontSize: "0.8rem", color: "#999", marginBottom: "0.5rem" }}>{t("vault.detail.sensitive")}</div>
            {!showSensitive ? (
              <button
                onMouseDown={(e) => { e.preventDefault(); handleShowSensitive(); }}
                onMouseUp={handleHideSensitive}
                onTouchStart={handleShowSensitive}
                onTouchEnd={handleHideSensitive}
                style={{
                  width: "100%", padding: "1rem",
                  background: "#f5f5f5", border: "2px dashed #ddd",
                  borderRadius: 8, cursor: "pointer",
                  fontSize: "0.9rem", color: "#666",
                }}
              >
                {t("vault.detail.holdToView")}
              </button>
            ) : decryptedData ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {Object.entries(decryptedData).map(([key, value]) => (
                  <SensitiveField key={key} label={key} value={value} />
                ))}
              </div>
            ) : null}
          </div>
        )}

        <button
          onClick={handleDelete}
          style={{
            width: "100%", padding: "0.75rem",
            background: "#fff", border: "1px solid #e74c3c",
            borderRadius: 8, color: "#e74c3c",
            fontSize: "0.95rem", cursor: "pointer",
            marginTop: "1rem",
          }}
        >
          {t("vault.detail.deleteItem")}
        </button>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AppLayout>
  );
}
