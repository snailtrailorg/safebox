import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "../../components/layout/AppLayout";
import { getItem, softDeleteItem } from "../../db/itemsStore";
import { keyManager } from "../../services/keyManager";
import type { Item } from "../../types/domain";

const TYPE_LABELS: Record<string, string> = {
  android: "Android 应用",
  account: "通用账户",
  file: "本地文件",
};

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
  const { did } = useParams<{ did: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSensitive, setShowSensitive] = useState(false);
  const [decryptedData, setDecryptedData] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    (async () => {
      if (!did) return;
      const found = await getItem(parseInt(did));
      setItem(found || null);
      setLoading(false);
    })();
  }, [did]);

  const handleShowSensitive = async () => {
    if (!item?.data) return;
    setShowSensitive(!showSensitive);
    if (!showSensitive && !decryptedData) {
      try {
        const plain = await keyManager.decryptItemData(item.data);
        if (plain) {
          setDecryptedData(JSON.parse(plain));
        } else {
          // 未加密的兼容路径
          setDecryptedData(JSON.parse(item.data));
        }
      } catch {
        // 直接显示原始 data
        try {
          setDecryptedData(JSON.parse(item.data));
        } catch {
          setDecryptedData({ raw: item.data });
        }
      }
    }
  };

  const handleDelete = async () => {
    if (!item?.did || !confirm("确定删除？")) return;
    await softDeleteItem(item.did);
    navigate("/");
  };

  if (loading) {
    return <AppLayout title="加载中…"><p style={{ textAlign: "center", padding: "3rem", color: "#666" }}>加载中…</p></AppLayout>;
  }

  if (!item) {
    return <AppLayout title="未找到"><p style={{ textAlign: "center", padding: "3rem", color: "#666" }}>条目不存在</p></AppLayout>;
  }

  return (
    <AppLayout
      title="详情"
      actions={
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={() => navigate(`/item/${did}/edit`)}
            style={{
              background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
              padding: "0.4rem 0.8rem", borderRadius: 6, cursor: "pointer", fontSize: "0.85rem",
            }}
          >
            ✏️ 编辑
          </button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* 类型标签 */}
        <div style={{ display: "inline-flex" }}>
          <span style={{
            background: "#0f3460", color: "#fff",
            padding: "0.25rem 0.75rem", borderRadius: 20,
            fontSize: "0.8rem", fontWeight: 500,
          }}>
            {TYPE_LABELS[item.type] || item.type}
          </span>
        </div>

        {/* 名称 */}
        <div style={{
          background: "#fff", borderRadius: 10, padding: "1.25rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}>
          <div style={{ fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>名称</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "#333" }}>{item.name}</div>
        </div>

        {/* 描述 */}
        {item.description && (
          <div style={{
            background: "#fff", borderRadius: 10, padding: "1.25rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}>
            <div style={{ fontSize: "0.8rem", color: "#999", marginBottom: "0.25rem" }}>备注</div>
            <div style={{ fontSize: "0.95rem", color: "#555" }}>{item.description}</div>
          </div>
        )}

        {/* 敏感数据 */}
        {item.data && (
          <div style={{
            background: "#fff", borderRadius: 10, padding: "1.25rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}>
            <div style={{ fontSize: "0.8rem", color: "#999", marginBottom: "0.5rem" }}>敏感信息</div>
            {!showSensitive ? (
              <button
                onMouseDown={handleShowSensitive}
                onMouseUp={handleShowSensitive}
                onTouchStart={handleShowSensitive}
                onTouchEnd={handleShowSensitive}
                style={{
                  width: "100%", padding: "1rem",
                  background: "#f5f5f5", border: "2px dashed #ddd",
                  borderRadius: 8, cursor: "pointer",
                  fontSize: "0.9rem", color: "#666",
                }}
              >
                👆 按住查看敏感信息
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

        {/* 删除 */}
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
          🗑️ 删除条目
        </button>
      </div>
    </AppLayout>
  );
}
