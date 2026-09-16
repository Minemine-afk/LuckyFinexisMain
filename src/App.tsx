import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { homePathFor } from "./auth/access";
import { RequireAccess } from "./auth/RequireAccess";
import { AppShell } from "./components/AppShell";
import { Loading } from "./components/Loading";
import { AdminPage } from "./pages/AdminPage";
import { AdvisorPage } from "./pages/AdvisorPage";
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
              <RequireAccess allow={["clients"]}>
                <AppShell>
                  <AdvisorPage />
                </AppShell>
              </RequireAccess>
            }
          />

          <Route
            path="/admin"
            element={
              <RequireAccess allow={["admin"]}>
                <AppShell>
                  <AdminPage />
                </AppShell>
              </RequireAccess>
            }
          />

          {/* Your own account, whichever portal you belong to. */}
          <Route
            path="/profile"
            element={
              <RequireAccess allow={["clients", "admin"]}>
                <AppShell>
                  <ProfilePage />
                </AppShell>
              </RequireAccess>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
