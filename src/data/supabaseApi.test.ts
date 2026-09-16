import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Session handling in the Supabase provider.
 *
 * The thing worth pinning down here is that a session never outlives a failed
 * resolution. `signInWithPassword` writes a session to browser storage before
 * anything knows whether the account maps to a consultant, so every path that
 * refuses a user has to end that session too — otherwise the app says "signed
 * out" while a live, auto-refreshing token sits in localStorage.
 */

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const from = vi.fn();
  const auth = {
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    updateUser: vi.fn(),
  };
  return { maybeSingle, from, auth, client: { auth, from } };
});

vi.mock("../lib/supabase", () => ({
  supabase: () => mocks.client,
  USE_MOCK: false,
  MOCK_REASON: null,
}));

import { drawMonthOfRow, supabaseApi } from "./supabaseApi";

const user = (over: Record<string, unknown> = {}) => ({
  id: "auth-user-1",
  email: "amy@finexis.example",
  app_metadata: {},
  ...over,
});

/**
 * Await a call that must reject, and hand back the error it threw. Fails loudly
 * if it resolves — a `.catch()` alone would let a silent success through.
 */
async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the call to reject, but it resolved");
}

/** The `advisors` lookup inside `resolveViewer`. */
const advisorRow = (data: unknown) => mocks.maybeSingle.mockResolvedValue({ data, error: null });
const noAdvisorRow = () => mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.signOut.mockResolvedValue({ error: null });
  // Default: every table answers the advisors lookup inside resolveViewer.
  mocks.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
  }));
});

describe("signing in", () => {
  beforeEach(() => {
    mocks.auth.signInWithPassword.mockResolvedValue({ data: { user: user() }, error: null });
  });

  it("returns the consultant when the account resolves", async () => {
    advisorRow({ id: "adv-1", fc_name: "Amy Santiago" });
    const viewer = await supabaseApi.signIn("amy@finexis.example", "pw");

    expect(viewer).toMatchObject({
      advisorId: "adv-1",
      isAdmin: false,
      fullName: "Amy Santiago",
    });
    expect(mocks.auth.signOut).not.toHaveBeenCalled();
  });

  it("ends the session when no consultant record is linked", async () => {
    noAdvisorRow();
    await expect(supabaseApi.signIn("amy@finexis.example", "pw")).rejects.toThrow(
      /not set up for the campaign portal/,
    );
    // The whole point: the password was right, so a session now exists.
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("ends the session when the advisors table cannot be read", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(supabaseApi.signIn("amy@finexis.example", "pw")).rejects.toThrow(
      /Could not sign you in/,
    );
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("reports the original reason even if signing out then fails", async () => {
    noAdvisorRow();
    mocks.auth.signOut.mockRejectedValue(new Error("network down"));
    await expect(supabaseApi.signIn("amy@finexis.example", "pw")).rejects.toThrow(
      /not set up for the campaign portal/,
    );
  });

  it("tells the user nothing about the schema it just failed against", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for table "advisors"' },
    });
    const err = await rejection(supabaseApi.signIn("amy@finexis.example", "pw"));

    // Anyone who can reach the login page can read this string.
    expect(err.message).not.toMatch(/advisors|permission denied|policy|auth_user_id/i);
    expect(err.message).not.toContain("auth-user-1");
  });

  it("does not print the account id when the account is not linked", async () => {
    noAdvisorRow();
    const err = await rejection(supabaseApi.signIn("amy@finexis.example", "pw"));
    expect(err.message).not.toContain("auth-user-1");
    expect(err.message).not.toMatch(/row level security|advisors/i);
  });

  it("admits an admin on app_metadata alone, with no advisor row", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({
      data: { user: user({ app_metadata: { role: "admin" } }) },
      error: null,
    });
    noAdvisorRow();

    const viewer = await supabaseApi.signIn("holt@finexis.example", "pw");
    expect(viewer).toMatchObject({ isAdmin: true, advisorId: null });
    expect(mocks.auth.signOut).not.toHaveBeenCalled();
  });

  it("reports the admin claim and the client book as two separate facts", async () => {
    // The case that used to be impossible to express. Checking the claim first
    // and returning early meant a consultant granted admin came back with
    // advisorId null — so the app took their own client book away from them.
    mocks.auth.signInWithPassword.mockResolvedValue({
      data: { user: user({ app_metadata: { role: "admin" } }) },
      error: null,
    });
    advisorRow({ id: "adv-1", fc_name: "Amy Santiago" });

    const viewer = await supabaseApi.signIn("amy@finexis.example", "pw");
    expect(viewer).toMatchObject({
      isAdmin: true,
      advisorId: "adv-1",
      fullName: "Amy Santiago",
    });
  });

  it("ignores an admin role claimed anywhere a user can write it", async () => {
    // user_metadata is editable by the account holder; app_metadata is not.
    mocks.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { ...user(), app_metadata: {}, user_metadata: { role: "admin" } },
      },
      error: null,
    });
    advisorRow({ id: "adv-1", fc_name: "Amy Santiago" });

    const viewer = await supabaseApi.signIn("amy@finexis.example", "pw");
    expect(viewer.isAdmin).toBe(false);
  });

  it("does not try to end a session that was never created", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials", status: 400 },
    });
    await expect(supabaseApi.signIn("amy@finexis.example", "nope")).rejects.toThrow(
      /Invalid login credentials/,
    );
    expect(mocks.auth.signOut).not.toHaveBeenCalled();
  });
});

describe("resuming a session on page load", () => {
  it("returns null when there is no session, without signing anything out", async () => {
    mocks.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    expect(await supabaseApi.currentViewer()).toBeNull();
    expect(mocks.auth.signOut).not.toHaveBeenCalled();
  });

  it("ends a stored session that no longer resolves", async () => {
    mocks.auth.getSession.mockResolvedValue({ data: { session: { user: user() } }, error: null });
    noAdvisorRow();

    await expect(supabaseApi.currentViewer()).rejects.toThrow(/not set up for the campaign portal/);
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an unreadable session from no session at all", async () => {
    mocks.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { message: "storage unavailable" },
    });
    await expect(supabaseApi.currentViewer()).rejects.toThrow(/Could not read your session/);
  });
});

describe("changing your own account", () => {
  const SESSION = { data: { session: { user: user() } }, error: null };

  beforeEach(() => {
    mocks.auth.getSession.mockResolvedValue(SESSION);
    mocks.auth.signInWithPassword.mockResolvedValue({ data: { user: user() }, error: null });
    mocks.auth.updateUser.mockResolvedValue({ data: { user: user() }, error: null });
  });

  it("proves the current password before setting a new one", async () => {
    await supabaseApi.changePassword("old-one", "a-much-longer-new-one");

    expect(mocks.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "amy@finexis.example",
      password: "old-one",
    });
    expect(mocks.auth.updateUser).toHaveBeenCalledWith({ password: "a-much-longer-new-one" });
  });

  it("does not change the password when the current one is wrong", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials", status: 400 },
    });

    await expect(supabaseApi.changePassword("wrong", "a-much-longer-new-one")).rejects.toThrow(
      /not your current password/i,
    );
    // The point of the gate: nothing was written.
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses to act at all when the session has gone", async () => {
    mocks.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(supabaseApi.changePassword("old-one", "a-much-longer-new-one")).rejects.toThrow(
      /session has ended/i,
    );
    expect(mocks.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("loading a consultant's clients", () => {
  /**
   * The query deliberately does not filter on `advisor_id` — that value comes
   * from React state, which anyone can edit. Row level security is what scopes
   * the read, and these cases pin down what happens when it doesn't.
   */
  const CAMPAIGN = {
    id: "camp-1", name: "ATW",
    start_date: "2026-07-01", end_date: "2026-12-31", is_active: true,
  };
  const RATE_CARD = [{
    code: "attend_event", label: "Attend Client Events", pass_type: "blue",
    passes_per_unit: 5, unit_noun: "Event", sort_order: 1, is_active: true,
  }];
  const clientRow = (id: string, advisor_id: string) => ({
    id, advisor_id, client_name: `Client ${id}`,
    client_mobile: "90000000", client_email: `${id}@example.com`,
  });

  /**
   * A chainable PostgREST stub that honours `range()` — which is the point.
   * A stub that ignored paging would pass whether or not the code pages, and
   * the bug being fixed here is precisely that the real server answers a short
   * page and says nothing about it.
   *
   * Built fresh per `from()` call, so concurrent reads of the same table do not
   * share range state.
   */
  const chain = (list: unknown[], single: unknown = null) => {
    let range: [number, number] | null = null;
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit", "not"]) self[m] = () => self;
    self.range = (from: number, to: number) => {
      range = [from, to];
      return self;
    };
    self.maybeSingle = () => Promise.resolve({ data: single, error: null });
    self.single = () => Promise.resolve({ data: single, error: null });
    self.then = (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) => {
      const page = range ? list.slice(range[0], range[1] + 1) : list;
      return Promise.resolve({ data: page, error: null }).then(ok, no);
    };
    return self;
  };

  const withClients = (clients: unknown[], ledger: unknown[] = []) => {
    const rows: Record<string, [unknown[], unknown]> = {
      campaigns: [[], CAMPAIGN],
      pass_ledger: [ledger, { date_updated: "2026-09-10" }],
      challenge_types: [RATE_CARD, null],
      draws: [[], null],
      clients: [clients, null],
      prizes_won: [[], null],
    };
    mocks.from.mockImplementation((t: string) => chain(...(rows[t] ?? [[], null])));
  };

  it("returns the consultant's own clients", async () => {
    withClients([clientRow("cli-1", "adv-1"), clientRow("cli-2", "adv-1")], [
      { id: "l1", client_id: "cli-1", campaign_id: "camp-1", draw_id: null,
        challenge_code: "attend_event", units: 1, passes_awarded: 5, rate_applied: 5,
        status: "confirmed", occurred_on: "2026-09-04", date_updated: null,
        external_ref: "Briefing", description: null },
    ]);

    const rows = await supabaseApi.getAdvisorClients("adv-1", "camp-1");
    expect(rows.map((r) => r.client.id)).toEqual(["cli-1"]);
    expect(rows[0].blue).toBe(5);
  });

  it("totals every ledger row, not just the first page the server returns", async () => {
    // PostgREST caps a response at 1000 rows and gives no sign it has done so.
    // 2,400 rows is three pages; a single unpaged read would silently total the
    // first 1000 and look entirely plausible doing it.
    const ROWS = 2_400;
    const ledger = Array.from({ length: ROWS }, (_, i) => ({
      id: `l${i}`, client_id: "cli-1", campaign_id: "camp-1", draw_id: null,
      challenge_code: "attend_event", units: 1, passes_awarded: 5, rate_applied: 5,
      status: "confirmed", occurred_on: "2026-09-04", date_updated: null,
      external_ref: `Briefing ${i}`, description: null,
    }));
    withClients([clientRow("cli-1", "adv-1")], ledger);

    const rows = await supabaseApi.getAdvisorClients("adv-1", "camp-1");
    expect(rows[0].blue).toBe(ROWS * 5);
  });

  it("stops at the last page rather than looping on a short one", async () => {
    // Exactly one full page, then nothing. The loop must not spin.
    const ledger = Array.from({ length: 1_000 }, (_, i) => ({
      id: `l${i}`, client_id: "cli-1", campaign_id: "camp-1", draw_id: null,
      challenge_code: "attend_event", units: 1, passes_awarded: 5, rate_applied: 5,
      status: "confirmed", occurred_on: "2026-09-04", date_updated: null,
      external_ref: `Briefing ${i}`, description: null,
    }));
    withClients([clientRow("cli-1", "adv-1")], ledger);

    const rows = await supabaseApi.getAdvisorClients("adv-1", "camp-1");
    expect(rows[0].blue).toBe(5_000);
  });

  it("cannot be made to fetch another consultant's book by editing the id", async () => {
    // Row level security decides what comes back, so a tampered advisorId
    // cannot widen the read. What it can do is disagree with the result — and
    // that disagreement is treated as a fault, not quietly served.
    withClients([clientRow("cli-1", "adv-1")]);
    await expect(supabaseApi.getAdvisorClients("adv-2", "camp-1")).rejects.toThrow(
      /could not be loaded safely/i,
    );
  });

  it("refuses to render rather than leak another consultant's client", async () => {
    // What a loosened policy looks like: the read came back with someone else's.
    withClients([clientRow("cli-1", "adv-1"), clientRow("cli-9", "adv-2")]);

    await expect(supabaseApi.getAdvisorClients("adv-1", "camp-1")).rejects.toThrow(
      /could not be loaded safely/i,
    );
  });

  it("says nothing about the other consultant when it refuses", async () => {
    withClients([clientRow("cli-9", "adv-2")]);
    const err = await rejection(supabaseApi.getAdvisorClients("adv-1", "camp-1"));

    expect(err.message).not.toContain("adv-2");
    expect(err.message).not.toContain("cli-9");
  });
});

describe("which month a draw is for", () => {
  /**
   * The live schema holds each draw on the 7th of the following month, so the
   * date it is held is never the month it is for. Getting this wrong shifts
   * every pass into the neighbouring ballot, which is invisible until someone
   * notices their passes are in the wrong draw.
   */
  const row = (monthly_draw: string | null, draw_date: string) =>
    ({ id: "d", campaign_id: "c", monthly_draw, draw_date, pass_type: "blue", is_drawn: false });

  it("reads the period from monthly_draw, not the date it is held", () => {
    expect(drawMonthOfRow(row("July", "2026-08-07"))).toBe("2026-07");
    expect(drawMonthOfRow(row("August", "2026-09-07"))).toBe("2026-08");
    expect(drawMonthOfRow(row("September", "2026-10-07"))).toBe("2026-09");
  });

  it("keeps December in its own year when the draw runs in January", () => {
    expect(drawMonthOfRow(row("December", "2027-01-07"))).toBe("2026-12");
  });

  it("copes with a draw held inside its own month", () => {
    expect(drawMonthOfRow(row("September", "2026-09-30"))).toBe("2026-09");
  });

  it("matches loosely, because the column is free text", () => {
    expect(drawMonthOfRow(row("Sept", "2026-10-07"))).toBe("2026-09");
    expect(drawMonthOfRow(row("  august  ", "2026-09-07"))).toBe("2026-08");
    expect(drawMonthOfRow(row("AUGUST 2026", "2026-09-07"))).toBe("2026-08");
  });

  it("falls back to the month before the draw when the label is unusable", () => {
    expect(drawMonthOfRow(row(null, "2026-09-07"))).toBe("2026-08");
    expect(drawMonthOfRow(row("", "2026-09-07"))).toBe("2026-08");
    expect(drawMonthOfRow(row("Q3", "2026-09-07"))).toBe("2026-08");
    // Including across a year boundary.
    expect(drawMonthOfRow(row(null, "2027-01-07"))).toBe("2026-12");
  });

  it("leaves a draw it cannot place unmatchable rather than guessing", () => {
    // The year has to come from the date, so a broken date means the month
    // cannot be resolved at all. Returning something that looks like a real
    // month would let this draw quietly claim another month's passes.
    expect(drawMonthOfRow(row("July", "not-a-date"))).not.toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("watching the session", () => {
  let fire: (event: string, session: unknown) => void;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    mocks.auth.onAuthStateChange.mockImplementation((cb: typeof fire) => {
      fire = cb;
      return { data: { subscription: { unsubscribe } } };
    });
  });

  it("reports a signed-out session", () => {
    const handler = vi.fn();
    supabaseApi.onSessionChange(handler);

    fire("SIGNED_OUT", null);
    expect(handler).toHaveBeenCalledWith(null);
  });

  it("reports a session that has vanished under any event", () => {
    const handler = vi.fn();
    supabaseApi.onSessionChange(handler);

    fire("TOKEN_REFRESHED", null);
    expect(handler).toHaveBeenCalledWith(null);
  });

  it("leaves sign-in to whoever called signIn, so the two cannot race", () => {
    const handler = vi.fn();
    supabaseApi.onSessionChange(handler);

    fire("SIGNED_IN", { user: user() });
    expect(handler).not.toHaveBeenCalled();
  });

  it("re-checks the account on a token refresh and passes the viewer on", async () => {
    advisorRow({ id: "adv-1", fc_name: "Amy Santiago" });
    const handler = vi.fn();
    supabaseApi.onSessionChange(handler);

    fire("TOKEN_REFRESHED", { user: user() });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(handler.mock.calls[0][0]).toMatchObject({ advisorId: "adv-1" });
  });

  it("ends the session when a refresh finds the account no longer resolves", async () => {
    noAdvisorRow();
    const handler = vi.fn();
    supabaseApi.onSessionChange(handler);

    fire("TOKEN_REFRESHED", { user: user() });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(null));
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("stops listening when unsubscribed", () => {
    supabaseApi.onSessionChange(vi.fn())();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("importing pass activity", () => {
  /**
   * The importer is the only thing in the portal that writes. What matters is
   * that it writes rows the reader can make sense of — the column mapping here
   * is the seam between `ingest.ts`, which knows nothing about Supabase, and a
   * ledger whose columns are named after a different vocabulary entirely.
   */
  const CAMPAIGN = {
    id: "camp-1", name: "ATW",
    start_date: "2026-07-01", end_date: "2026-12-31", is_active: true,
  };
  const RATE_CARD = [
    { code: "attend_event", label: "Attend Client Events", pass_type: "blue",
      passes_per_unit: 5, unit_noun: "Event", sort_order: 1, is_active: true },
    { code: "finconnect", label: "Download finConnect", pass_type: "blue",
      passes_per_unit: 1, unit_noun: null, sort_order: 2, is_active: true },
  ];
  const CLIENTS = [
    { id: "cli-1", advisor_id: "adv-1", client_name: "Jake Peralta",
      client_mobile: "90000000", client_email: "jake@b99.co" },
    { id: "cli-2", advisor_id: "adv-2", client_name: "Rosa Diaz",
      client_mobile: "90000001", client_email: "rosa@b99.co" },
  ];
  const DRAWS = [
    { id: "draw-sep", campaign_id: "camp-1", monthly_draw: "September",
      draw_date: "2026-10-07", pass_type: "Blue", is_drawn: false },
  ];

  const HEAD = "client_ref,activity_code,units,earned_on,reference";
  const csv = (...rows: string[]) => new File([[HEAD, ...rows].join("\n")], "upload.csv");

  /** Everything `upsert` was asked to write, in the order it was asked. */
  let written: { rows: Record<string, unknown>[]; opts: Record<string, unknown> }[];
  /** How many of each batch the database claims to have actually inserted. */
  let insertedPerBatch: (n: number) => number;

  const table = (list: unknown[], single: unknown = null) => {
    let range: [number, number] | null = null;
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit", "not"]) self[m] = () => self;
    self.range = (from: number, to: number) => {
      range = [from, to];
      return self;
    };
    self.maybeSingle = () => Promise.resolve({ data: single, error: null });
    self.single = () => Promise.resolve({ data: single, error: null });
    self.upsert = (rows: Record<string, unknown>[], opts: Record<string, unknown>) => {
      written.push({ rows, opts });
      const kept = insertedPerBatch(rows.length);
      return {
        select: () =>
          Promise.resolve({ data: rows.slice(0, kept).map((_, i) => ({ id: `new-${i}` })), error: null }),
      };
    };
    self.then = (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) => {
      const page = range ? list.slice(range[0], range[1] + 1) : list;
      return Promise.resolve({ data: page, error: null }).then(ok, no);
    };
    return self;
  };

  const withLedger = (ledger: unknown[] = []) => {
    const rows: Record<string, [unknown[], unknown]> = {
      campaigns: [[], CAMPAIGN],
      pass_ledger: [ledger, { date_updated: "2026-09-10" }],
      challenge_types: [RATE_CARD, null],
      draws: [DRAWS, null],
      clients: [CLIENTS, null],
      prizes_won: [[], null],
    };
    mocks.from.mockImplementation((t: string) => table(...(rows[t] ?? [[], null])));
  };

  const ledgerRow = (over: Record<string, unknown> = {}) => ({
    client_id: "cli-1", challenge_code: "attend_event", occurred_on: "2026-09-04",
    external_ref: "Briefing", status: "confirmed", ...over,
  });

  beforeEach(() => {
    written = [];
    insertedPerBatch = (n) => n;
    withLedger();
  });

  describe("the dry run", () => {
    it("names the missing columns without reading the database", async () => {
      const err = await rejection(
        supabaseApi.previewUpload(new File(["client_ref\nC-1"], "bad.csv"), "camp-1"),
      );
      expect(err.message).toMatch(/activity_code/);
      expect(mocks.from).not.toHaveBeenCalled();
    });

    it("resolves a client by the email a spreadsheet actually carries", async () => {
      const p = await supabaseApi.previewUpload(
        csv("jake@b99.co,attend_event,2,2026-09-04,Briefing"),
        "camp-1",
      );
      expect(p.rows[0].outcome).toBe("insert");
      expect(p.rows[0].clientName).toBe("Jake Peralta");
      expect(p.rows[0].passes).toBe(10);
    });

    it("recognises a row already in the ledger, however the file names the client", async () => {
      withLedger([ledgerRow()]);
      // The stored row was written against `cli-1`; this file says "jake@b99.co".
      // Keyed on the raw text those are different rows and the passes double.
      const p = await supabaseApi.previewUpload(
        csv("jake@b99.co,attend_event,1,2026-09-04,Briefing"),
        "camp-1",
      );
      expect(p.rows[0].outcome).toBe("duplicate");
      expect(p.rows[0].reason).toBe("Already in the ledger");
    });

    it("treats a null external_ref in the ledger as a blank reference", async () => {
      withLedger([ledgerRow({ challenge_code: "finconnect", external_ref: null })]);
      const p = await supabaseApi.previewUpload(csv("cli-1,finconnect,1,2026-09-04,"), "camp-1");
      expect(p.rows[0].outcome).toBe("duplicate");
    });

    it("carries a once-per-client claim over from the ledger", async () => {
      withLedger([ledgerRow({ challenge_code: "finconnect", external_ref: "install" })]);
      const p = await supabaseApi.previewUpload(
        csv("cli-1,finconnect,1,2026-09-20,reinstall"),
        "camp-1",
      );
      expect(p.rows[0].outcome).toBe("duplicate");
      expect(p.rows[0].reason).toMatch(/once per client/);
    });

    it("lets a voided claim be re-earned", async () => {
      withLedger([
        ledgerRow({ challenge_code: "finconnect", external_ref: "install", status: "void" }),
      ]);
      const p = await supabaseApi.previewUpload(
        csv("cli-1,finconnect,1,2026-09-20,reinstall"),
        "camp-1",
      );
      expect(p.rows[0].outcome).toBe("insert");
    });

    it("writes nothing", async () => {
      await supabaseApi.previewUpload(csv("cli-1,attend_event,1,2026-09-04,x"), "camp-1");
      expect(written).toEqual([]);
    });
  });

  describe("the commit", () => {
    const commit = async (...rows: string[]) => {
      const p = await supabaseApi.previewUpload(csv(...rows), "camp-1");
      return supabaseApi.commitUpload(p, "camp-1");
    };

    it("maps a row onto the ledger's own columns", async () => {
      await commit("jake@b99.co,attend_event,2,2026-09-04,Briefing");

      expect(written).toHaveLength(1);
      expect(written[0].rows[0]).toMatchObject({
        campaign_id: "camp-1",
        client_id: "cli-1",
        challenge_code: "attend_event",
        units: 2,
        rate_applied: 5,
        status: "confirmed",
        occurred_on: "2026-09-04",
        external_ref: "Briefing",
      });
    });

    it("writes the status word this database uses, not the app's", async () => {
      // The app says `valid`; the ledger says `confirmed`, which is the column
      // default and what every row predating the importer carries. A reader
      // would cope with either, but the table should not end up speaking two
      // vocabularies — and a CHECK constraint on the three it already uses
      // would reject `valid` outright.
      await commit(
        "cli-1,attend_event,1,2026-09-04,x",
        "cli-1,attend_event,1,2026-09-05,y,",
      );
      expect(written[0].rows[0].status).toBe("confirmed");
    });

    it("keeps pending and void as they are, and they survive a round trip", async () => {
      const p = await supabaseApi.previewUpload(
        new File(
          [`${HEAD},status\ncli-1,attend_event,1,2026-09-04,x,pending\n` +
           `cli-1,attend_event,1,2026-09-05,y,void`],
          "upload.csv",
        ),
        "camp-1",
      );
      await supabaseApi.commitUpload(p, "camp-1");
      // `void` is the app's word and the CSV's; the column's CHECK constraint
      // allows only pending / confirmed / rejected, so it is written as
      // `rejected` — which `asStatus` reads back as void.
      expect(written[0].rows.map((r) => r.status)).toEqual(["pending", "rejected"]);
    });

    it("sends the rate and not the total, because the total is a generated column", async () => {
      // `passes_awarded` is `units * rate_applied`, computed by Postgres, and it
      // rejects an insert that supplies any value for it — "cannot insert a
      // non-DEFAULT value into column". Sending the number the preview worked
      // out fails the whole batch, so this is not a tidiness preference.
      await commit("jake@b99.co,attend_event,2,2026-09-04,Briefing");

      expect(written[0].rows[0]).not.toHaveProperty("passes_awarded");
      // The rate still has to go, or there is nothing to generate it from.
      expect(written[0].rows[0].rate_applied).toBe(5);
    });

    it("stamps date_updated, which is what the 'passes as of' line reads", async () => {
      await commit("cli-1,attend_event,1,2026-09-04,x");
      expect(written[0].rows[0].date_updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("never writes a null reference, because nulls do not collide", async () => {
      // Postgres treats two nulls as distinct, so a null here would exempt every
      // blank-reference row from the unique index meant to protect it.
      await commit("cli-1,finconnect,1,2026-09-04,");
      expect(written[0].rows[0].external_ref).toBe("");
    });

    it("asks the database to skip a duplicate rather than fail the batch", async () => {
      await commit("cli-1,attend_event,1,2026-09-04,x");
      expect(written[0].opts).toMatchObject({
        onConflict: "campaign_id,client_id,challenge_code,occurred_on,external_ref",
        ignoreDuplicates: true,
      });
    });

    it("writes only the accepted rows", async () => {
      const result = await commit(
        "cli-1,attend_event,1,2026-09-04,x",
        "nobody@nowhere.example,attend_event,1,2026-09-04,y",
      );
      expect(written[0].rows).toHaveLength(1);
      expect(result).toEqual({ inserted: 1, skipped: 1 });
    });

    it("reports what the database inserted, not what the preview hoped to", async () => {
      // The race: another admin loaded the same file between the dry run and
      // this call, so the index skips rows the preview had cleared.
      insertedPerBatch = () => 1;
      const result = await commit(
        "cli-1,attend_event,1,2026-09-04,x",
        "cli-1,attend_event,1,2026-09-05,y",
      );
      expect(result).toEqual({ inserted: 1, skipped: 1 });
    });

    it("splits a large load into batches", async () => {
      const rows = Array.from(
        { length: 1_200 },
        (_, i) => `cli-1,attend_event,1,2026-09-04,ref-${i}`,
      );
      await commit(...rows);
      expect(written.map((w) => w.rows.length)).toEqual([500, 500, 200]);
    });

    it("does not go near the database when there is nothing to write", async () => {
      const result = await commit("nobody@nowhere.example,attend_event,1,2026-09-04,y");
      expect(written).toEqual([]);
      expect(result).toEqual({ inserted: 0, skipped: 1 });
    });

    it("points a deferred pass at the draw it was deferred to", async () => {
      const p = await supabaseApi.previewUpload(
        new File(
          [`${HEAD},draw_month\ncli-1,attend_event,1,2026-08-04,x,2026-09`],
          "upload.csv",
        ),
        "camp-1",
      );
      await supabaseApi.commitUpload(p, "camp-1");
      expect(written[0].rows[0].draw_id).toBe("draw-sep");
    });

    it("leaves draw_id null when the pass goes into its own month", async () => {
      // Which is correct, not a gap: a read derives the ballot from the date.
      await commit("cli-1,attend_event,1,2026-09-04,x");
      expect(written[0].rows[0].draw_id).toBe(null);
    });

    it("refuses the whole file rather than lose a deferral it cannot record", async () => {
      // No November draw exists, so `draw_id` would be null and the next read
      // would quietly move this pass back into August.
      const p = await supabaseApi.previewUpload(
        new File(
          [`${HEAD},draw_month\ncli-1,attend_event,1,2026-08-04,x,2026-11`],
          "upload.csv",
        ),
        "camp-1",
      );
      const err = await rejection(supabaseApi.commitUpload(p, "camp-1"));

      expect(err.message).toMatch(/2026-11/);
      expect(written).toEqual([]);
    });
  });
});
