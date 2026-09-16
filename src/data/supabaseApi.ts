import { supabase } from "../lib/supabase";
import { parseCsv } from "../lib/csv";
import {
  buildPreview,
  claimKey,
  missingHeaders,
  naturalKey,
  toPassEvents,
  type IngestContext,
  type UploadPreview,
} from "../lib/ingest";
import { isOncePerClient } from "../lib/campaignRules";
import { awaitingPasses, livePasses, passView } from "../lib/passes";
import { shortenName } from "../lib/format";
import type {
  Activity,
  Campaign,
  ClientRecord,
  ClientStatement,
  Draw,
  DrawMonth,
  DrawWinner,
  PassEvent,
  PassStatus,
  PassType,
  Role,
  Viewer,
} from "../lib/types";
import { ApiError, type CommitResult, type PortalApi } from "./api";

/**
 * Supabase-backed provider, mapped onto the existing LuckyFinexis schema.
 *
 * Reads go straight from the browser to PostgREST: row level security decides
 * what comes back, so an advisor requesting every ledger row simply receives
 * their own clients'. The `.eq()` calls below keep responses small, not safe.
 *
 * Naming differs throughout — `pass_ledger` for pass events, `challenge_types`
 * for activities, `prizes_won` for winners — so this file is the whole of the
 * translation. Nothing outside `src/data/` knows the database exists.
 */

/* ---------- row shapes ---------- */

interface CampaignRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

interface ChallengeTypeRow {
  code: string;
  label: string;
  pass_type: string;
  passes_per_unit: number;
  unit_noun: string | null;
  sort_order: number | null;
  is_active: boolean;
}

interface ClientRow {
  id: string;
  advisor_id: string;
  client_name: string;
  client_mobile: string | null;
  client_email: string | null;
}

interface LedgerRow {
  id: string;
  client_id: string;
  campaign_id: string;
  draw_id: string | null;
  challenge_code: string;
  units: number | null;
  passes_awarded: number | null;
  rate_applied: number | null;
  status: string | null;
  occurred_on: string;
  date_updated: string | null;
  external_ref: string | null;
  description: string | null;
}

/** Just enough of a ledger row to rebuild a natural key and a once-per-client claim. */
interface LedgerKeyRow {
  client_id: string;
  challenge_code: string;
  occurred_on: string;
  external_ref: string | null;
  status: string | null;
}

/** A row on its way into `pass_ledger`. */
interface LedgerInsert {
  campaign_id: string;
  client_id: string;
  challenge_code: string;
  draw_id: string | null;
  units: number;
  passes_awarded: number;
  rate_applied: number;
  status: PassStatus;
  occurred_on: string;
  external_ref: string;
  date_updated: string;
}

interface DrawRow {
  id: string;
  campaign_id: string;
  monthly_draw: string | null;
  draw_date: string;
  pass_type: string | null;
  is_drawn: boolean;
}

interface PrizeRow {
  id: string;
  client_id: string;
  draw_id: string;
  prize_won: string;
}

/* ---------- value mapping ---------- */

/**
 * Report a failed read.
 *
 * The context is written for the person looking at the screen; the driver's own
 * message goes to the console. Postgres errors name tables, columns and
 * constraints, and none of that belongs in a consultant's browser window.
 */
const fail = (context: string, error: { message: string } | null): never => {
  console.error(`[db] ${context}:`, error?.message ?? "unknown error");
  throw new ApiError(`${context}. Please try again in a moment.`);
};

const asPassType = (value: string | null): PassType =>
  (value ?? "").trim().toLowerCase().startsWith("gold") ? "gold" : "blue";

/**
 * `pass_ledger.status` is free text, so synonyms are folded rather than matched
 * exactly. Anything unrecognised is treated as valid, which matches the ledger's
 * own default of a row being a real award; narrow this if the column turns out
 * to carry states these three do not cover.
 */
const VOID_WORDS = ["void", "cancel", "reversed", "withdrawn", "clawback", "rejected"];
const PENDING_WORDS = ["pending", "unconfirmed", "provisional", "awaiting", "free-look"];

function asStatus(value: string | null): PassStatus {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return "valid";
  if (VOID_WORDS.some((w) => v.includes(w))) return "void";
  if (PENDING_WORDS.some((w) => v.includes(w))) return "pending";
  return "valid";
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * The month a draw is *for*, which is not the month it is held in.
 *
 * `draw_date` is when the draw happens, and the convention here is the 7th of
 * the following month — July's draw runs on 2026-08-07, December's on
 * 2027-01-07. Slicing the year-month off it therefore attributes every draw to
 * the month after the one it belongs to, which shifts every pass into the wrong
 * ballot and labels every winners chip with the wrong month.
 *
 * `monthly_draw` is the only column carrying the period. It is free text, so it
 * is matched on its first three letters rather than parsed strictly, and the
 * year is chosen to place the month at or before the draw date — which is what
 * puts December 2026's draw, held in January 2027, in 2026-12.
 *
 * If it cannot be read at all, fall back to the month before the draw date,
 * which is the convention every row in this schema follows.
 */
function drawMonthOfRow(row: DrawRow): DrawMonth {
  const held = new Date(`${row.draw_date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(held.getTime())) return row.draw_date.slice(0, 7);

  const monthBefore = (): DrawMonth => {
    const d = new Date(Date.UTC(held.getUTCFullYear(), held.getUTCMonth() - 1, 1));
    return d.toISOString().slice(0, 7);
  };

  const key = (row.monthly_draw ?? "").trim().toLowerCase().slice(0, 3);
  if (key.length < 3) return monthBefore();
  const month = MONTH_NAMES.findIndex((m) => m.startsWith(key));
  if (month < 0) return monthBefore();

  // A draw is never held before the month it is for, so a named month later in
  // the calendar than the date it was held belongs to the previous year.
  const year =
    month <= held.getUTCMonth() ? held.getUTCFullYear() : held.getUTCFullYear() - 1;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** Exported for tests: the year-rollover case is easy to get wrong silently. */
export { drawMonthOfRow };

const toActivity = (r: ChallengeTypeRow, campaignId: string): Activity => ({
  // `challenge_types` is keyed by code and has no id column, so code is the id.
  id: r.code,
  campaignId,
  code: r.code,
  label: r.label,
  passType: asPassType(r.pass_type),
  passesPerUnit: r.passes_per_unit,
  // "" and null both mean "not counted per anything" — "Submit A Testimonial
  // (3 Passes)" rather than "(3 Passes Per …)".
  unitLabel: r.unit_noun?.trim() ? r.unit_noun.trim() : null,
  sortOrder: r.sort_order ?? 0,
  // No column for this on `challenge_types`, so it comes from the campaign terms
  // in `src/lib/campaignRules.ts`.
  oncePerClient: isOncePerClient(r.code),
});

const toClient = (r: ClientRow): ClientRecord => ({
  id: r.id,
  // No external reference column, so the primary key stands in as the identifier.
  externalRef: r.id,
  fullName: r.client_name,
  email: r.client_email ?? "",
  mobile: r.client_mobile ?? "",
  advisorId: r.advisor_id,
});

/**
 * A ledger row becomes a pass event. `draw_id` is read as the draw the pass is
 * entered into, so it sets the month the pass counts for; without one the month
 * is derived from `occurred_on`, which is the same rule the campaign runs on
 * paper.
 *
 * `consumedByDrawId` stays null: whether a pass has been used up is derived from
 * whether its draw has run, so the ledger never has to be rewritten when a draw
 * happens. The field exists for administrative corrections, which this schema
 * has no column for yet.
 */
function toPassEvent(r: LedgerRow, drawMonthById: Map<string, DrawMonth>): PassEvent {
  const fromDraw = r.draw_id ? drawMonthById.get(r.draw_id) : undefined;
  const units = r.units ?? 1;
  return {
    id: r.id,
    campaignId: r.campaign_id,
    clientId: r.client_id,
    activityId: r.challenge_code,
    units,
    passes: r.passes_awarded ?? units * (r.rate_applied ?? 0),
    earnedOn: r.occurred_on,
    drawMonth: fromDraw ?? r.occurred_on.slice(0, 7),
    status: asStatus(r.status),
    voidReason: asStatus(r.status) === "void" ? r.description : null,
    consumedByDrawId: null,
    reference: r.external_ref ?? "",
  };
}

const toDraw = (r: DrawRow): Draw => ({
  id: r.id,
  campaignId: r.campaign_id,
  drawMonth: drawMonthOfRow(r),
  passType: asPassType(r.pass_type),
  isDrawn: r.is_drawn,
  drawnAt: r.is_drawn ? r.draw_date : null,
});

/* ---------- viewer ---------- */

/**
 * Resolve a sign-in to the record its permissions hang off.
 *
 * There is no profiles table, so the advisor row is the source of truth and an
 * admin is marked by `app_metadata.role`, which only the service role can set —
 * a user cannot promote themselves by editing their own metadata. A sign-in
 * matching neither is refused rather than defaulted to anything.
 *
 * `clients` carries no auth column: clients are records here, not users.
 */
async function resolveViewer(
  userId: string,
  email: string,
  appMetadata: Record<string, unknown> | undefined,
): Promise<Viewer> {
  const db = supabase();
  const declared = appMetadata?.role;
  const role: Role | null =
    declared === "admin" || declared === "advisor" ? declared : null;

  const { data: advisor, error } = await db
    .from("advisors")
    .select("id, fc_name")
    .eq("auth_user_id", userId)
    .maybeSingle<{ id: string; fc_name: string }>();

  // A failed query and an absent row are different problems, and reporting them
  // identically turns a one-line fix into a guessing game — but the detail
  // belongs in the console, not on the sign-in screen. Raw Postgres text names
  // tables and columns to anyone who can reach the login page.
  if (error) {
    console.error("[auth] advisors lookup failed:", error.message, { userId });
    throw new ApiError("Could not sign you in. Please try again in a moment.");
  }

  if (role === "admin") {
    return { userId, email, role: "admin", fullName: advisor?.fc_name ?? email, advisorId: advisor?.id ?? null };
  }

  if (advisor) {
    return { userId, email, role: "advisor", fullName: advisor.fc_name, advisorId: advisor.id };
  }

  // Row level security returns an empty result rather than an error when it
  // denies a read, so "no advisor" covers both "the column is not set" and "the
  // policy did not admit me". Whoever is setting the account up needs to know
  // which; the person at the sign-in screen must not be told the id being looked
  // for, the table it lives in, or that a policy exists at all.
  console.error(
    `[auth] no advisors row readable with auth_user_id = ${userId}. ` +
      `Either the column is not set, or the row level security policy did not ` +
      `admit this user.`,
  );
  throw new ApiError(
    "This account is not set up for the campaign portal. Please contact your administrator.",
  );
}

/**
 * Resolve a session to a viewer, and end the session if it will not resolve.
 *
 * `signInWithPassword` persists a session before anything knows whether the
 * account is linked to a consultant record. Without this, a sign-in refused by
 * `resolveViewer` leaves a live, auto-refreshing token in the browser while the
 * app reports the user as signed out — a session nobody can see and nothing
 * ends, carrying whatever the `authenticated` role is granted.
 */
async function resolveOrEndSession(
  user: { id: string; email?: string | null; app_metadata?: unknown },
  fallbackEmail: string,
): Promise<Viewer> {
  try {
    return await resolveViewer(
      user.id,
      user.email ?? fallbackEmail,
      user.app_metadata as Record<string, unknown> | undefined,
    );
  } catch (err) {
    // Best effort. The session must not outlive a failed resolution, but a
    // network error on the way out must not replace the real reason.
    try {
      await supabase().auth.signOut();
    } catch {
      /* the caller's error is the one worth reporting */
    }
    throw err;
  }
}

/* ---------- account changes ---------- */

/**
 * Prove the person at the keyboard knows the current password, and return the
 * email they are signed in as.
 *
 * Supabase will change a password or a sign-in email on the strength of a
 * session alone. That makes an unattended laptop enough to lock a consultant
 * out of their own client book, so this is the check Supabase does not make.
 *
 * Signing in again does not disturb the existing session; a wrong password
 * returns an error and leaves it alone.
 */
async function reauthenticate(currentPassword: string): Promise<string> {
  const db = supabase();
  const { data } = await db.auth.getSession();
  const email = data.session?.user.email;
  if (!email) {
    throw new ApiError("Your session has ended. Please sign in again.");
  }

  const { error } = await db.auth.signInWithPassword({ email, password: currentPassword });
  if (error) {
    // Naming the reason is safe here, unlike on the login screen: whoever is
    // asking is already signed in as this account, so there is nothing to
    // discover.
    throw new ApiError("That is not your current password.");
  }
  return email;
}

/* ---------- paging ---------- */

/**
 * PostgREST answers at most `db-max-rows` rows — 1000 on Supabase by default —
 * and says nothing at all when it truncates. There is no error and no flag: the
 * response is simply short. For this app that would mean a consultant's pass
 * totals quietly losing whatever fell past the cap, which looks entirely
 * plausible on screen and is wrong.
 *
 * So every read that can return more than a handful of rows is paged.
 */
const PAGE_SIZE = 1000;

/** A runaway guard. Nothing here should approach it; if it does, say so. */
const MAX_ROWS = 100_000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Read every row a query matches, a page at a time.
 *
 * **The query must be ordered by something unique.** `range()` pages by offset,
 * so rows the database is free to return in any order can appear on two pages
 * or none. Where the natural sort is not unique — a client's name, a draw's
 * date — the caller adds the primary key as a tiebreak.
 */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  context: string,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) fail(context, error);

    const batch = data ?? [];
    rows.push(...batch);

    // A short page is the last page.
    if (batch.length < PAGE_SIZE) return rows;

    if (rows.length >= MAX_ROWS) {
      console.error(`[db] ${context}: stopped at ${MAX_ROWS} rows, which should not happen`);
      throw new ApiError(
        `${context}. There is more data here than this page can safely total up.`,
      );
    }
  }
}

/**
 * Split a list of ids for an `.in()` filter.
 *
 * Every id goes into the query string, so a few hundred UUIDs makes a URL long
 * enough for PostgREST or the CDN in front of it to reject — and the failure
 * reads as a malformed request rather than "too many clients".
 */
const ID_CHUNK = 100;

const chunk = <T,>(xs: T[], size = ID_CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

/** Run a paged read once per chunk of ids and concatenate the results. */
async function fetchAllByIds<T>(
  ids: string[],
  page: (batch: string[], from: number, to: number) => PromiseLike<PageResult<T>>,
  context: string,
): Promise<T[]> {
  const batches = await Promise.all(
    chunk(ids).map((batch) => fetchAll<T>((from, to) => page(batch, from, to), context)),
  );
  return batches.flat();
}

/* ---------- provider ---------- */

export const supabaseApi: PortalApi = {
  async signIn(email, password) {
    const { data, error } = await supabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error || !data.user) {
      throw new ApiError(error?.message ?? "Could not sign you in.", error?.status);
    }
    return resolveOrEndSession(data.user, email);
  },

  async signOut() {
    await supabase().auth.signOut();
  },

  async currentViewer() {
    const { data, error } = await supabase().auth.getSession();
    // A session that cannot be read at all is not the same as no session:
    // storage blocked, or a refresh that failed. Say so rather than showing the
    // login page as though the user had simply never signed in.
    if (error) {
      throw new ApiError(`Could not read your session: ${error.message}`);
    }
    const user = data.session?.user;
    if (!user) return null;
    return resolveOrEndSession(user, "");
  },

  onSessionChange(handler) {
    const { data } = supabase().auth.onAuthStateChange((event, session) => {
      // Sign-in is already handled by whoever called signIn, and re-resolving
      // here would race with it.
      if (event === "SIGNED_IN") return;

      if (!session?.user || event === "SIGNED_OUT") {
        handler(null);
        return;
      }

      // On a refresh — roughly hourly — re-check that the account still
      // resolves. This is what catches an advisor record that has been removed
      // or a role that has changed since the page was opened; without it the
      // only check is at page load and a stale viewer can live for days.
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void resolveOrEndSession(session.user, "")
          .then(handler)
          .catch(() => handler(null));
      }
    });

    return () => data.subscription.unsubscribe();
  },

  async changePassword(currentPassword, newPassword) {
    await reauthenticate(currentPassword);

    const { error } = await supabase().auth.updateUser({ password: newPassword });
    if (error) {
      console.error("[auth] password change failed:", error.message);
      // GoTrue's own validation messages are written for the person reading
      // them — "Password should be at least 6 characters" — unlike Postgres
      // errors, so they are passed through rather than swallowed.
      throw new ApiError(error.message, error.status);
    }
  },


  async getCampaign(): Promise<Campaign> {
    const db = supabase();
    const { data, error } = await db
      .from("campaigns")
      .select("id, name, start_date, end_date, is_active")
      .eq("is_active", true)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle<CampaignRow>();
    if (error || !data) fail("Could not load the campaign", error);
    const row = data!;

    // "Updated as of" comes from the most recent ledger touch, since the schema
    // has no campaign-level stamp for it.
    const { data: latest } = await db
      .from("pass_ledger")
      .select("date_updated")
      .eq("campaign_id", row.id)
      .not("date_updated", "is", null)
      .order("date_updated", { ascending: false })
      .limit(1)
      .maybeSingle<{ date_updated: string }>();

    return {
      id: row.id,
      name: row.name,
      slug: row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      startsOn: row.start_date,
      endsOn: row.end_date,
      // No artwork column yet; the details pop-up falls back to the earning
      // rules rendered from challenge_types, which is a useful page either way.
      detailsImageUrl: null,
      dataAsOf: latest?.date_updated ?? null,
      // Not a column yet, so the campaign terms are stated here: blue is drawn
      // every month, gold once at campaign close. Move this to `campaigns` when
      // a second campaign needs different terms.
      drawSchedule: { gold: "campaign_end", blue: "monthly" },
    };
  },

  async getActivities(campaignId) {
    // challenge_types is a global rate card rather than per-campaign, so every
    // active row applies and the campaign id is stamped on in memory.
    const rows = await fetchAll<ChallengeTypeRow>(
      (from, to) =>
        supabase()
          .from("challenge_types")
          .select("code, label, pass_type, passes_per_unit, unit_noun, sort_order, is_active")
          .eq("is_active", true)
          .order("sort_order")
          .order("code") // sort_order is not unique; code is the key
          .range(from, to),
      "Could not load campaign activities",
    );
    return rows.map((r) => toActivity(r, campaignId));
  },

  async getAdvisorClients(advisorId, campaignId) {
    const db = supabase();
    const campaign = await this.getCampaign();

    // No `.eq("advisor_id", …)` here, deliberately. `advisorId` reaches this
    // function from React state, which anyone can edit in devtools — filtering
    // on it would make a client-supplied value the thing that decides whose
    // book comes back. Row level security already restricts `clients` to the
    // caller's own, so asking for all of them returns exactly theirs.
    const [clientRows, activities, draws] = await Promise.all([
      fetchAll<ClientRow>(
        (from, to) =>
          db
            .from("clients")
            .select("id, advisor_id, client_name, client_mobile, client_email")
            .order("client_name")
            .order("id") // names are not unique, and paging needs a stable sort
            .range(from, to),
        "Could not load your clients",
      ),
      this.getActivities(campaignId),
      this.getDraws(campaignId),
    ]);

    const clients = clientRows.map(toClient);

    // Belt and braces. If a policy is ever loosened by accident, this turns a
    // silent leak of another consultant's book into a refusal to render.
    const foreign = clients.filter((c) => c.advisorId !== advisorId);
    if (foreign.length > 0) {
      console.error(
        `[security] clients query returned ${foreign.length} row(s) belonging to ` +
          `another consultant. Check the row level security policy on "clients".`,
      );
      throw new ApiError(
        "Your client list could not be loaded safely. Please contact your administrator.",
      );
    }

    if (clients.length === 0) return [];

    // The ledger is the read that actually grows: one row per qualifying
    // activity per client, for a whole campaign. A book of 300 clients puts it
    // past the cap well before anyone notices the totals are short.
    const ids = clients.map((c) => c.id);
    const [ledgerRows, prizeRows] = await Promise.all([
      fetchAllByIds<LedgerRow>(
        ids,
        (batch, from, to) =>
          db
            .from("pass_ledger")
            .select("*")
            .eq("campaign_id", campaignId)
            .in("client_id", batch)
            .order("id")
            .range(from, to),
        "Could not load pass activity",
      ),
      fetchAllByIds<{ client_id: string; draw_id: string }>(
        ids,
        (batch, from, to) =>
          db
            .from("prizes_won")
            .select("client_id, draw_id")
            .in("client_id", batch)
            .order("id")
            .range(from, to),
        "Could not load prizes",
      ),
    ]);

    const drawMonths = new Map(draws.map((d) => [d.id, d.drawMonth]));
    const events = ledgerRows.map((r) => toPassEvent(r, drawMonths));
    const view = passView(campaign, draws);

    // A prize only counts once its draw has been run, so a result entered ahead
    // of the draw does not put a Winner badge on the table early.
    const drawnIds = new Set(draws.filter((d) => d.isDrawn).map((d) => d.id));
    const winners = new Set(
      prizeRows.filter((p) => drawnIds.has(p.draw_id)).map((p) => p.client_id),
    );

    return clients
      .map((client) => {
        const mine = events.filter((e) => e.clientId === client.id);
        return {
          client,
          gold: livePasses(mine, "gold", activities, view),
          blue: livePasses(mine, "blue", activities, view),
          awaiting:
            awaitingPasses(mine, "gold", activities, view) +
            awaitingPasses(mine, "blue", activities, view),
          won: winners.has(client.id),
          hasAny: mine.length > 0,
        };
      })
      .filter((r) => r.hasAny)
      .map(({ client, gold, blue, awaiting, won }) => ({
        client, gold, blue, awaiting, won,
      }))
      .sort((a, b) => b.gold + b.blue - (a.gold + a.blue));
  },

  async getClientStatement(clientId, campaignId): Promise<ClientStatement> {
    const db = supabase();

    // No advisor check here: row level security answers with the client only if
    // they belong to the caller, so a tampered clientId returns nothing and the
    // `.single()` below fails rather than showing someone else's statement.
    const [{ data: clientRow, error: clientErr }, ledgerRows] = await Promise.all([
      db
        .from("clients")
        .select("id, advisor_id, client_name, client_mobile, client_email")
        .eq("id", clientId)
        .single<ClientRow>(),
      fetchAll<LedgerRow>(
        (from, to) =>
          db
            .from("pass_ledger")
            .select("*")
            .eq("client_id", clientId)
            .eq("campaign_id", campaignId)
            .order("occurred_on")
            .order("id") // two activities can share a date
            .range(from, to),
        "Could not load pass activity",
      ),
    ]);
    if (clientErr || !clientRow) fail("Could not load the client", clientErr);

    const draws = await this.getDraws(campaignId);
    const drawById = new Map(draws.map((d) => [d.id, d]));

    const prizeRows = await fetchAll<PrizeRow>(
      (from, to) =>
        db
          .from("prizes_won")
          .select("id, client_id, draw_id, prize_won")
          .eq("client_id", clientId)
          .order("id")
          .range(from, to),
      "Could not load prizes",
    );

    return {
      client: toClient(clientRow!),
      events: ledgerRows.map((r) =>
        toPassEvent(r, new Map(draws.map((d) => [d.id, d.drawMonth]))),
      ),
      winners: prizeRows
        // Only prizes from a draw that has actually been run; a result entered
        // ahead of the draw is not the portal's news to break.
        .filter((p) => drawById.get(p.draw_id)?.isDrawn)
        .map((p) => ({
          id: p.id,
          drawId: p.draw_id,
          drawMonth: drawById.get(p.draw_id)!.drawMonth,
          clientId: p.client_id,
          displayName: shortenName(clientRow!.client_name),
          prize: p.prize_won,
          passType: drawById.get(p.draw_id)!.passType,
        })),
    };
  },

  async getDraws(campaignId) {
    // Every row, drawn or not, and one per pass type: which draws have run is
    // what decides whether a pass is still live, and the ones still to come are
    // what a client's remaining passes are waiting for.
    const rows = await fetchAll<DrawRow>(
      (from, to) =>
        supabase()
          .from("draws")
          .select("id, campaign_id, monthly_draw, draw_date, pass_type, is_drawn")
          .eq("campaign_id", campaignId)
          .order("draw_date")
          .order("id") // gold and blue share a date
          .range(from, to),
      "Could not load draws",
    );
    return rows.map(toDraw);
  },

  async getWinners(campaignId: string, drawMonth: DrawMonth): Promise<DrawWinner[]> {
    const db = supabase();

    const drawRows = await fetchAll<DrawRow>(
      (from, to) =>
        db
          .from("draws")
          .select("id, campaign_id, monthly_draw, draw_date, pass_type, is_drawn")
          .eq("campaign_id", campaignId)
          .eq("is_drawn", true)
          .order("id")
          .range(from, to),
      "Could not load the draw",
    );

    const inMonth = drawRows.filter((d) => drawMonthOfRow(d) === drawMonth);
    if (inMonth.length === 0) return [];
    const byId = new Map(inMonth.map((d) => [d.id, d]));

    const prizes = await fetchAllByIds<PrizeRow>(
      inMonth.map((d) => d.id),
      (batch, from, to) =>
        db
          .from("prizes_won")
          .select("id, client_id, draw_id, prize_won")
          .in("draw_id", batch)
          .order("id")
          .range(from, to),
      "Could not load winners",
    );
    if (prizes.length === 0) return [];

    // Winner names come from `clients`, so row level security decides which are
    // legible: an advisor sees their own clients named and the rest anonymous,
    // rather than the whole firm's client list.
    const nameRows = await fetchAllByIds<{ id: string; client_name: string }>(
      prizes.map((p) => p.client_id),
      (batch, from, to) =>
        db.from("clients").select("id, client_name").in("id", batch).order("id").range(from, to),
      "Could not load winners",
    );
    const names = new Map(nameRows.map((c) => [c.id, shortenName(c.client_name)]));

    return prizes.map((p) => ({
      id: p.id,
      drawId: p.draw_id,
      drawMonth,
      clientId: p.client_id,
      displayName: names.get(p.client_id) ?? "A client",
      prize: p.prize_won,
      passType: asPassType(byId.get(p.draw_id)?.pass_type ?? null),
    }));
  },

  async previewUpload(file, campaignId): Promise<UploadPreview> {
    // Parse before asking the database for anything: a file with the wrong
    // columns is the common mistake, and it should be answered immediately
    // rather than after four paged reads.
    const { headers, rows, lines } = parseCsv(await file.text());
    const missing = missingHeaders(headers);
    if (missing.length) {
      throw new ApiError(`The file is missing required columns: ${missing.join(", ")}`);
    }

    const ctx = await ingestContext(campaignId, await this.getActivities(campaignId));
    return buildPreview(file.name, rows, lines, ctx);
  },

  /**
   * Write the accepted rows of a preview.
   *
   * Two things guard against a double load, and they are deliberately not the
   * same thing. The preview marks a row already in the ledger as a duplicate and
   * never offers it here; the unique index on `pass_ledger` refuses it even if
   * that check were skipped, wrong, or racing another admin who uploaded the
   * same file a second ago. `ignoreDuplicates` turns the second guard into a
   * skipped row rather than a failed batch, so a file that is half new still
   * lands its new half.
   *
   * The count returned is what the database actually inserted, not what the
   * preview hoped to: those differ precisely in the race, which is the case
   * worth reporting honestly.
   */
  async commitUpload(preview, campaignId): Promise<CommitResult> {
    const db = supabase();
    const activities = await this.getActivities(campaignId);
    const ctx = await ingestContext(campaignId, activities, { withLedger: false });
    const events = toPassEvents(preview, ctx, "upload");
    if (events.length === 0) {
      return { inserted: 0, skipped: preview.counts.duplicate + preview.counts.reject };
    }

    const byCode = new Map(activities.map((a) => [a.code, a]));
    const draws = await this.getDraws(campaignId);
    const now = new Date().toISOString();

    // `draw_id` is written only for a deferral, and that restraint is the point.
    // It is the one case `occurred_on` cannot express, so without it a pass held
    // back to a later ballot quietly returns to the month it was earned in. Set
    // on every row instead, it would be asserting something the campaign rules
    // can contradict: gold pools to the close of the campaign wherever it was
    // earned, so naming September's gold draw on a September row states a
    // membership that is not true. The ballot is derived; this column records
    // the exception, not the rule.
    const drawIdFor = (passType: PassType, month: DrawMonth): string | null =>
      draws.find((d) => d.passType === passType && d.drawMonth === month)?.id ?? null;

    const inserts: LedgerInsert[] = [];
    const orphans: string[] = [];

    for (const e of events) {
      const activity = byCode.get(e.activityId)!;
      const deferred = e.drawMonth !== e.earnedOn.slice(0, 7);
      const drawId = deferred ? drawIdFor(activity.passType, e.drawMonth) : null;
      if (deferred && !drawId) orphans.push(`${e.drawMonth} (${activity.passType})`);

      inserts.push({
        campaign_id: campaignId,
        client_id: e.clientId,
        // `challenge_types` is keyed by code, so the activity id is the code.
        challenge_code: e.activityId,
        draw_id: drawId,
        units: e.units,
        passes_awarded: e.passes,
        // Stored alongside the total so a row still explains itself after the
        // rate card changes — which is the whole reason the column exists.
        rate_applied: activity.passesPerUnit,
        status: e.status,
        occurred_on: e.earnedOn,
        // Never null: the unique index includes this column, and in Postgres
        // two nulls are not equal, so a null here would let blank-reference
        // rows duplicate freely.
        external_ref: e.reference,
        date_updated: now,
      });
    }

    // Refuse the whole file rather than write rows whose deferral would quietly
    // revert on the next read. Naming the months is what makes it fixable.
    if (orphans.length > 0) {
      throw new ApiError(
        `Nothing was written. These rows defer a pass to a draw that does not ` +
          `exist yet: ${[...new Set(orphans)].join(", ")}. Add the draw first, ` +
          `or leave draw_month blank.`,
      );
    }

    let inserted = 0;
    // Chunked because a whole campaign's backlog in one request is a payload
    // large enough for PostgREST or the CDN in front of it to refuse.
    for (const batch of chunk(inserts, 500)) {
      const { data, error } = await db
        .from("pass_ledger")
        .upsert(batch, {
          onConflict: "campaign_id,client_id,challenge_code,occurred_on,external_ref",
          ignoreDuplicates: true,
        })
        .select("id");
      if (error) fail("Could not save the upload", error);
      inserted += data?.length ?? 0;
    }

    return {
      inserted,
      skipped:
        preview.counts.duplicate + preview.counts.reject + (events.length - inserted),
    };
  },
};

/**
 * Everything `buildPreview` needs to judge a row, read from the database.
 *
 * Clients come back through row level security, so this is the caller's own
 * book — which for the admin who runs an import is the whole firm. A row naming
 * a client the caller cannot see is rejected as unknown rather than written
 * blind, which is the right failure.
 *
 * `withLedger` is off at commit time: the preview already decided what to
 * write, and the unique index is what stops a duplicate now.
 */
async function ingestContext(
  campaignId: string,
  activities: Activity[],
  { withLedger = true }: { withLedger?: boolean } = {},
): Promise<IngestContext> {
  const db = supabase();

  const [clientRows, ledgerRows] = await Promise.all([
    fetchAll<ClientRow>(
      (from, to) =>
        db
          .from("clients")
          .select("id, advisor_id, client_name, client_mobile, client_email")
          .order("client_name")
          .order("id") // names are not unique, and paging needs a stable sort
          .range(from, to),
      "Could not load clients",
    ),
    withLedger
      ? fetchAll<LedgerKeyRow>(
          (from, to) =>
            db
              .from("pass_ledger")
              .select("client_id, challenge_code, occurred_on, external_ref, status")
              .eq("campaign_id", campaignId)
              .order("id")
              .range(from, to),
          "Could not load the existing ledger",
        )
      : Promise.resolve([] as LedgerKeyRow[]),
  ]);

  const oncePerClient = new Set(
    activities.filter((a) => a.oncePerClient).map((a) => a.code),
  );

  return {
    campaignId,
    activities,
    clients: clientRows.map(toClient),
    existingKeys: new Set(
      ledgerRows.map((r) =>
        naturalKey(
          campaignId,
          r.client_id,
          r.challenge_code,
          // A date column answers as YYYY-MM-DD, but a timestamp would carry a
          // time the CSV cannot express and could never match.
          r.occurred_on.slice(0, 10),
          r.external_ref ?? "",
        ),
      ),
    ),
    // A voided row does not hold the slot: a withdrawn testimonial should not
    // block the real one from being loaded later.
    claimed: new Set(
      ledgerRows
        .filter((r) => oncePerClient.has(r.challenge_code) && asStatus(r.status) !== "void")
        .map((r) => claimKey(r.client_id, r.challenge_code)),
    ),
  };
}
