/**
 * ExportBackupPage - 导出加密备份
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "../../components/layout/AppLayout";
import { Toast } from "../../components/ui/Toast";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { exportBackup } from "../../utils/backup";

export function ExportBackupPage() {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);

  const handleExport = async () => {
    if (!password) { setToast({ message: t("settings.backupPasswordPrompt"), type: "error" }); return; }
    setExporting(true);
    try {
      await exportBackup(password);
      setToast({ message: t("settings.backupDownloaded"), type: "success" });
      setPassword("");
    } catch (e: any) {
      setToast({ message: e.message || t("settings.exportFailed"), type: "error" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppLayout title={t("settings.exportBackup")}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <section style={{ background: "#fff", borderRadius: 10, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
          <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "1rem", lineHeight: 1.6 }}>{t("settings.exportDescription")}</p>
          <PasswordInput label={t("settings.backupPasswordPrompt")} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("settings.backupPasswordPrompt")} />
          <button onClick={handleExport} disabled={exporting} style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: exporting ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "0.95rem", fontWeight: 600, cursor: exporting ? "not-allowed" : "pointer" }}>
            {exporting ? t("common.exporting") : t("settings.exportBackup")}
          </button>
        </section>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AppLayout>
  );
}
