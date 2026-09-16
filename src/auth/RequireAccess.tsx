import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import type { Capability } from "../lib/types";
import { useAuth } from "./AuthProvider";
import { can, homePathFor } from "./access";
import { Loading } from "../components/Loading";

/**
 * Route guard. This is a convenience, not a security boundary — the database's
 * row level security is what actually stops one role reading another's data.
 * Sending a consultant away from /admin here just avoids showing them a page of
 * failed queries.
 *
 * It asks what the viewer *can do*, not what they *are*, and that distinction is
 * the whole point: an account can hold an admin claim and a consultant record at
 * the same time. Gating on a single role name meant granting admin to a
 * practising consultant took their client book away — `/clients` bounced them
 * to `/admin` and there was no way back short of editing the database.
 */
export function RequireAccess({
  allow,
  children,
}: {
  allow: Capability[];
  children: ReactNode;
}) {
  const { viewer, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Checking your sign-in…" />;
  if (!viewer) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!allow.some((c) => can(viewer, c))) return <Navigate to={homePathFor(viewer)} replace />;

  return <>{children}</>;
}
