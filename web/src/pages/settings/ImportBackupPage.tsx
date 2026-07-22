/**
 * ImportBackupPage - 导入加密备份
 */
import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "../../components/layout/AppLayout";
import { Toast } from "../../components/ui/Toast";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { importBackup } from "../../utils/backup";

export function ImportBackupPage() {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" | "success" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => { fileInputRef.current?.click(); };
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!password) { setToast({ message: t("settings.importPasswordPrompt"), type: "error" }); return; }
    setImporting(true);
    try {
      const count = await importBackup(password, file);
      setToast({ message: t("settings.imported", { count }), type: "success" });
      setPassword("");
    } catch (e: any) {
      setToast({ message: e.message || t("settings.importFailed"), type: "error" });
    } finally {
      setImporting(false);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <AppLayout title={t("settings.importBackup")}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <section style={{ background: "#fff", borderRadius: 10, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
          <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "1rem", lineHeight: 1.6 }}>{t("settings.importDescription")}</p>
          <PasswordInput label={t("settings.importPasswordPrompt")} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("settings.importPasswordPrompt")} />
          <input ref={fileInputRef} type="file" accept=".safebox" onChange={handleImportFile} style={{ display: "none" }} />
          <button onClick={handleImportClick} disabled={importing} style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem", background: importing ? "#95a5a6" : "#0f3460", color: "#fff", border: "none", borderRadius: 8, fontSize: "0.95rem", fontWeight: 600, cursor: importing ? "not-allowed" : "pointer" }}>
            {importing ? t("common.importing") : t("settings.importBackup")}
          </button>
        </section>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </AppLayout>
  );
}
