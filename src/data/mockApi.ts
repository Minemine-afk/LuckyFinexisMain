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
import { awaitingPasses, ballotPasses, livePasses, passView } from "../lib/passes";
import { shortenName } from "../lib/format";
import type {
  Activity,
  AdvisorClientRow,
  Campaign,
  ClientStatement,
  Draw,
  DrawMonth,
  DrawWinner,
  PassEvent,
} from "../lib/types";
import {
  ApiError,
  type CommitResult,
  type DrawEntrant,
  type PortalApi,
} from "./api";
import * as seed from "./mock";

const SESSION_KEY = "luckyfinexis.demo-session";
const LEDGER_KEY = "luckyfinexis.demo-ledger";
const DRAWS_KEY = "luckyfinexis.demo-draws";
const WINNERS_KEY = "luckyfinexis.demo-winners";
/** Any password is accepted in demo mode; this is the one the login screen shows. */
const DEMO_PASSWORD = "demo1234";

/**
 * Uploads mutate this copy, so an admin can upload a CSV and watch the passes
 * reach the client. It is mirrored into localStorage because otherwise a
 * refresh would quietly undo the upload, which looks like a broken import
 * rather than a demo running without a database.
 */
let ledger: PassEvent[];

/**
 * Draws and winners are mutable for the same reason the ledger is: recording a
 * draw is the one action in the app that spends passes, and a demo where the
 * consultant's totals do not visibly drop afterwards is demonstrating nothing.
 */
let draws: Draw[];
let winners: DrawWinner[];

/** Read a persisted demo table, falling back to the seed if it is missing or corrupt. */
function loadTable<T>(key: string, fallback: T[]): T[] {
  const stored = readStore("local", key);
  if (stored) {
    try {
      return JSON.parse(stored) as T[];
    } catch {
      // Corrupt or stale demo data falls back to the seed.
    }
  }
  return [...fallback];
}

/**
 * Storage access itself can throw, not just return null — a browser with site
 * data blocked, or an embedded preview frame. Demo sign-in must survive that.
 */
const readStore = (store: "session" | "local", key: string): string | null => {
  try {
    return (store === "session" ? sessionStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
};

const writeStore = (store: "session" | "local", key: string, value: string | null): void => {
  try {
    const target = store === "session" ? sessionStorage : localStorage;
    if (value === null) target.removeItem(key);
    else target.setItem(key, value);
  } catch {
    // Non-fatal: the choice just does not survive a reload.
  }
};

const saveLedger = (next: PassEvent[]): void => {
  ledger = next;
  writeStore("local", LEDGER_KEY, JSON.stringify(next));
};

const saveDraws = (next: Draw[]): void => {
  draws = next;
  writeStore("local", DRAWS_KEY, JSON.stringify(next));
};

const saveWinners = (next: DrawWinner[]): void => {
  winners = next;
  writeStore("local", WINNERS_KEY, JSON.stringify(next));
};

ledger = loadTable(LEDGER_KEY, seed.passEvents);
draws = loadTable(DRAWS_KEY, seed.draws);
winners = loadTable(WINNERS_KEY, seed.drawWinners);

const delay = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 120));

// Keyed on the client id rather than the external reference, matching both the
// natural key the importer builds and the unique index on `pass_ledger`.
const keyOf = (e: PassEvent): string => {
  const activity = seed.activities.find((a) => a.id === e.activityId);
  return naturalKey(
    e.campaignId,
    e.clientId,
    activity?.code ?? "",
    e.earnedOn,
    e.reference,
  );
};

const ingestContext = (campaignId: string): IngestContext => ({
  campaignId,
  activities: seed.activities,
  clients: seed.clients,
  existingKeys: new Set(ledger.map(keyOf)),
  // A voided row does not hold the slot: a cancelled testimonial should not
  // block the real one from being loaded later.
  claimed: new Set(
    ledger
      .filter((e) => e.status !== "void")
      .filter((e) => seed.activities.find((a) => a.id === e.activityId)?.oncePerClient)
      .map((e) => {
        const activity = seed.activities.find((a) => a.id === e.activityId);
        return claimKey(e.clientId, activity?.code ?? "");
      }),
  ),
});

export const mockApi: PortalApi = {
  async signIn(email, password) {
    const viewer = seed.demoViewers.find(
      (v) => v.email.toLowerCase() === email.trim().toLowerCase(),
    );
    if (!viewer) throw new ApiError("No demo account with that email address.");
    if (!password) throw new ApiError("Enter a password.");
    writeStore("session", SESSION_KEY, viewer.userId);
    return delay(viewer);
  },

  async signOut() {
    writeStore("session", SESSION_KEY, null);
  },

  async currentViewer() {
    const id = readStore("session", SESSION_KEY);
    if (!id) return null;
    return seed.demoViewers.find((v) => v.userId === id) ?? null;
  },

  async changePassword(currentPassword) {
    // Demo sign-in accepts any password, so there is no stored one to check
    // against. The shape of the call is still exercised — an empty current
    // password is refused, as it would be against Supabase.
    if (!currentPassword) throw new ApiError("Enter your current password.");
    await delay(null);
  },

  onSessionChange(handler) {
    // Demo sessions never expire, so there is nothing to poll. What can still
    // happen is a sign-out in another tab, which the storage event carries.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== SESSION_KEY) return;
      const id = readStore("session", SESSION_KEY);
      handler(id ? seed.demoViewers.find((v) => v.userId === id) ?? null : null);
    };
    try {
      window.addEventListener("storage", onStorage);
    } catch {
      return () => {};
    }
    return () => window.removeEventListener("storage", onStorage);
  },

  async getCampaign(): Promise<Campaign> {
    return delay(seed.campaign);
  },

  async getActivities(campaignId): Promise<Activity[]> {
    return delay(seed.activities.filter((a) => a.campaignId === campaignId));
  },

  async getAdvisorClients(advisorId, campaignId): Promise<AdvisorClientRow[]> {
    const mine = seed.clients.filter((c) => c.advisorId === advisorId);
    const inCampaign = draws.filter((d) => d.campaignId === campaignId);
    const view = passView(seed.campaign, inCampaign);
    const drawnIds = new Set(inCampaign.filter((d) => d.isDrawn).map((d) => d.id));
    const winnerIds = new Set(
      winners.filter((w) => drawnIds.has(w.drawId)).map((w) => w.clientId),
    );
    const rows = mine
      .map((client) => {
        const events = ledger.filter(
          (e) => e.clientId === client.id && e.campaignId === campaignId,
        );
        return {
          client,
          gold: livePasses(events, "gold", seed.activities, view),
          blue: livePasses(events, "blue", seed.activities, view),
          awaiting:
            awaitingPasses(events, "gold", seed.activities, view) +
            awaitingPasses(events, "blue", seed.activities, view),
          won: winnerIds.has(client.id),
          hasAny: events.length > 0,
        };
      })
      // A client with nothing in the ledger is not in the campaign yet, so the
      // advisor's table stays a list of people who have actually earned something.
      .filter((r) => r.hasAny)
      .map(({ client, gold, blue, awaiting, won }) => ({
        client, gold, blue, awaiting, won,
      }));

    return delay(rows.sort((a, b) => b.gold + b.blue - (a.gold + a.blue)));
  },

  async getClientStatement(clientId, campaignId): Promise<ClientStatement> {
    const client = seed.clients.find((c) => c.id === clientId);
    if (!client) throw new ApiError("Client not found.", 404);
    const drawnIds = new Set(draws.filter((d) => d.isDrawn).map((d) => d.id));
    return delay({
      client,
      events: ledger.filter((e) => e.clientId === clientId && e.campaignId === campaignId),
      winners: winners.filter((w) => w.clientId === clientId && drawnIds.has(w.drawId)),
    });
  },

  async getDraws(campaignId): Promise<Draw[]> {
    return delay(
      draws
        .filter((d) => d.campaignId === campaignId)
        .sort((a, b) => a.drawMonth.localeCompare(b.drawMonth)),
    );
  },

  async getWinners(campaignId: string, drawMonth: DrawMonth): Promise<DrawWinner[]> {
    // A month can hold a gold draw and a blue draw, so this is every winner of
    // every draw that has actually been run in that month.
    const ids = new Set(
      draws
        .filter((d) => d.campaignId === campaignId && d.drawMonth === drawMonth && d.isDrawn)
        .map((d) => d.id),
    );
    return delay(winners.filter((w) => ids.has(w.drawId)));
  },

  async getDrawEntrants(campaignId, drawId): Promise<DrawEntrant[]> {
    const inCampaign = draws.filter((d) => d.campaignId === campaignId);
    const draw = inCampaign.find((d) => d.id === drawId);
    if (!draw) throw new ApiError("That draw no longer exists.", 404);

    const view = passView(seed.campaign, inCampaign);
    return delay(
      seed.clients
        .map((client) => ({
          client,
          passes: ballotPasses(
            ledger.filter((e) => e.clientId === client.id && e.campaignId === campaignId),
            draw.passType,
            draw.drawMonth,
            seed.activities,
            view,
          ),
        }))
        .sort(
          (a, b) => b.passes - a.passes || a.client.fullName.localeCompare(b.client.fullName),
        ),
    );
  },

  async recordDraw(campaignId, drawId, entries): Promise<void> {
    const draw = draws.find((d) => d.id === drawId && d.campaignId === campaignId);
    if (!draw) throw new ApiError("That draw no longer exists.", 404);

    // Replaces rather than appends, mirroring the unique index on
    // (draw_id, client_id) that makes a second submit a no-op against Supabase.
    const others = winners.filter((w) => w.drawId !== drawId);
    saveWinners([
      ...others,
      ...entries.map((e, i) => ({
        id: `win-${drawId}-${i}`,
        drawId,
        drawMonth: draw.drawMonth,
        clientId: e.clientId,
        displayName: shortenName(
          seed.clients.find((c) => c.id === e.clientId)?.fullName ?? "A client",
        ),
        prize: e.prize.trim(),
        passType: draw.passType,
      })),
    ]);

    saveDraws(
      draws.map((d) =>
        d.id === drawId
          ? { ...d, isDrawn: true, drawnAt: new Date().toISOString().slice(0, 10) }
          : d,
      ),
    );
    await delay(null);
  },

  async undoDraw(drawId): Promise<void> {
    saveDraws(
      draws.map((d) => (d.id === drawId ? { ...d, isDrawn: false, drawnAt: null } : d)),
    );
    saveWinners(winners.filter((w) => w.drawId !== drawId));
    await delay(null);
  },

  async previewUpload(file, campaignId): Promise<UploadPreview> {
    const text = await file.text();
    const { headers, rows, lines } = parseCsv(text);
    const missing = missingHeaders(headers);
    if (missing.length) {
      throw new ApiError(`The file is missing required columns: ${missing.join(", ")}`);
    }
    return buildPreview(file.name, rows, lines, ingestContext(campaignId));
  },

  async commitUpload(preview, campaignId): Promise<CommitResult> {
    const ctx = ingestContext(campaignId);
    const created = toPassEvents(preview, ctx, `pe-up-${ledger.length}`);
    saveLedger([...ledger, ...created]);
    return delay({
      inserted: created.length,
      skipped: preview.counts.duplicate + preview.counts.reject,
    });
  },
};

/** Backs the "reset demo data" control on the admin page. */
export const resetMockLedger = (): void => {
  saveLedger([...seed.passEvents]);
  // Draws and winners too, or a demo that has recorded a draw cannot be put
  // back — the passes would stay spent however many times you reset.
  saveDraws([...seed.draws]);
  saveWinners([...seed.drawWinners]);
};

export const DEMO_ACCOUNTS = seed.demoViewers.map((v) => ({
  email: v.email,
  role: v.role,
  name: v.fullName,
  password: DEMO_PASSWORD,
}));
