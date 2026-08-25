import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, homePathFor, useAuth } from "./auth/AuthProvider";
import { RequireRole } from "./auth/RequireRole";
import { AppShell } from "./components/AppShell";
import { Loading } from "./components/Loading";
import { AdminPage } from "./pages/AdminPage";
import { AdvisorPage } from "./pages/AdvisorPage";
import { LoginPage } from "./pages/LoginPage";

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

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
