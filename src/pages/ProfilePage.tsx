import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Alert } from "../components/Loading";
import { api } from "../data";

/**
 * The signed-in user's own account: the sign-in email, and the password.
 *
 * Both changes require the current password. Supabase will make either on the
 * strength of a session alone, which would make an unattended laptop enough to
 * take a consultant's account away from them — so the re-check happens here.
 *
 * Nothing on this page touches campaign data. It is deliberately the only place
 * in the portal that writes anything.
 */

/** Long enough to be worth having. Supabase's own floor is lower; this wins. */
const MIN_PASSWORD = 12;

const looksLikeEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function ProfilePage() {
  const { viewer } = useAuth();

  const [emailPassword, setEmailPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  if (!viewer) return null;

  async function submitEmail(e: FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setEmailSent(null);

    if (!looksLikeEmail(newEmail)) {
      setEmailError("Enter a valid email address.");
      return;
    }

    setEmailBusy(true);
    try {
      const { sentTo } = await api.changeEmail(emailPassword, newEmail);
      setEmailSent(sentTo);
      setEmailPassword("");
      setNewEmail("");
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "The change could not be saved.");
    } finally {
      setEmailBusy(false);
    }
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwDone(false);

    if (newPassword.length < MIN_PASSWORD) {
      setPwError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("The two new passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setPwError("The new password must be different from the current one.");
      return;
    }

    setPwBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setPwDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "The password could not be changed.");
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Your account</h1>
        <p className="sub">
          Signed in as <b>{viewer.fullName}</b> ·{" "}
          {viewer.role === "admin" ? "Administrator" : "Consultant"}
        </p>
      </header>

      <div className="account-grid">
        <section className="card">
          <div className="card-pad">
            <h2 className="card-title">Sign-in email</h2>
            <p className="card-note">
              This is the address you sign in with. Changing it sends a confirmation
              link — <b>your current address keeps working until you follow it</b>. If
              your Supabase project has secure email change switched on, a link goes to
              your current address too and both have to be confirmed.
            </p>

            {emailError && <Alert kind="err">{emailError}</Alert>}
            {emailSent && (
              <Alert kind="ok">
                Confirmation sent to <b>{emailSent}</b>. Nothing has changed yet.
              </Alert>
            )}

            <form onSubmit={submitEmail} noValidate>
              <div className="field">
                <label htmlFor="current-email">Current email</label>
                <input id="current-email" type="email" value={viewer.email} disabled readOnly />
              </div>

              <div className="field">
                <label htmlFor="new-email">New email</label>
                <input
                  id="new-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="email-password">Your current password</label>
                <input
                  id="email-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                />
                <p className="hint">
                  Asked for because changing the sign-in email changes who can get into
                  this account.
                </p>
              </div>

              <button className="btn" type="submit" disabled={emailBusy}>
                {emailBusy ? <span className="spinner" /> : null}
                {emailBusy ? "Sending…" : "Send confirmation"}
              </button>
            </form>
          </div>
        </section>

        <section className="card">
          <div className="card-pad">
            <h2 className="card-title">Password</h2>
            <p className="card-note">
              Changing your password signs you out of other browsers and devices.
              At least {MIN_PASSWORD} characters.
            </p>

            {pwError && <Alert kind="err">{pwError}</Alert>}
            {pwDone && <Alert kind="ok">Your password has been changed.</Alert>}

            <form onSubmit={submitPassword} noValidate>
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

              <button className="btn" type="submit" disabled={pwBusy}>
                {pwBusy ? <span className="spinner" /> : null}
                {pwBusy ? "Changing…" : "Change password"}
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
