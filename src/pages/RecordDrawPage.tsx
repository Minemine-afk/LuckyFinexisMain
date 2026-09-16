import { useMemo, useState } from "react";
import { Alert, EmptyState, Loading } from "../components/Loading";
import { api } from "../data";
import { findByMobile, PRIZE_SUGGESTIONS } from "../lib/drawEntry";
import { formatMobile, monthAndYear, passTypeLabel } from "../lib/format";
import { currentDrawMonth } from "../lib/passes";
import { useAsync } from "../lib/useAsync";
import type { Draw } from "../lib/types";
import type { DrawEntrant } from "../data/api";

/**
 * Recording the result of a draw.
 *
 * Draws are run offline; what comes back is a list of mobile numbers and what
 * each person won. This screen is where that list is typed in — and the moment
 * it is saved, every pass in that ballot is spent. Nothing else in the app does
 * that, which is why the button says so in full and why Undo exists.
 */

/** A winner as entered, before it is sent. */
interface Entry {
  clientId: string;
  name: string;
  mobile: string;
  passes: number;
  prize: string;
}

type Lookup =
  | { kind: "idle" }
  | { kind: "ok"; clientId: string; name: string; passes: number }
  | { kind: "error"; message: string };

export function RecordDrawPage() {
  const [drawId, setDrawId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mobile, setMobile] = useState("");
  const [prize, setPrize] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const page = useAsync(async () => {
    const campaign = await api.getCampaign();
    const draws = await api.getDraws(campaign.id);
    return { campaign, draws };
  }, []);

  const draw = page.data?.draws.find((d) => d.id === drawId) ?? null;

  const entrants = useAsync<DrawEntrant[]>(async () => {
    if (!drawId || !page.data) return [];
    return api.getDrawEntrants(page.data.campaign.id, drawId);
  }, [drawId, page.data?.campaign.id]);

  const clients = useMemo(
    () => (entrants.data ?? []).map((e) => e.client),
    [entrants.data],
  );
  const passesByClient = useMemo(
    () => new Map((entrants.data ?? []).map((e) => [e.client.id, e.passes])),
    [entrants.data],
  );

  /** Everyone actually in this draw, which is who could have won it. */
  const inDraw = (entrants.data ?? []).filter((e) => e.passes > 0);
  const poolSize = inDraw.reduce((n, e) => n + e.passes, 0);

  function chooseDraw(next: Draw) {
    setDrawId(next.id);
    // A half-typed winner belongs to the draw it was being typed into.
    setEntries([]);
    setMobile("");
    setPrize("");
    setLookup({ kind: "idle" });
    setError(null);
    setDone(null);
  }

  /**
   * Resolve a typed mobile number, and say precisely what is wrong when it does
   * not resolve. "Not found" and "found, but not in this draw" are different
   * problems with different fixes, and collapsing them into one message would
   * send an admin hunting for a typo that is not there.
   */
  function resolve(value: string) {
    if (!value.trim()) {
      setLookup({ kind: "idle" });
      return;
    }
    const match = findByMobile(clients, value);

    if (match.kind === "none") {
      setLookup({ kind: "error", message: "No client has that mobile number." });
      return;
    }
    if (match.kind === "ambiguous") {
      setLookup({
        kind: "error",
        message: `${match.count} clients share that number. Identify the winner another way.`,
      });
      return;
    }

    const client = match.client;
    if (entries.some((e) => e.clientId === client.id)) {
      setLookup({
        kind: "error",
        message: `${client.fullName} is already recorded as a winner of this draw.`,
      });
      return;
    }

    const passes = passesByClient.get(client.id) ?? 0;
    if (passes === 0) {
      setLookup({
        kind: "error",
        message:
          `${client.fullName} holds no ${draw ? passTypeLabel(draw.passType).toLowerCase() : ""} ` +
          `passes in this draw, so they were not entered into it.`,
      });
      return;
    }

    setLookup({ kind: "ok", clientId: client.id, name: client.fullName, passes });
  }

  function addEntry() {
    if (lookup.kind !== "ok" || !prize.trim()) return;
    setEntries([
      ...entries,
      {
        clientId: lookup.clientId,
        name: lookup.name,
        mobile: mobile.trim(),
        passes: lookup.passes,
        prize: prize.trim(),
      },
    ]);
    setMobile("");
    setPrize("");
    setLookup({ kind: "idle" });
  }

  async function record() {
    if (!draw || !page.data || entries.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.recordDraw(
        page.data.campaign.id,
        draw.id,
        entries.map((e) => ({ clientId: e.clientId, prize: e.prize })),
      );
      setDone(
        `${monthAndYear(draw.drawMonth)} ${passTypeLabel(draw.passType).toLowerCase()} ` +
          `draw recorded. ${entries.length} ${entries.length === 1 ? "winner" : "winners"}, ` +
          `${poolSize} ${poolSize === 1 ? "pass" : "passes"} used up.`,
      );
      setEntries([]);
      page.reload();
      entrants.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The draw could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!draw) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.undoDraw(draw.id);
      setDone(
        `${monthAndYear(draw.drawMonth)} draw reopened. Its passes are waiting on a ` +
          `result again, and the winners have been removed.`,
      );
      page.reload();
      entrants.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The draw could not be reopened.");
    } finally {
      setBusy(false);
    }
  }

  if (page.loading) return <Loading label="Loading draws…" />;
  if (page.error) return <div className="page"><Alert kind="err">{page.error}</Alert></div>;
  if (!page.data) return null;

  const { campaign, draws } = page.data;
  const thisMonth = currentDrawMonth(campaign);

  // Closed but unrecorded first — that is the job. Then the ones still
  // collecting, then what has already been done.
  const rank = (d: Draw) => (d.isDrawn ? 2 : d.drawMonth < thisMonth ? 0 : 1);
  const ordered = [...draws].sort(
    (a, b) => rank(a) - rank(b) || b.drawMonth.localeCompare(a.drawMonth),
  );

  const stillCollecting = draw !== null && !draw.isDrawn && draw.drawMonth >= thisMonth;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Record a draw</h1>
        <p className="sub">
          Draws are run offline. Enter who won and what they won, and the result is
          published to every consultant.
        </p>
      </header>

      {error && <Alert kind="err">{error}</Alert>}
      {done && <Alert kind="ok">{done}</Alert>}

      <div className="card">
        <div className="card-pad">
          <h2 style={{ fontSize: 17, marginBottom: 10 }}>Which draw</h2>
          <div className="chips">
            {ordered.map((d) => (
              <button
                key={d.id}
                type="button"
                className="chip"
                aria-pressed={drawId === d.id}
                onClick={() => chooseDraw(d)}
              >
                {monthAndYear(d.drawMonth)} · {passTypeLabel(d.passType)}
                <span style={{ color: "var(--ink-3)" }}>
                  {" — "}
                  {d.isDrawn
                    ? "recorded"
                    : d.drawMonth < thisMonth
                      ? "awaiting result"
                      : "still collecting"}
                </span>
              </button>
            ))}
          </div>
          {draws.length === 0 && (
            <EmptyState title="This campaign has no draws scheduled">
              Draws are rows in the database, added when the campaign is set up.
            </EmptyState>
          )}
        </div>
      </div>

      {draw && (
        <>
          {/* Recording a draw that is still collecting spends passes that people
              are still earning toward, and it does it with no "awaiting result"
              step in between — the pass goes straight from counted to spent. */}
          {stillCollecting && (
            <Alert kind="info">
              <strong>This draw is still collecting.</strong> {monthAndYear(draw.drawMonth)}{" "}
              has not closed yet, so recording it now uses up passes that clients are
              still earning toward it. Normally you would record the month before this
              one.
            </Alert>
          )}

          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-pad">
              <h2 style={{ fontSize: 17, marginBottom: 4 }}>
                {monthAndYear(draw.drawMonth)} · {passTypeLabel(draw.passType)}
              </h2>

              {entrants.loading && <Loading label="Working out who is in this draw…" />}
              {entrants.error && <Alert kind="err">{entrants.error}</Alert>}

              {/* `!entrants.loading` matters as much as `entrants.data` here.
                  `useAsync` keeps the previous result while the next one is in
                  flight, and the previous result for this page is the empty list
                  it returns before any draw is picked — so without the loading
                  check the screen spends a moment stating "0 clients entered, 0
                  passes in the draw" about a draw it has not read yet. On a
                  screen whose whole job is to say how many passes are about to
                  be used up, a confident wrong zero is worse than a spinner. */}
              {!entrants.loading && entrants.data && (
                <>
                  <div className="stat-row">
                    <div className="stat">
                      <div className="n">{inDraw.length}</div>
                      <div className="k">clients entered</div>
                    </div>
                    <div className="stat">
                      <div className="n">{poolSize}</div>
                      <div className="k">passes in the draw</div>
                    </div>
                    <div className="stat ok">
                      <div className="n">{entries.length}</div>
                      <div className="k">winners entered</div>
                    </div>
                  </div>

                  {draw.isDrawn ? (
                    <RecordedNotice draw={draw} onUndo={undo} busy={busy} />
                  ) : (
                    <>
                      <h3 style={{ fontSize: 15, marginBottom: 6 }}>Add a winner</h3>
                      <div className="winner-form">
                        <div className="field">
                          <label htmlFor="mobile">Winner's mobile number</label>
                          <input
                            id="mobile"
                            type="tel"
                            autoComplete="off"
                            value={mobile}
                            placeholder="9123 4567"
                            onChange={(e) => {
                              setMobile(e.target.value);
                              setLookup({ kind: "idle" });
                            }}
                            onBlur={(e) => resolve(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="prize">What they won</label>
                          <input
                            id="prize"
                            list="prize-suggestions"
                            value={prize}
                            placeholder={PRIZE_SUGGESTIONS[draw.passType][0]}
                            onChange={(e) => setPrize(e.target.value)}
                          />
                          <datalist id="prize-suggestions">
                            {PRIZE_SUGGESTIONS[draw.passType].map((p) => (
                              <option key={p} value={p} />
                            ))}
                          </datalist>
                        </div>
                        <button
                          type="button"
                          className="btn"
                          disabled={lookup.kind !== "ok" || !prize.trim()}
                          onClick={addEntry}
                        >
                          Add winner
                        </button>
                      </div>

                      {lookup.kind === "error" && <Alert kind="err">{lookup.message}</Alert>}
                      {lookup.kind === "ok" && (
                        <Alert kind="ok">
                          <strong>{lookup.name}</strong> — {lookup.passes}{" "}
                          {lookup.passes === 1 ? "pass" : "passes"} in this draw.
                        </Alert>
                      )}

                      {entries.length > 0 && (
                        <EntryTable
                          entries={entries}
                          onRemove={(id) =>
                            setEntries(entries.filter((e) => e.clientId !== id))
                          }
                        />
                      )}

                      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy || entries.length === 0}
                          onClick={() => void record()}
                        >
                          {busy ? <span className="spinner" /> : null}
                          Record the draw and use up {poolSize}{" "}
                          {poolSize === 1 ? "pass" : "passes"}
                        </button>
                      </div>

                      <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 12 }}>
                        Recording publishes the result to every consultant and uses up every
                        pass entered into this draw — that is what a draw does, not a side
                        effect. Clients who did not win see "Unsuccessful" rather than a
                        number that never changes. You can undo it afterwards.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RecordedNotice({
  draw,
  onUndo,
  busy,
}: {
  draw: Draw;
  onUndo: () => void;
  busy: boolean;
}) {
  const winners = useAsync(
    () => api.getWinners(draw.campaignId, draw.drawMonth),
    [draw.id, draw.drawMonth],
  );

  const mine = (winners.data ?? []).filter((w) => w.drawId === draw.id);

  return (
    <>
      <Alert kind="info">
        <strong>This draw has been recorded.</strong> Its passes are used up and the
        result is visible to every consultant.
      </Alert>

      {winners.loading && <Loading />}
      {mine.length > 0 && (
        <div className="tablewrap">
          <table className="ptable">
            <thead>
              <tr>
                <th scope="col">Winner</th>
                <th scope="col">Prize</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((w) => (
                <tr key={w.id}>
                  <td className="name">{w.displayName}</td>
                  <td>{w.prize}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn-ghost btn-danger"
          disabled={busy}
          onClick={onUndo}
        >
          {busy ? <span className="spinner" /> : null}
          Undo — reopen this draw and remove {mine.length}{" "}
          {mine.length === 1 ? "winner" : "winners"}
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 12 }}>
        Undoing returns every pass in this draw to "awaiting a result" and takes the month
        off the winners page. Use it to correct a result typed in wrongly, then record it
        again.
      </p>
    </>
  );
}

function EntryTable({
  entries,
  onRemove,
}: {
  entries: Entry[];
  onRemove: (clientId: string) => void;
}) {
  return (
    <div className="tablewrap" style={{ marginTop: 14 }}>
      <table className="ptable">
        <thead>
          <tr>
            <th scope="col">Winner</th>
            <th scope="col">Mobile</th>
            <th scope="col" className="num">Passes</th>
            <th scope="col">Prize</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.clientId}>
              <td className="name">{e.name}</td>
              <td>{formatMobile(e.mobile)}</td>
              <td className="num">{e.passes}</td>
              <td>{e.prize}</td>
              <td>
                <button
                  type="button"
                  className="btn-ghost btn-danger"
                  onClick={() => onRemove(e.clientId)}
                  aria-label={`Remove ${e.name}`}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
