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
import { ChangePasswordPage } from "../pages/settings/ChangePasswordPage";
import { ExportBackupPage } from "../pages/settings/ExportBackupPage";
import { ImportBackupPage } from "../pages/settings/ImportBackupPage";

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
        path="/settings/change-password"
        element={
          <AuthGuard>
            <ChangePasswordPage />
          </AuthGuard>
        }
      />
      <Route
        path="/settings/export"
        element={
          <AuthGuard>
            <ExportBackupPage />
          </AuthGuard>
        }
      />
      <Route
        path="/settings/import"
        element={
          <AuthGuard>
            <ImportBackupPage />
          </AuthGuard>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
