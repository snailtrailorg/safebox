/**
 * 路由定义
 */
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthGuard, GuestGuard } from "./AuthGuard";
import { LoginPage } from "../pages/auth/LoginPage";
import { RegisterPage } from "../pages/auth/RegisterPage";
import { RecoveryPage } from "../pages/auth/RecoveryPage";
import { VaultListPage } from "../pages/vault/VaultListPage";
import { ItemDetailPage } from "../pages/vault/ItemDetailPage";
import { ItemEditPage } from "../pages/vault/ItemEditPage";
import { SettingsPage } from "../pages/settings/SettingsPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestGuard>
            <LoginPage />
          </GuestGuard>
        }
      />
      <Route
        path="/register"
        element={
          <GuestGuard>
            <RegisterPage />
          </GuestGuard>
        }
      />
      <Route
        path="/recovery"
        element={
          <GuestGuard>
            <RecoveryPage />
          </GuestGuard>
        }
      />
      <Route
        path="/"
        element={
          <AuthGuard>
            <VaultListPage />
          </AuthGuard>
        }
      />
      <Route
        path="/item/:did"
        element={
          <AuthGuard>
            <ItemDetailPage />
          </AuthGuard>
        }
      />
      <Route
        path="/item/:did/edit"
        element={
          <AuthGuard>
            <ItemEditPage />
          </AuthGuard>
        }
      />
      <Route
        path="/item/new/:type"
        element={
          <AuthGuard>
            <ItemEditPage />
          </AuthGuard>
        }
      />
      <Route
        path="/settings"
        element={
          <AuthGuard>
            <SettingsPage />
          </AuthGuard>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
