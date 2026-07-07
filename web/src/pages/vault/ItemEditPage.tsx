/**
 * ItemEditPage — 新建/编辑条目
 *
 * 新建时显示类型选择器（radio 横排），选中后下方显示对应的字段模板。
 * 编辑时跳过类型选择。
 */
import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "../../components/layout/AppLayout";
import { Toast } from "../../components/ui/Toast";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { useVault } from "../../context/VaultContext";
import { getItem, saveFileBlob } from "../../db/itemsStore";
import { getCurrentUserId } from "../../db/sessionStore";
import { keyChain } from "../../keychain/keyChain";
import { generatePassword } from "../../utils/password";
import { formatFileSize } from "../../utils/format";
import { buildItemTypeConfigs } from "../../config/itemTypes";
import type { Item, ItemType } from "../../types/domain";

export function ItemEditPage() {
  const { t } = useTranslation();
  const { did, type } = useParams<{ did?: string; type?: string }>();
  const navigate = useNavigate();
  const { saveItem } = useVault();
  const isEdit = did && did !== "0";
  const configs = buildItemTypeConfigs(t);

  const [itemType, setItemType] = useState<ItemType>((type as ItemType) || "login");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataFields, setDataFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pwVisible, setPwVisible] = useState<Record<string, boolean>>({});

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
              const plain = await keyChain.decryptItemData(item.data);
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

  const currentConfig = configs.find((c) => c.type === itemType);

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
      let pendingFileEncrypted: string | null = null;
      if (itemType === "file" && selectedFile) {
        const fileBuffer = await selectedFile.arrayBuffer();
        const encrypted = await keyChain.encryptFileBlob(fileBuffer);
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

      const dataJson = JSON.stringify(dataFields);
      const encrypted = await keyChain.encryptItemData(dataJson);

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

  if (loading) {
    return <AppLayout title={t("common.loading")}><p style={{ textAlign: "center", padding: "3rem", color: "#666" }}>{t("common.loading")}</p></AppLayout>;
  }

  return (
    <AppLayout title={isEdit ? t("vault.edit.titleEdit") : t("vault.edit.titleNew")}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* 类型选择器 — 只有新建时显示 */}
        {!isEdit && (
          <section style={{
            background: "#fff", borderRadius: 10, padding: "1.25rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}>
            <div style={{ fontSize: "0.8rem", color: "#999", marginBottom: "0.5rem", fontWeight: 500 }}>
              {t("vault.edit.selectType")}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {configs.map((cfg) => (
                <label
                  key={cfg.type}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.3rem",
                    padding: "0.4rem 0.75rem",
                    borderRadius: 20,
                    border: itemType === cfg.type ? "2px solid #0f3460" : "1px solid #ddd",
                    background: itemType === cfg.type ? "#f0f4ff" : "#fff",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    fontWeight: itemType === cfg.type ? 600 : 400,
                    color: "#333",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="radio"
                    name="itemType"
                    checked={itemType === cfg.type}
                    onChange={() => {
                      setItemType(cfg.type);
                      setDataFields({});
                      setSelectedFile(null);
                    }}
                    style={{ display: "none" }}
                  />
                  <span>{cfg.icon}</span>
                  <span>{cfg.label}</span>
                </label>
              ))}
            </div>
            {currentConfig && (
              <div style={{
                marginTop: "0.5rem",
                fontSize: "0.8rem", color: "#888",
                lineHeight: 1.4,
              }}>
                {currentConfig.hint}
              </div>
            )}
          </section>
        )}

        {/* 名称 */}
        <section style={{
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
        </section>

        {/* 备注 */}
        <section style={{
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
        </section>

        {/* 字段卡片（按类型动态渲染） */}
        {currentConfig && currentConfig.fields.length > 0 && (
          <section style={{
            background: "#fff", borderRadius: 10, padding: "1.25rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}>
            {currentConfig.fields.map((field) => {
              if (field.type === "file") {
                return (
                  <div key={field.key}>
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
                );
              }

              if (field.type === "textarea") {
                return (
                  <div key={field.key} style={{ marginBottom: "0" }}>
                    <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>
                      {field.label}
                    </label>
                    <textarea
                      value={dataFields[field.key] || ""}
                      onChange={(e) => setDataFields((p) => ({ ...p, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      style={{
                        width: "100%", padding: "0.5rem", border: "1px solid #ddd", borderRadius: 8,
                        fontSize: "0.95rem", fontFamily: "inherit", boxSizing: "border-box",
                        resize: "vertical", minHeight: 120,
                      }}
                    />
                  </div>
                );
              }

              return (
                <div key={field.key} style={{ marginBottom: "0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ position: "relative", flex: 1 }}>
                      <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>
                        {field.label}{field.optional ? ` (${t("common.optional")})` : ""}
                      </label>
                      {field.type === "password" ? (
                        <input
                          type={pwVisible[field.key] ? "text" : "password"}
                          value={dataFields[field.key] || ""}
                          onChange={(e) => setDataFields((p) => ({ ...p, [field.key]: e.target.value }))}
                          placeholder={field.placeholder}
                          style={{
                            width: "100%", padding: "0.5rem 2rem 0.5rem 0.5rem",
                            border: "1px solid #ddd", borderRadius: 8,
                            fontSize: "0.95rem", boxSizing: "border-box",
                          }}
                        />
                      ) : (
                        <input
                          type={field.type}
                          value={dataFields[field.key] || ""}
                          onChange={(e) => setDataFields((p) => ({ ...p, [field.key]: e.target.value }))}
                          placeholder={field.placeholder}
                          style={{
                            width: "100%", padding: "0.5rem",
                            border: "1px solid #ddd", borderRadius: 8,
                            fontSize: "0.95rem", boxSizing: "border-box",
                          }}
                        />
                      )}
                      <div style={{ position: "absolute", right: 0, top: "1.6rem", display: "flex", gap: "0.25rem" }}>
                        {field.type === "password" && (
                          <button
                            onClick={() => setPwVisible((pv) => ({ ...pv, [field.key]: !pv[field.key] }))}
                            style={{
                              background: "none", border: "none", cursor: "pointer",
                              fontSize: "0.85rem", color: "#666", padding: "0.5rem 0.25rem",
                            }}
                          >
                            {pwVisible[field.key] ? "🙈" : "👁️"}
                          </button>
                        )}
                        {field.enableGenerate && (
                          <button
                            onClick={() => setDataFields((p) => ({ ...p, [field.key]: generatePassword() }))}
                            style={{
                              padding: "0.5rem 0.5rem", background: "#3498db", color: "#fff",
                              border: "none", borderRadius: 8, cursor: "pointer",
                              fontSize: "0.85rem", whiteSpace: "nowrap",
                            }}
                          >
                            {t("vault.edit.generate")}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* 保存按钮 */}
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
