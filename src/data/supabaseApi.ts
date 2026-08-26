import { supabase } from "../lib/supabase";
import type { UploadPreview } from "../lib/ingest";
import { currentDrawMonth, passesForDraw } from "../lib/passes";
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

const fail = (context: string, error: { message: string } | null): never => {
  throw new ApiError(`${context}: ${error?.message ?? "unknown error"}`);
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

/**
 * The month a draw belongs to.
 *
 * Taken from `draw_date`, which is a real date, rather than from the free-text
 * `monthly_draw` — that column may hold "August", "Aug 2026" or "2026-08"
 * depending on who typed it, so it is kept for display only.
 */
const drawMonthOfRow = (row: DrawRow): DrawMonth => row.draw_date.slice(0, 7);

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
 * entered into, so it sets the first month the pass counts for; without one the
 * month is derived from `occurred_on`, which is the same rule the campaign runs
 * on paper. Nothing is treated as spent, matching the campaign term that winning
 * does not consume passes.
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
  // The schema records only whether a draw has happened, so a drawn draw is a
  // published one; there is no held-back state to represent.
  status: r.is_drawn ? "published" : "scheduled",
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
  // identically turns a one-line fix into a guessing game.
  if (error) {
    throw new ApiError(`Could not read the advisors table: ${error.message}`);
  }

  if (role === "admin") {
    return { userId, email, role: "admin", fullName: advisor?.fc_name ?? email, advisorId: advisor?.id ?? null };
  }

  if (advisor) {
    return { userId, email, role: "advisor", fullName: advisor.fc_name, advisorId: advisor.id };
  }

  // Row level security returns an empty result rather than an error when it
  // denies a read, so "no advisor" covers both "the column is not set" and "the
  // policy did not admit me". Naming the id being looked for lets either be
  // checked against the table in one query.
  throw new ApiError(
    `No consultant record is linked to this sign-in. No row in "advisors" is readable ` +
      `with auth_user_id = ${userId}. Either that column is not set, or the row level ` +
      `security policy did not admit this user.`,
  );
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
    return resolveViewer(
      data.user.id,
      data.user.email ?? email,
      data.user.app_metadata as Record<string, unknown> | undefined,
    );
  },

  async signOut() {
    await supabase().auth.signOut();
  },

  async currentViewer() {
    const { data } = await supabase().auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    return resolveViewer(
      user.id,
      user.email ?? "",
      user.app_metadata as Record<string, unknown> | undefined,
    );
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
      consumePassesOnWin: false,
      passExpiry: { gold: "campaign_end", blue: "month_end" },
    };
  },

  async getActivities(campaignId) {
    // challenge_types is a global rate card rather than per-campaign, so every
    // active row applies and the campaign id is stamped on in memory.
    const { data, error } = await supabase()
      .from("challenge_types")
      .select("code, label, pass_type, passes_per_unit, unit_noun, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order");
    if (error) fail("Could not load campaign activities", error);
    return (data as ChallengeTypeRow[]).map((r) => toActivity(r, campaignId));
  },

  async getAdvisorClients(advisorId, campaignId) {
    const db = supabase();
    const campaign = await this.getCampaign();
    const drawMonth = currentDrawMonth(campaign);

    const [{ data: clientRows, error: clientErr }, activities, draws] = await Promise.all([
      db
        .from("clients")
        .select("id, advisor_id, client_name, client_mobile, client_email")
        .eq("advisor_id", advisorId)
        .order("client_name"),
      this.getActivities(campaignId),
      this.getPublishedDraws(campaignId),
    ]);
    if (clientErr) fail("Could not load your clients", clientErr);

    const clients = (clientRows as ClientRow[]).map(toClient);
    if (clients.length === 0) return [];

    const { data: ledgerRows, error: ledgerErr } = await db
      .from("pass_ledger")
      .select("*")
      .eq("campaign_id", campaignId)
      .in("client_id", clients.map((c) => c.id));
    if (ledgerErr) fail("Could not load pass activity", ledgerErr);

    const drawMonths = new Map(draws.map((d) => [d.id, d.drawMonth]));
    const events = (ledgerRows as LedgerRow[]).map((r) => toPassEvent(r, drawMonths));

    return clients
      .map((client) => {
        const mine = events.filter((e) => e.clientId === client.id);
        return {
          client,
          gold: passesForDraw(mine, "gold", activities, campaign, drawMonth),
          blue: passesForDraw(mine, "blue", activities, campaign, drawMonth),
          hasAny: mine.length > 0,
        };
      })
      .filter((r) => r.hasAny)
      .map(({ client, gold, blue }) => ({ client, gold, blue }))
      .sort((a, b) => b.gold + b.blue - (a.gold + a.blue));
  },

  async getClientStatement(clientId, campaignId): Promise<ClientStatement> {
    const db = supabase();

    const [{ data: clientRow, error: clientErr }, { data: ledgerRows, error: ledgerErr }] =
      await Promise.all([
        db
          .from("clients")
          .select("id, advisor_id, client_name, client_mobile, client_email")
          .eq("id", clientId)
          .single<ClientRow>(),
        db
          .from("pass_ledger")
          .select("*")
          .eq("client_id", clientId)
          .eq("campaign_id", campaignId)
          .order("occurred_on"),
      ]);
    if (clientErr || !clientRow) fail("Could not load the client", clientErr);
    if (ledgerErr) fail("Could not load pass activity", ledgerErr);

    const draws = await this.getPublishedDraws(campaignId);
    const drawById = new Map(draws.map((d) => [d.id, d]));

    const { data: prizeRows, error: prizeErr } = await db
      .from("prizes_won")
      .select("id, client_id, draw_id, prize_won")
      .eq("client_id", clientId);
    if (prizeErr) fail("Could not load prizes", prizeErr);

    const { data: drawTypes } = await db
      .from("draws")
      .select("id, pass_type")
      .eq("campaign_id", campaignId);
    const passTypeByDraw = new Map(
      ((drawTypes ?? []) as { id: string; pass_type: string | null }[]).map((d) => [
        d.id,
        asPassType(d.pass_type),
      ]),
    );

    return {
      client: toClient(clientRow!),
      events: (ledgerRows as LedgerRow[]).map((r) =>
        toPassEvent(r, new Map(draws.map((d) => [d.id, d.drawMonth]))),
      ),
      winners: (prizeRows as PrizeRow[])
        // Only prizes from a draw that has actually happened; an unpublished
        // result is not the portal's news to break.
        .filter((p) => drawById.has(p.draw_id))
        .map((p) => ({
          id: p.id,
          drawId: p.draw_id,
          drawMonth: drawById.get(p.draw_id)!.drawMonth,
          clientId: p.client_id,
          displayName: shortenName(clientRow!.client_name),
          prize: p.prize_won,
          passType: passTypeByDraw.get(p.draw_id) ?? "blue",
        })),
    };
  },

  async getPublishedDraws(campaignId) {
    const { data, error } = await supabase()
      .from("draws")
      .select("id, campaign_id, monthly_draw, draw_date, pass_type, is_drawn")
      .eq("campaign_id", campaignId)
      .eq("is_drawn", true)
      .order("draw_date");
    if (error) fail("Could not load past draws", error);

    // The schema runs a separate draw per pass type each month; the portal shows
    // one chip per month, so same-month draws collapse to a single entry.
    const rows = (data as DrawRow[]).map(toDraw);
    const seen = new Set<DrawMonth>();
    return rows.filter((d) => (seen.has(d.drawMonth) ? false : (seen.add(d.drawMonth), true)));
  },

  async getWinners(campaignId: string, drawMonth: DrawMonth): Promise<DrawWinner[]> {
    const db = supabase();

    const { data: drawRows, error: drawErr } = await db
      .from("draws")
      .select("id, campaign_id, monthly_draw, draw_date, pass_type, is_drawn")
      .eq("campaign_id", campaignId)
      .eq("is_drawn", true);
    if (drawErr) fail("Could not load the draw", drawErr);

    const inMonth = (drawRows as DrawRow[]).filter((d) => drawMonthOfRow(d) === drawMonth);
    if (inMonth.length === 0) return [];
    const byId = new Map(inMonth.map((d) => [d.id, d]));

    const { data: prizeRows, error: prizeErr } = await db
      .from("prizes_won")
      .select("id, client_id, draw_id, prize_won")
      .in("draw_id", inMonth.map((d) => d.id));
    if (prizeErr) fail("Could not load winners", prizeErr);

    const prizes = prizeRows as PrizeRow[];
    if (prizes.length === 0) return [];

    // Winner names come from `clients`, so row level security decides which are
    // legible: an advisor sees their own clients named and the rest anonymous,
    // rather than the whole firm's client list.
    const { data: nameRows } = await db
      .from("clients")
      .select("id, client_name")
      .in("id", prizes.map((p) => p.client_id));
    const names = new Map(
      ((nameRows ?? []) as { id: string; client_name: string }[]).map((c) => [
        c.id,
        shortenName(c.client_name),
      ]),
    );

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

  async previewUpload(): Promise<UploadPreview> {
    throw new ApiError(
      "CSV upload is not connected to this database yet. The ledger is loaded outside the portal for now.",
    );
  },

  async commitUpload(): Promise<CommitResult> {
    throw new ApiError(
      "CSV upload is not connected to this database yet. The ledger is loaded outside the portal for now.",
    );
  },
};
