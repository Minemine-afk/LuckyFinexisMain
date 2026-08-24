import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import type { Role } from "../lib/types";
import { homePathFor, useAuth } from "./AuthProvider";
import { Loading } from "../components/Loading";

/**
 * Route guard. This is a convenience, not a security boundary — the database's
 * row level security is what actually stops one role reading another's data.
 * Sending an advisor away from /admin here just avoids showing them a page of
 * failed queries.
 */
export function RequireRole({
  roles,
  children,
}: {
  roles: Role[];
  children: ReactNode;
}) {
  const { viewer, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Checking your sign-in…" />;
  if (!viewer) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!roles.includes(viewer.role)) return <Navigate to={homePathFor(viewer)} replace />;

  return <>{children}</>;
}
