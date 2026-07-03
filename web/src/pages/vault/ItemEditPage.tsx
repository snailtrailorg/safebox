import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "../../components/layout/AppLayout";
import { Toast } from "../../components/ui/Toast";
import { useVault } from "../../context/VaultContext";
import { getItem, saveFileBlob } from "../../db/itemsStore";
import { getCurrentUserId } from "../../db/sessionStore";
import { keyManager } from "../../services/keyManager";
import { generatePassword } from "../../utils/password";
import { formatFileSize } from "../../utils/format";
import { ITEM_TYPES } from "../../config/itemTypes";
import type { Item, ItemType } from "../../types/domain";

export function ItemEditPage() {
  const { t } = useTranslation();
  const { did, type } = useParams<{ did?: string; type?: string }>();
  const navigate = useNavigate();
  const { saveItem } = useVault();
  const isEdit = did && did !== "0";

  const TYPE_LABELS: Record<ItemType, string> = {
    android: t("vault.edit.typeAndroid"),
    account: t("vault.edit.typeAccount"),
    file: t("vault.edit.typeFile"),
  };

  const [itemType, setItemType] = useState<ItemType>((type as ItemType) || "account");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataFields, setDataFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    if (isEdit && did) {
      setLoading(true);
      getItem(parseInt(did)).then(async (item) => {
        if (item) {
          setItemType(item.type);
          setName(item.name);
          setDescription(item.description || "");
          if (item.data) {
            try {
              const plain = await keyManager.decryptItemData(item.data);
              if (plain) {
                setDataFields(JSON.parse(plain));
              } else {
                setDataFields(JSON.parse(item.data));
              }
            } catch {
              try {
                setDataFields(JSON.parse(item.data));
              } catch {
                setDataFields({});
              }
            }
          }
        }
        setLoading(false);
      });
    }
  }, [isEdit, did]);

  const handleSave = async () => {
    if (!name.trim()) {
      setToast({ message: t("vault.edit.enterName"), type: "error" });
      return;
    }
    if (itemType === "file" && !selectedFile && !isEdit) {
      setToast({ message: t("vault.edit.noFile"), type: "error" });
      return;
    }
    setSaving(true);
    try {
      // 文件类型：准备加密文件内容
      let pendingFileEncrypted: string | null = null;
      if (itemType === "file" && selectedFile) {
        const fileBuffer = await selectedFile.arrayBuffer();
        const encrypted = await keyManager.encryptFileBlob(fileBuffer);
        if (!encrypted) {
          setToast({ message: t("vault.edit.saveFailed"), type: "error" });
          setSaving(false);
          return;
        }
        pendingFileEncrypted = encrypted;
        dataFields.fileName = selectedFile.name;
        dataFields.fileSize = String(selectedFile.size);
        dataFields.fileType = selectedFile.type || "application/octet-stream";
      }

      // 剥离 UI 状态字段，避免泄漏到加密数据
      const { _pwVisible, ...cleanFields } = dataFields;
      const dataJson = JSON.stringify(cleanFields);
      const encrypted = await keyManager.encryptItemData(dataJson);

      const uid = await getCurrentUserId();
      const item: Item = {
        did: isEdit && did ? parseInt(did) : 0,
        uid,
        type: itemType,
        icon: null,
        name: name.trim(),
        description: description.trim() || null,
        data: encrypted || dataJson,
        serverId: null,
        version: 1,
        isDirty: true,
        isDeleted: false,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      };

      const savedDid = await saveItem(item);

      // 保存加密文件 blob（在 item 保存后，使用真实的 did）
      if (pendingFileEncrypted) {
        await saveFileBlob(savedDid, pendingFileEncrypted);
      }

      setToast({ message: t("vault.edit.saved"), type: "success" });
      setTimeout(() => navigate(`/item/${savedDid}`), 500);
    } catch (e: any) {
      setToast({ message: e.message || t("vault.edit.saveFailed"), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePassword = (field: string) => {
    setDataFields((prev) => ({ ...prev, [field]: generatePassword() }));
  };

  if (loading) {
    return <AppLayout title={t("common.loading")}><p style={{ textAlign: "center", padding: "3rem", color: "#666" }}>{t("common.loading")}</p></AppLayout>;
  }

  return (
    <AppLayout title={isEdit ? t("vault.edit.titleEdit") : t("vault.edit.titleNew")}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {!isEdit && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {ITEM_TYPES.map((tp) => (
              <button
                key={tp}
                onClick={() => setItemType(tp)}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: 20,
                  border: itemType === tp ? "2px solid #0f3460" : "1px solid #ddd",
                  background: itemType === tp ? "#0f3460" : "#fff",
                  color: itemType === tp ? "#fff" : "#333",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                }}
              >
                {TYPE_LABELS[tp]}
              </button>
            ))}
          </div>
        )}

        <div style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>{t("vault.edit.name")}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("vault.edit.namePlaceholder")}
            style={{
              width: "100%", padding: "0.5rem", border: "1px solid #ddd", borderRadius: 8,
              fontSize: "0.95rem", outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>{t("vault.edit.notes")}</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("vault.edit.notesPlaceholder")}
            style={{
              width: "100%", padding: "0.5rem", border: "1px solid #ddd", borderRadius: 8,
              fontSize: "0.95rem", outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          {itemType === "android" && (
            <>
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>{t("vault.edit.packageName")}</label>
                <input
                  type="text"
                  value={dataFields.package || ""}
                  onChange={(e) => setDataFields((p) => ({ ...p, package: e.target.value }))}
                  placeholder={t("vault.edit.packagePlaceholder")}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>{t("vault.edit.username")}</label>
                <input
                  type="text"
                  value={dataFields.username || ""}
                  onChange={(e) => setDataFields((p) => ({ ...p, username: e.target.value }))}
                  placeholder={t("vault.edit.usernamePlaceholder")}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>{t("vault.edit.password")}</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      type={dataFields._pwVisible === "true" ? "text" : "password"}
                      value={dataFields.password || ""}
                      onChange={(e) => setDataFields((p) => ({ ...p, password: e.target.value }))}
                      placeholder={t("vault.edit.passwordPlaceholder")}
                      style={{ width: "100%", padding: "0.5rem 2rem 0.5rem 0.5rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }}
                    />
                    <button
                      onClick={() => setDataFields((p) => ({ ...p, _pwVisible: p._pwVisible === "true" ? "" : "true" }))}
                      style={{
                        position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer", fontSize: "0.85rem", color: "#666", padding: "0.25rem",
                      }}
                    >
                      {dataFields._pwVisible === "true" ? "🙈" : "👁️"}
                    </button>
                  </div>
                  <button
                    onClick={() => handleGeneratePassword("password")}
                    style={{
                      padding: "0.5rem 0.75rem", background: "#3498db", color: "#fff",
                      border: "none", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem", whiteSpace: "nowrap", lineHeight: 1,
                    }}
                  >
                    {t("vault.edit.generate")}
                  </button>
                </div>
              </div>
            </>
          )}

          {itemType === "account" && (
            <>
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>{t("vault.edit.usernameEmail")}</label>
                <input
                  type="text"
                  value={dataFields.username || ""}
                  onChange={(e) => setDataFields((p) => ({ ...p, username: e.target.value }))}
                  placeholder={t("vault.edit.usernameEmailPlaceholder")}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>{t("vault.edit.password")}</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      type={dataFields._pwVisible === "true" ? "text" : "password"}
                      value={dataFields.password || ""}
                      onChange={(e) => setDataFields((p) => ({ ...p, password: e.target.value }))}
                      placeholder={t("vault.edit.passwordPlaceholder")}
                      style={{ width: "100%", padding: "0.5rem 2rem 0.5rem 0.5rem", border: "1px solid #ddd", borderRadius: 8, fontSize: "0.95rem", boxSizing: "border-box" }}
                    />
                    <button
                      onClick={() => setDataFields((p) => ({ ...p, _pwVisible: p._pwVisible === "true" ? "" : "true" }))}
                      style={{
                        position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer", fontSize: "0.85rem", color: "#666", padding: "0.25rem",
                      }}
                    >
                      {dataFields._pwVisible === "true" ? "🙈" : "👁️"}
                    </button>
                  </div>
                  <button
                    onClick={() => handleGeneratePassword("password")}
                    style={{
                      padding: "0.5rem 0.75rem", background: "#3498db", color: "#fff",
                      border: "none", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem", whiteSpace: "nowrap", lineHeight: 1,
                    }}
                  >
                    {t("vault.edit.generate")}
                  </button>
                </div>
              </div>
            </>
          )}

          {itemType === "file" && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setSelectedFile(file);
                }}
                style={{ display: "none" }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: "100%", padding: "0.75rem",
                  background: "#f5f5f5", border: "2px dashed #ddd", borderRadius: 8,
                  cursor: "pointer", fontSize: "0.9rem", color: "#666",
                  textAlign: "center",
                }}
              >
                {selectedFile
                  ? t("vault.edit.fileSelected", { name: selectedFile.name, size: formatFileSize(selectedFile.size) })
                  : t("vault.edit.chooseFile")}
              </button>
            </div>
          )}
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: "100%", padding: "0.75rem",
            background: saving ? "#95a5a6" : "#0f3460", color: "#fff",
            border: "none", borderRadius: 8, fontSize: "1rem", fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? t("common.saving") : t("vault.edit.save")}
        </button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AppLayout>
  );
}
