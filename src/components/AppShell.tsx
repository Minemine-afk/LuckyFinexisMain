import { useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { homePathFor, useAuth } from "../auth/AuthProvider";
import { USE_MOCK } from "../data";
import { ErrorBoundary } from "./ErrorBoundary";
import { MOCK_REASON } from "../lib/supabase";
import {
  BellIcon,
  CalendarIcon,
  DollarIcon,
  GiftIcon,
  InfoIcon,
  NetworkIcon,
  SignOutIcon,
  TrophyIcon,
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
  const location = useLocation();

  if (!viewer) return <>{children}</>;

  const home = homePathFor(viewer);

  const endSession = () => {
    void signOut().then(() => navigate("/login", { replace: true }));
  };

  const placeholders = [
    { key: "alerts", label: "Notifications", icon: <BellIcon /> },
    { key: "events", label: "Events", icon: <CalendarIcon /> },
    { key: "commissions", label: "Commissions", icon: <DollarIcon /> },
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

          {/* One trophy each, leading to the two ends of the same thing: the
              admin records a result, everyone else reads it. */}
          <button
            type="button"
            className="rail-btn"
            title={viewer.role === "admin" ? "Record a draw" : "Past winners"}
            onClick={() => navigate(viewer.role === "admin" ? "/admin/draws" : "/winners")}
          >
            <TrophyIcon />
            <span className="sr-only">
              {viewer.role === "admin" ? "Record a draw" : "Past winners"}
            </span>
          </button>

          <button
            type="button"
            className="rail-btn"
            title="Your account"
            onClick={() => navigate("/profile")}
          >
            <UserIcon />
            <span className="sr-only">Your account</span>
          </button>

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
            onClick={endSession}
          >
            <SignOutIcon />
            <span className="sr-only">Sign out</span>
          </button>
        </nav>

        <main>
          {/* The rail's sign-out icon is unlabelled, which makes ending a
              session something you have to already know how to do. Supabase
              keeps you signed in across visits, so there has to be an obvious
              way out — and seeing which account you are in answers the question
              that usually prompts looking for it. */}
          <div className="accountbar">
            <span className="who">
              Signed in as <b>{viewer.fullName}</b>
              <span className="sep"> · </span>
              <span className="mail">{viewer.email}</span>
            </span>
            <button type="button" className="btn-ghost" onClick={endSession}>
              <SignOutIcon size={15} />
              Sign out
            </button>
          </div>
          {/* Inside the shell, so a page that throws leaves the rail, the
              account bar and sign-out working — on a shared machine, still
              being able to sign out matters more than a tidier error page.

              Keyed on the path because React does not clear a boundary's error
              state when the route changes: without this, navigating away would
              carry the error with you and the way out would not be a way out. */}
          <ErrorBoundary key={location.pathname}>{children}</ErrorBoundary>
        </main>
      </div>
    </>
  );
}
