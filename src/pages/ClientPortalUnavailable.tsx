import { useAuth } from "../auth/AuthProvider";

/**
 * Shown when a client signs in successfully but the statement is not open yet.
 *
 * This page carries one obligation: never imply the reader has no passes. It is
 * here precisely because the alternative — a statement rendering zeros from an
 * empty query — would tell them something untrue about their own account.
 */
export function ClientPortalUnavailable() {
  const { viewer } = useAuth();

  return (
    <div className="page">
      <div className="card" style={{ maxWidth: 620, margin: "0 auto" }}>
        <div className="card-pad">
          <header className="page-head" style={{ marginBottom: 14 }}>
            <h1 style={{ fontSize: 22 }}>Your boarding passes aren't viewable yet</h1>
          </header>

          <p style={{ color: "var(--ink-2)", marginTop: 0 }}>
            {viewer ? `You're signed in as ${viewer.email}. ` : ""}
            Your passes <strong>are being tracked</strong> — every qualifying activity is
            recorded against your account, and nothing is lost while this page is closed.
            We just haven't opened the client view yet.
          </p>

          <p style={{ color: "var(--ink-2)" }}>
            Your financial consultant can see your full pass count and how you earned each
            one, so ask them for your current standing at any time. We'll be in touch when
            you can check it here yourself.
          </p>

          <div className="alert info" style={{ marginTop: 20, marginBottom: 0 }}>
            You'll still be entered into every monthly draw you qualify for. This page
            being closed has no effect on your passes or your entries.
          </div>
        </div>
      </div>
    </div>
  );
}
