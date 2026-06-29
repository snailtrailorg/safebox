/**
 * 路由守卫
 */
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import type { ReactNode } from "react";

/** 需要登录才能访问 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { isLoggedIn, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

/** 已登录则重定向到首页 */
export function GuestGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { isLoggedIn, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  if (isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
