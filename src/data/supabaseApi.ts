import { supabase } from "../lib/supabase";
import type { UploadPreview } from "../lib/ingest";
import { currentDrawMonth, passesForDraw } from "../lib/passes";
import type {
  Activity,
  AdvisorClientRow,
  Campaign,
  ClientRecord,
  ClientStatement,
  Draw,
  DrawMonth,
  PassEvent,
  Role,
  Viewer,
} from "../lib/types";
import { ApiError, type CommitResult, type PortalApi } from "./api";

/**
 * Supabase-backed provider.
 *
 * Reads go straight from the browser to PostgREST: row level security decides
 * what comes back, so a client requesting every pass event simply receives their
 * own rows, and an advisor receives their own clients'. There is no filtering in
 * this file that the database does not also enforce — the `.eq()` calls below
 * are there to keep responses small, not to keep them safe.
 *
 * Writes that need privilege (CSV ingest) go to Cloudflare Pages Functions,
 * which hold the service role key as a Worker secret and re-check the caller's
 * role server-side.
 */

/* ---------- row shapes as they come back from Postgres ---------- */

interface CampaignRow {
  id: string;
  name: string;
  slug: string;
  starts_on: string;
  ends_on: string;
  details_image_path: string | null;
  data_as_of: string | null;
  consume_passes_on_win: boolean;
  gold_pass_expiry: "month_end" | "campaign_end" | null;
  blue_pass_expiry: "month_end" | "campaign_end" | null;
}

interface ActivityRow {
  id: string;
  campaign_id: string;
  code: string;
  label: string;
  pass_type: "gold" | "blue";
  passes_per_unit: number;
  unit_label: string | null;
  sort_order: number;
}

interface ClientRow {
  id: string;
  external_ref: string;
  full_name: string;
  email: string;
  mobile: string;
  advisor_id: string;
}

interface PassEventRow {
  id: string;
  campaign_id: string;
  client_id: string;
  activity_id: string;
  units: number;
  passes: number;
  earned_on: string;
  draw_month: string;
  status: "valid" | "pending" | "void";
  void_reason: string | null;
  consumed_by_draw_id: string | null;
  reference: string;
}

interface DrawRow {
  id: string;
  campaign_id: string;
  draw_month: string;
  status: "scheduled" | "drawn" | "published";
  drawn_at: string | null;
}

interface DrawWinnerRow {
  id: string;
  draw_id: string;
  client_id: string;
  display_name: string;
  prize: string;
  pass_type: "gold" | "blue";
  draws: { draw_month: string } | null;
}

/* ---------- mappers ---------- */

const toActivity = (r: ActivityRow): Activity => ({
  id: r.id,
  campaignId: r.campaign_id,
  code: r.code,
  label: r.label,
  passType: r.pass_type,
  passesPerUnit: r.passes_per_unit,
  unitLabel: r.unit_label,
  sortOrder: r.sort_order,
});

const toClient = (r: ClientRow): ClientRecord => ({
  id: r.id,
  externalRef: r.external_ref,
  fullName: r.full_name,
  email: r.email,
  mobile: r.mobile,
  advisorId: r.advisor_id,
});

const toPassEvent = (r: PassEventRow): PassEvent => ({
  id: r.id,
  campaignId: r.campaign_id,
  clientId: r.client_id,
  activityId: r.activity_id,
  units: r.units,
  passes: r.passes,
  earnedOn: r.earned_on,
  drawMonth: r.draw_month,
  status: r.status,
  voidReason: r.void_reason,
  consumedByDrawId: r.consumed_by_draw_id,
  reference: r.reference,
});

const toDraw = (r: DrawRow): Draw => ({
  id: r.id,
  campaignId: r.campaign_id,
  drawMonth: r.draw_month,
  status: r.status,
  drawnAt: r.drawn_at,
});

/* ---------- helpers ---------- */

const fail = (context: string, error: { message: string } | null): never => {
  throw new ApiError(`${context}: ${error?.message ?? "unknown error"}`);
};

/** Campaign artwork lives in a private bucket, so the link is signed on demand. */
async function signDetailsImage(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase()
    .storage.from("campaign-assets")
    .createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}

async function callFunction<T>(
  path: string,
  init: { body: BodyInit; headers?: Record<string, string> },
): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("Your session has expired. Sign in again.", 401);

  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    body: init.body,
  });

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new ApiError(message || `Request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

/* ---------- provider ---------- */

async function resolveViewer(userId: string, email: string): Promise<Viewer> {
  const db = supabase();

  const { data: profile, error } = await db
    .from("profiles")
    .select("role, full_name")
    .eq("id", userId)
    .single();
  if (error || !profile) {
    fail("Could not load your profile", error);
  }

  const role = profile!.role as Role;
  const viewer: Viewer = {
    userId,
    email,
    role,
    fullName: profile!.full_name,
    clientId: null,
    advisorId: null,
  };

  if (role === "client") {
    const { data } = await db.from("clients").select("id").eq("profile_id", userId).maybeSingle();
    viewer.clientId = data?.id ?? null;
    if (!viewer.clientId) {
      throw new ApiError("Your sign-in is not linked to a client record yet.");
    }
  }

  if (role === "advisor") {
    const { data } = await db.from("advisors").select("id").eq("profile_id", userId).maybeSingle();
    viewer.advisorId = data?.id ?? null;
    if (!viewer.advisorId) {
      throw new ApiError("Your sign-in is not linked to a consultant record yet.");
    }
  }

  return viewer;
}

export const supabaseApi: PortalApi = {
  async signIn(email, password) {
    const { data, error } = await supabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error || !data.user) {
      throw new ApiError(error?.message ?? "Could not sign you in.", error?.status);
    }
    return resolveViewer(data.user.id, data.user.email ?? email);
  },

  async signOut() {
    await supabase().auth.signOut();
  },

  async currentViewer() {
    const { data } = await supabase().auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    return resolveViewer(user.id, user.email ?? "");
  },

  async getCampaign(): Promise<Campaign> {
    const { data, error } = await supabase()
      .from("campaigns")
      .select("*")
      .eq("is_active", true)
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle<CampaignRow>();
    if (error || !data) fail("Could not load the campaign", error);

    const row = data!;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      detailsImageUrl: await signDetailsImage(row.details_image_path),
      dataAsOf: row.data_as_of,
      consumePassesOnWin: row.consume_passes_on_win,
      // Defaults match the campaign terms: blue passes are spent in the month
      // they are earned, gold accumulates. A campaign row that has not been
      // migrated yet still behaves correctly rather than expiring nothing.
      passExpiry: {
        gold: row.gold_pass_expiry ?? "campaign_end",
        blue: row.blue_pass_expiry ?? "month_end",
      },
    };
  },

  async getActivities(campaignId) {
    const { data, error } = await supabase()
      .from("activities")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("is_active", true)
      .order("sort_order");
    if (error) fail("Could not load campaign activities", error);
    return (data as ActivityRow[]).map(toActivity);
  },

  async getAdvisorClients(advisorId, campaignId) {
    const db = supabase();
    const campaign = await this.getCampaign();
    const drawMonth = currentDrawMonth(campaign);

    const [{ data: clientRows, error: clientErr }, activities] = await Promise.all([
      db.from("clients").select("*").eq("advisor_id", advisorId).order("full_name"),
      this.getActivities(campaignId),
    ]);
    if (clientErr) fail("Could not load your clients", clientErr);

    const clients = (clientRows as ClientRow[]).map(toClient);
    if (clients.length === 0) return [];

    const { data: eventRows, error: eventErr } = await db
      .from("pass_events")
      .select("*")
      .eq("campaign_id", campaignId)
      .in("client_id", clients.map((c) => c.id));
    if (eventErr) fail("Could not load pass activity", eventErr);

    const events = (eventRows as PassEventRow[]).map(toPassEvent);
    const rows: AdvisorClientRow[] = clients
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
      .map(({ client, gold, blue }) => ({ client, gold, blue }));

    return rows.sort((a, b) => b.gold + b.blue - (a.gold + a.blue));
  },

  async getClientStatement(clientId, campaignId): Promise<ClientStatement> {
    const db = supabase();

    const [{ data: clientRow, error: clientErr }, { data: eventRows, error: eventErr }] =
      await Promise.all([
        db.from("clients").select("*").eq("id", clientId).single<ClientRow>(),
        db
          .from("pass_events")
          .select("*")
          .eq("client_id", clientId)
          .eq("campaign_id", campaignId)
          .order("earned_on"),
      ]);
    if (clientErr || !clientRow) fail("Could not load the client", clientErr);
    if (eventErr) fail("Could not load pass activity", eventErr);

    // Only published draws are shown; an unpublished result is not the client's
    // news to hear from a portal.
    const { data: winnerRows, error: winnerErr } = await db
      .from("draw_winners")
      .select("*, draws!inner(draw_month, status, campaign_id)")
      .eq("client_id", clientId)
      .eq("draws.campaign_id", campaignId)
      .eq("draws.status", "published");
    if (winnerErr) fail("Could not load prizes", winnerErr);

    return {
      client: toClient(clientRow!),
      events: (eventRows as PassEventRow[]).map(toPassEvent),
      winners: (winnerRows as DrawWinnerRow[]).map((w) => ({
        id: w.id,
        drawId: w.draw_id,
        drawMonth: w.draws?.draw_month ?? "",
        clientId: w.client_id,
        displayName: w.display_name,
        prize: w.prize,
        passType: w.pass_type,
      })),
    };
  },

  async getPublishedDraws(campaignId) {
    const { data, error } = await supabase()
      .from("draws")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("status", "published")
      .order("draw_month");
    if (error) fail("Could not load past draws", error);
    return (data as DrawRow[]).map(toDraw);
  },

  async getWinners(campaignId: string, drawMonth: DrawMonth) {
    const { data, error } = await supabase()
      .from("draw_winners")
      .select("*, draws!inner(draw_month, status, campaign_id)")
      .eq("draws.campaign_id", campaignId)
      .eq("draws.draw_month", drawMonth)
      .eq("draws.status", "published");
    if (error) fail("Could not load winners", error);
    return (data as DrawWinnerRow[]).map((w) => ({
      id: w.id,
      drawId: w.draw_id,
      drawMonth: w.draws?.draw_month ?? drawMonth,
      clientId: w.client_id,
      displayName: w.display_name,
      prize: w.prize,
      passType: w.pass_type,
    }));
  },

  async previewUpload(file, campaignId): Promise<UploadPreview> {
    const body = new FormData();
    body.append("file", file);
    body.append("campaign_id", campaignId);
    return callFunction<UploadPreview>("/api/uploads/preview", { body });
  },

  async commitUpload(preview, campaignId): Promise<CommitResult> {
    return callFunction<CommitResult>("/api/uploads/commit", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaign_id: campaignId, preview }),
    });
  },
};
