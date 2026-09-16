import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { roleLabel } from "../auth/access";
import { Alert } from "../components/Loading";
import { api } from "../data";

/**
 * The signed-in user's own account.
 *
 * Changing the password requires the current one. Supabase will change it on
 * the strength of a session alone, which would make an unattended laptop enough
 * to take a consultant's account away from them — so the re-check happens here.
 *
 * Nothing on this page touches campaign data. It is deliberately the only place
 * in the portal that writes anything, and it writes only to the signed-in
 * user's own auth record.
 */

/** Long enough to be worth having. Supabase's own floor is lower; this wins. */
const MIN_PASSWORD = 12;

export function ProfilePage() {
  const { viewer } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!viewer) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (newPassword.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The two new passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("The new password must be different from the current one.");
      return;
    }

    setBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The password could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Your account</h1>
      </header>

      <div className="account-col">
        <section className="card">
          <div className="card-pad">
            <h2 className="card-title">Details</h2>
            <dl className="detail-list">
              <div>
                <dt>Name</dt>
                <dd>{viewer.fullName}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{roleLabel(viewer)}</dd>
              </div>
              <div>
                <dt>Sign-in email</dt>
                <dd className="mono">{viewer.email}</dd>
              </div>
            </dl>
            <p className="card-note" style={{ margin: "16px 0 0" }}>
              These are set by your administrator. Ask them to change your name or the
              address you sign in with.
            </p>
          </div>
        </section>

        <section className="card">
          <div className="card-pad">
            <h2 className="card-title">Change password</h2>
            <p className="card-note">
              At least {MIN_PASSWORD} characters. Changing it signs you out of other
              browsers and devices.
            </p>

            {error && <Alert kind="err">{error}</Alert>}
            {done && <Alert kind="ok">Your password has been changed.</Alert>}

            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="current-password">Current password</label>
                <input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
                <p className="hint">
                  Asked for so that an unattended screen is not enough to take over
                  this account.
                </p>
              </div>

              <div className="field">
                <label htmlFor="new-password">New password</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="confirm-password">New password again</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              <button className="btn" type="submit" disabled={busy}>
                {busy ? <span className="spinner" /> : null}
                {busy ? "Changing…" : "Change password"}
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
