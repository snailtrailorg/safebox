/**
 * DevicesPage - 设备管理（列表 + deauthorize）
 * device_id 绑 access/refresh token；deauthorize 后该设备 access 立即失效（Redis device:revoked TTL 30min）。
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "../../components/layout/AppLayout";
import { Toast } from "../../components/ui/Toast";
import { apiClient } from "../../services/api";
import type { DeviceInfo } from "../../types/api";

export function DevicesPage() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const load = async () => {
    try {
      setDevices(await apiClient.listDevices());
    } catch (e: any) {
      setToast({ message: e.message || "加载失败", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDeauthorize = async (deviceId: string) => {
    if (!confirm("撤销该设备？该设备的登录将立即失效。")) return;
    setRevoking(deviceId);
    try {
      await apiClient.deauthorizeDevice(deviceId);
      setToast({ message: "已撤销", type: "success" });
      await load();
    } catch (e: any) {
      setToast({ message: e.message || "撤销失败", type: "error" });
    } finally {
      setRevoking(null);
    }
  };

  const fmtDate = (iso?: string | null) => {
    if (!iso) return "-";
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  return (
    <AppLayout title="设备管理">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {loading ? (
          <p style={{ textAlign: "center", color: "#999" }}>{t("common.loading")}</p>
        ) : devices.length === 0 ? (
          <p style={{ textAlign: "center", color: "#999" }}>无设备</p>
        ) : (
          devices.map((d) => (
            <section key={d.id} style={{
              background: "#fff", borderRadius: 10, padding: "1rem 1.25rem",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              opacity: d.is_revoked ? 0.6 : 1,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <div>
                  <strong>{d.client_name || d.device_name || "未命名设备"}</strong>
                  {d.os_name && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#666" }}>{d.os_name}</span>}
                  {d.is_current && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#27ae60" }}>当前设备</span>}
                  {d.is_revoked && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#e74c3c" }}>已撤销</span>}
                </div>
                {!d.is_current && !d.is_revoked && (
                  <button
                    onClick={() => handleDeauthorize(d.id)}
                    disabled={revoking === d.id}
                    style={{
                      padding: "0.4rem 0.8rem", background: revoking === d.id ? "#95a5a6" : "#fff",
                      color: "#e74c3c", border: "1px solid #e74c3c", borderRadius: 6,
                      fontSize: "0.8rem", cursor: revoking === d.id ? "not-allowed" : "pointer",
                    }}>
                    {revoking === d.id ? t("common.loading") : "撤销"}
                  </button>
                )}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#999", lineHeight: 1.6 }}>
                {d.last_auth_ip && <div>IP：{d.last_auth_ip}</div>}
                <div>最后活跃：{fmtDate(d.last_active_at)}</div>
                <div>创建：{fmtDate(d.created_at)}</div>
              </div>
            </section>
          ))
        )}
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AppLayout>
  );
}
