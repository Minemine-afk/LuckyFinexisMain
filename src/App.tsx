import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, homePathFor, useAuth } from "./auth/AuthProvider";
import { RequireRole } from "./auth/RequireRole";
import { AppShell } from "./components/AppShell";
import { Loading } from "./components/Loading";
import { AdminPage } from "./pages/AdminPage";
import { AdvisorPage } from "./pages/AdvisorPage";
import { RecordDrawPage } from "./pages/RecordDrawPage";
import { WinnersPage } from "./pages/WinnersPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";

/** "/" sends you to whichever portal your role owns. */
function HomeRedirect() {
  const { viewer, loading } = useAuth();
  if (loading) return <Loading label="Checking your sign-in…" />;
  return <Navigate to={viewer ? homePathFor(viewer) : "/login"} replace />;
}

function NotFound() {
  return (
    <div className="page">
      <header className="page-head">
        <h1>Page not found</h1>
        <p className="sub">
          That address does not exist. <a href="/">Go back to your campaign</a>.
        </p>
      </header>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<HomeRedirect />} />

          <Route
            path="/clients"
            element={
              <RequireRole roles={["advisor"]}>
                <AppShell>
                  <AdvisorPage />
                </AppShell>
              </RequireRole>
            }
          />

          <Route
            path="/admin"
            element={
              <RequireRole roles={["admin"]}>
                <AppShell>
                  <AdminPage />
                </AppShell>
              </RequireRole>
            }
          />

          {/* Recording a draw is the one action that spends passes, so it is
              the admin's alone. */}
          <Route
            path="/admin/draws"
            element={
              <RequireRole roles={["admin"]}>
                <AppShell>
                  <RecordDrawPage />
                </AppShell>
              </RequireRole>
            }
          />

          {/* Past winners are firm-wide, so both roles read the same page. */}
          <Route
            path="/winners"
            element={
              <RequireRole roles={["advisor", "admin"]}>
                <AppShell>
                  <WinnersPage />
                </AppShell>
              </RequireRole>
            }
          />

          {/* Your own account, whichever portal you belong to. */}
          <Route
            path="/profile"
            element={
              <RequireRole roles={["advisor", "admin"]}>
                <AppShell>
                  <ProfilePage />
                </AppShell>
              </RequireRole>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
