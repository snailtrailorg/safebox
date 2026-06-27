import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { VaultProvider } from "./context/VaultContext";
import { AppRoutes } from "./routes";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <VaultProvider>
          <AppRoutes />
        </VaultProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
