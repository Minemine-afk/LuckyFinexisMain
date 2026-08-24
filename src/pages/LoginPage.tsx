import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { homePathFor, useAuth } from "../auth/AuthProvider";
import { Alert, Loading } from "../components/Loading";
import { PlaneIcon } from "../components/Icons";
import { DEMO_ACCOUNTS } from "../data/mockApi";
import { USE_MOCK } from "../data";

const ROLE_LABEL: Record<string, string> = {
  client: "Client",
  advisor: "Consultant",
  admin: "Admin",
};

/**
 * One sign-in form for all three roles. Which portal you land on is decided by
 * the role on your profile, not by which form you used, so there is no way to
 * reach the advisor view by picking the advisor tab.
 */
export function LoginPage() {
  const { viewer, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading label="Checking your sign-in…" />;
  if (viewer) return <Navigate to={location.state?.from ?? homePathFor(viewer)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await signIn(email, password);
      navigate(location.state?.from ?? homePathFor(next), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign you in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <span className="mark">
          <PlaneIcon size={22} />
        </span>
        <h1>Sign in</h1>
        <p className="sub">
          Clients and financial consultants both sign in here. You will be taken to your
          own view of the campaign.
        </p>

        {error && <Alert kind="err">{error}</Alert>}

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="btn" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {USE_MOCK && (
          <div className="demo-accounts">
            <h2>Demo accounts — pick one</h2>
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => {
                  setEmail(a.email);
                  setPassword(a.password);
                  setError(null);
                }}
              >
                <span>
                  <strong style={{ color: "var(--ink)" }}>{a.name}</strong>
                  <br />
                  <span className="mono">{a.email}</span>
                </span>
                <span className="badge blue">{ROLE_LABEL[a.role] ?? a.role}</span>
              </button>
            ))}
            <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "8px 0 0" }}>
              Any password works in demo mode.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
