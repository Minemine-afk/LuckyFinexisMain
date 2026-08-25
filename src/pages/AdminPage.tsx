import { useRef, useState } from "react";
import { Alert, Loading } from "../components/Loading";
import { UploadIcon } from "../components/Icons";
import { USE_MOCK, api } from "../data";
import { resetMockLedger } from "../data/mockApi";
import { OPTIONAL_HEADERS, REQUIRED_HEADERS, type UploadPreview } from "../lib/ingest";
import { shortDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const COLUMN_HELP: Record<string, string> = {
  client_ref: "The firm's client code. Must already exist in the client list.",
  activity_code: "Which qualifying activity, e.g. attend_client_event.",
  units: "How many — cases, referrals, events, guests. A whole number above zero.",
  earned_on: "Date the activity happened, YYYY-MM-DD.",
  fc_code: "Consultant code. Informational; the client's own record decides who sees them.",
  client_name: "Only used in the preview, to make a bad client_ref obvious.",
  client_email: "Ignored on import — client contact details are edited on the client record.",
  client_mobile: "Ignored on import, as above.",
  reference: "Policy number, referral name, event name. Two rows for the same client, activity and date need different references to count twice.",
  draw_month: "YYYY-MM. Defaults to the month of earned_on; use it to defer a pass to a later draw.",
  status: "valid (default), pending, or void.",
  void_reason: "Why a void pass was withdrawn.",
};

const TEMPLATE = [
  "client_ref,activity_code,units,earned_on,reference,status",
  "C-1001,attend_client_event,1,2026-09-12,Q3 portfolio briefing,valid",
  "C-1001,bring_guest_to_event,2,2026-09-12,Q3 portfolio briefing,valid",
  "C-1002,purchase_qualifying_product,1,2026-09-03,POL-88410,pending",
].join("\n");

/**
 * Campaign data administration.
 *
 * Uploading is deliberately two steps: the file is validated and reported on
 * first, and nothing is written until the numbers are confirmed. A mis-mapped
 * column shows up as a page of rejected rows instead of a month of wrong
 * pass counts.
 */
export function AdminPage() {
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const campaign = useAsync(() => api.getCampaign(), []);

  async function choose(file: File | undefined) {
    if (!file || !campaign.data) return;
    setBusy(true);
    setError(null);
    setDone(null);
    setPreview(null);
    try {
      setPreview(await api.previewUpload(file, campaign.data.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview || !campaign.data) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.commitUpload(preview, campaign.data.id);
      setDone(
        `${result.inserted} pass ${result.inserted === 1 ? "event" : "events"} added. ` +
          `${result.skipped} row${result.skipped === 1 ? "" : "s"} skipped.`,
      );
      setPreview(null);
      if (fileInput.current) fileInput.current.value = "";
      campaign.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;

  if (campaign.loading) return <Loading label="Loading the campaign…" />;
  if (campaign.error) return <div className="page"><Alert kind="err">{campaign.error}</Alert></div>;
  if (!campaign.data) return null;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Campaign data</h1>
        <p className="sub">
          {campaign.data.name} · {shortDate(campaign.data.startsOn)} to{" "}
          {shortDate(campaign.data.endsOn)} · data as of {shortDate(campaign.data.dataAsOf)}
        </p>
      </header>

      {error && <Alert kind="err">{error}</Alert>}
      {done && <Alert kind="ok">{done}</Alert>}

      {!USE_MOCK && (
        <Alert kind="info">
          <strong>Upload is not connected to this database yet.</strong> The ledger is
          loaded outside the portal for now, and the campaign's rate card uses a column per
          challenge type rather than a row per event — so this importer's format does not
          match it. The screen below still shows the validation rules it would apply.
        </Alert>
      )}

      <div className="card">
        <div className="card-pad">
          <h2 style={{ fontSize: 17, marginBottom: 4 }}>Upload pass activity</h2>
          <p style={{ color: "var(--ink-2)", marginTop: 0 }}>
            Every row is added to the ledger; nothing is replaced. Re-uploading a file you
            have already imported adds nothing, so overlapping exports are safe.
          </p>

          <div
            className={`dropzone${dragging ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void choose(e.dataTransfer.files[0]);
            }}
          >
            <UploadIcon size={26} />
            <div style={{ marginTop: 6 }}>Drop a CSV here, or choose a file</div>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
          </div>

          <p style={{ marginTop: 12, fontSize: 12.5 }}>
            <a href={templateHref} download="campaign-passes-template.csv">
              Download a blank template
            </a>
          </p>

          {busy && !preview && <Loading label="Checking the file…" />}

          {preview && (
            <>
              <div className="stat-row">
                <div className="stat ok">
                  <div className="n">{preview.counts.insert}</div>
                  <div className="k">to add</div>
                </div>
                <div className="stat warn">
                  <div className="n">{preview.counts.duplicate}</div>
                  <div className="k">already recorded</div>
                </div>
                <div className="stat bad">
                  <div className="n">{preview.counts.reject}</div>
                  <div className="k">rejected</div>
                </div>
                <div className="stat">
                  <div className="n">
                    {preview.rows
                      .filter((r) => r.outcome === "insert")
                      .reduce((n, r) => n + r.passes, 0)}
                  </div>
                  <div className="k">passes awarded</div>
                </div>
              </div>

              <div className="tablewrap" style={{ maxHeight: 380, overflowY: "auto" }}>
                <table className="ptable">
                  <thead>
                    <tr>
                      <th scope="col" className="num">Row</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Client</th>
                      <th scope="col">Activity</th>
                      <th scope="col" className="num">Passes</th>
                      <th scope="col">Draw</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={`${r.line}-${r.naturalKey}`}>
                        <td className="num">{r.line}</td>
                        <td>
                          <span className={`rowtag ${r.outcome}`}>{r.outcome}</span>
                        </td>
                        <td className="name">{r.clientName}</td>
                        <td>{r.activityLabel}</td>
                        <td className="num">{r.outcome === "reject" ? "—" : r.passes}</td>
                        <td className="mono">{r.drawMonth || "—"}</td>
                        <td style={{ color: "var(--ink-3)" }}>{r.reason ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  type="button"
                  disabled={busy || preview.counts.insert === 0}
                  onClick={() => void commit()}
                >
                  {busy ? <span className="spinner" /> : null}
                  Add {preview.counts.insert} row
                  {preview.counts.insert === 1 ? "" : "s"} to the ledger
                </button>
                <button
                  className="btn-ghost btn-danger"
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                >
                  Discard
                </button>
              </div>

              {preview.counts.insert === 0 && (
                <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 10 }}>
                  Nothing in this file is new, so there is nothing to commit.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {USE_MOCK && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-pad">
            <h2 style={{ fontSize: 17, marginBottom: 4 }}>Demo data</h2>
            <p style={{ color: "var(--ink-2)", marginTop: 0 }}>
              Uploads are held in this browser only. Reset to put the campaign back to
              the figures the mockups show.
            </p>
            <button
              className="btn-ghost btn-danger"
              type="button"
              onClick={() => {
                resetMockLedger();
                setPreview(null);
                setDone("Demo data reset.");
                if (fileInput.current) fileInput.current.value = "";
              }}
            >
              Reset demo data
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-pad">
          <h2 style={{ fontSize: 17, marginBottom: 10 }}>CSV columns</h2>
          <table className="schema-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Required</th>
                <th>What it is</th>
              </tr>
            </thead>
            <tbody>
              {[...REQUIRED_HEADERS, ...OPTIONAL_HEADERS].map((h) => (
                <tr key={h}>
                  <td className="mono">{h}</td>
                  <td>
                    {(REQUIRED_HEADERS as readonly string[]).includes(h) ? (
                      <span className="badge good">required</span>
                    ) : (
                      <span style={{ color: "var(--ink-3)" }}>optional</span>
                    )}
                  </td>
                  <td>{COLUMN_HELP[h]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 14 }}>
            Column names are matched loosely — <span className="mono">Client Ref</span> and{" "}
            <span className="mono">client_ref</span> both work. A row is considered already
            recorded when its client, activity, date and reference all match one in the
            ledger.
          </p>
        </div>
      </div>
    </div>
  );
}
