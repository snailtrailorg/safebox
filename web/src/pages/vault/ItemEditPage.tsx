import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "../../components/layout/AppLayout";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { Toast } from "../../components/ui/Toast";
import { useVault } from "../../context/VaultContext";
import { getItem } from "../../db/itemsStore";
import { keyManager } from "../../services/keyManager";
import { generatePassword } from "../../utils/password";
import type { Item, ItemType } from "../../types/domain";

const ITEM_TYPES: ItemType[] = ["android", "account", "file"];

const TYPE_LABELS: Record<ItemType, string> = {
  android: "Android 应用",
  account: "通用账户",
  file: "本地文件",
};

export function ItemEditPage() {
  const { did, type } = useParams<{ did?: string; type?: string }>();
  const navigate = useNavigate();
  const { saveItem } = useVault();
  const isEdit = did && did !== "0";

  const [itemType, setItemType] = useState<ItemType>((type as ItemType) || "account");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataFields, setDataFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  // 加载已有条目
  useEffect(() => {
    if (isEdit && did) {
      setLoading(true);
      getItem(parseInt(did)).then(async (item) => {
        if (item) {
          setItemType(item.type);
          setName(item.name);
          setDescription(item.description || "");
          // 尝试解密 data
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
      setToast({ message: "请输入名称", type: "error" });
      return;
    }
    setSaving(true);
    try {
      const dataJson = JSON.stringify(dataFields);
      const encrypted = await keyManager.encryptItemData(dataJson);

      const item: Item = {
        did: isEdit && did ? parseInt(did) : 0,
        uid: 1, // TODO
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
      setToast({ message: "已保存", type: "success" });
      setTimeout(() => navigate(`/item/${savedDid}`), 500);
    } catch (e: any) {
      setToast({ message: e.message || "保存失败", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePassword = (field: string) => {
    setDataFields((prev) => ({ ...prev, [field]: generatePassword() }));
  };

  if (loading) {
    return <AppLayout title="加载中…"><p style={{ textAlign: "center", padding: "3rem", color: "#666" }}>加载中…</p></AppLayout>;
  }

  return (
    <AppLayout title={isEdit ? "编辑条目" : "新建条目"}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* 类型选择（新建时） */}
        {!isEdit && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {ITEM_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setItemType(t)}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: 20,
                  border: itemType === t ? "2px solid #0f3460" : "1px solid #ddd",
                  background: itemType === t ? "#0f3460" : "#fff",
                  color: itemType === t ? "#fff" : "#333",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                }}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        )}

        {/* 名称 */}
        <div style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>名称 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入条目名称"
            style={{
              width: "100%", padding: "0.6rem 0",
              border: "none", borderBottom: "1px solid #eee",
              fontSize: "1rem", outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* 备注 */}
        <div style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>备注</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="可选备注"
            style={{
              width: "100%", padding: "0.6rem 0",
              border: "none", borderBottom: "1px solid #eee",
              fontSize: "1rem", outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* 类型特定字段 */}
        <div style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          {itemType === "android" && (
            <>
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>包名</label>
                <input
                  type="text"
                  value={dataFields.package || ""}
                  onChange={(e) => setDataFields((p) => ({ ...p, package: e.target.value }))}
                  placeholder="com.example.app"
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #ddd", borderRadius: 6, fontSize: "0.95rem", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>用户名</label>
                <input
                  type="text"
                  value={dataFields.username || ""}
                  onChange={(e) => setDataFields((p) => ({ ...p, username: e.target.value }))}
                  placeholder="用户名"
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #ddd", borderRadius: 6, fontSize: "0.95rem", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <PasswordInput
                  label="密码"
                  value={dataFields.password || ""}
                  onChange={(e) => setDataFields((p) => ({ ...p, password: e.target.value }))}
                  placeholder="密码"
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => handleGeneratePassword("password")}
                  style={{
                    padding: "0.5rem 0.75rem", background: "#3498db", color: "#fff",
                    border: "none", borderRadius: 6, cursor: "pointer", fontSize: "0.85rem", whiteSpace: "nowrap",
                  }}
                >
                  🎲 生成
                </button>
              </div>
            </>
          )}

          {itemType === "account" && (
            <>
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>用户名/邮箱</label>
                <input
                  type="text"
                  value={dataFields.username || ""}
                  onChange={(e) => setDataFields((p) => ({ ...p, username: e.target.value }))}
                  placeholder="user@email.com"
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #ddd", borderRadius: 6, fontSize: "0.95rem", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <PasswordInput
                    label="密码"
                    value={dataFields.password || ""}
                    onChange={(e) => setDataFields((p) => ({ ...p, password: e.target.value }))}
                    placeholder="密码"
                    style={{ flex: 1 }}
                  />
                  <button
                    onClick={() => handleGeneratePassword("password")}
                    style={{
                      padding: "0.5rem 0.75rem", background: "#3498db", color: "#fff",
                      border: "none", borderRadius: 6, cursor: "pointer", fontSize: "0.85rem", whiteSpace: "nowrap",
                    }}
                  >
                    🎲 生成
                  </button>
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>网址</label>
                <input
                  type="url"
                  value={dataFields.url || ""}
                  onChange={(e) => setDataFields((p) => ({ ...p, url: e.target.value }))}
                  placeholder="https://example.com"
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #ddd", borderRadius: 6, fontSize: "0.95rem", boxSizing: "border-box" }}
                />
              </div>
            </>
          )}

          {itemType === "file" && (
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>文件路径</label>
              <input
                type="text"
                value={dataFields.path || ""}
                onChange={(e) => setDataFields((p) => ({ ...p, path: e.target.value }))}
                placeholder="/path/to/file"
                style={{ width: "100%", padding: "0.5rem", border: "1px solid #ddd", borderRadius: 6, fontSize: "0.95rem", boxSizing: "border-box" }}
              />
            </div>
          )}
        </div>

        {/* 保存 */}
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
          {saving ? "保存中…" : "💾 保存"}
        </button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AppLayout>
  );
}
