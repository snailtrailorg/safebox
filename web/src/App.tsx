import { BrowserRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { VaultProvider } from "./context/VaultContext";
import { AppRoutes } from "./routes";

function IndexedDBWarning() {
  const { t } = useTranslation();
  const { dbUnavailable } = useAuth();
  if (!dbUnavailable) return null;
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      background: "#e74c3c", color: "#fff", textAlign: "center",
      padding: "0.75rem 1rem", fontSize: "0.9rem", fontWeight: 500,
    }}>
      {t("app.indexeddbWarning")}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <VaultProvider>
          <IndexedDBWarning />
          <AppRoutes />
        </VaultProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
