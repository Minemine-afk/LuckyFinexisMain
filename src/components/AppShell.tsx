import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { homePathFor, useAuth } from "../auth/AuthProvider";
import { USE_MOCK } from "../data";
import { MOCK_REASON } from "../lib/supabase";
import {
  BellIcon,
  CalendarIcon,
  DollarIcon,
  GiftIcon,
  InfoIcon,
  NetworkIcon,
  SignOutIcon,
  UploadIcon,
  UserIcon,
} from "./Icons";

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

/**
 * The left icon rail from the mockup. Only the campaign icon (and, for admins,
 * the upload icon) leads anywhere — the rest are the surrounding product's
 * navigation, shown so the page sits in its real context but explicitly
 * disabled rather than wired to dead routes.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { viewer, signOut } = useAuth();
  const navigate = useNavigate();

  if (!viewer) return <>{children}</>;

  const home = homePathFor(viewer);
  const placeholders = [
    { key: "alerts", label: "Notifications", icon: <BellIcon /> },
    { key: "events", label: "Events", icon: <CalendarIcon /> },
    { key: "commissions", label: "Commissions", icon: <DollarIcon /> },
    { key: "profile", label: "Profile", icon: <UserIcon /> },
    { key: "network", label: "Network", icon: <NetworkIcon /> },
  ];

  return (
    <>
      {USE_MOCK && (
        <div className="demo-banner">
          <InfoIcon />
          <span>
            <strong>Demo data.</strong> No backend is connected — every figure below is
            invented and every sign-in is local to this browser tab.
            {MOCK_REASON && (
              <>
                {" "}
                Cause: <code>{MOCK_REASON}</code>.
              </>
            )}
          </span>
        </div>
      )}

      <div className="shell">
        <nav className="rail" aria-label="Main">
          <span className="avatar" title={viewer.fullName}>
            {initials(viewer.fullName)}
          </span>

          <button
            type="button"
            className="rail-btn"
            aria-current="page"
            title="Campaign"
            onClick={() => navigate(home)}
          >
            <GiftIcon />
            <span className="sr-only">Campaign</span>
          </button>

          {viewer.role === "admin" && (
            <button
              type="button"
              className="rail-btn"
              title="Campaign data"
              onClick={() => navigate("/admin")}
            >
              <UploadIcon />
              <span className="sr-only">Campaign data</span>
            </button>
          )}

          {placeholders.map((p) => (
            <button
              key={p.key}
              type="button"
              className="rail-btn"
              disabled
              title={`${p.label} — not part of this build`}
            >
              {p.icon}
              <span className="sr-only">{p.label}</span>
            </button>
          ))}

          <span className="rail-spacer" />

          <button
            type="button"
            className="rail-btn"
            title={`Sign out (${viewer.email})`}
            onClick={() => {
              void signOut().then(() => navigate("/login", { replace: true }));
            }}
          >
            <SignOutIcon />
            <span className="sr-only">Sign out</span>
          </button>
        </nav>

        <main>{children}</main>
      </div>
    </>
  );
}
