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
import { awaitingPasses, livePasses, passView } from "../lib/passes";
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
import { ApiError, type CommitResult, type PortalApi } from "./api";
import * as seed from "./mock";

const SESSION_KEY = "luckyfinexis.demo-session";
const LEDGER_KEY = "luckyfinexis.demo-ledger";
/** Any password is accepted in demo mode; this is the one the login screen shows. */
const DEMO_PASSWORD = "demo1234";

/**
 * Uploads mutate this copy, so an admin can upload a CSV and watch the passes
 * reach the client. It is mirrored into localStorage because otherwise a
 * refresh would quietly undo the upload, which looks like a broken import
 * rather than a demo running without a database.
 */
let ledger: PassEvent[];

const loadLedger = (): PassEvent[] => {
  const stored = readStore("local", LEDGER_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as PassEvent[];
    } catch {
      // Corrupt or stale demo data falls back to the seed.
    }
  }
  return [...seed.passEvents];
};

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

ledger = loadLedger();

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
    const draws = seed.draws.filter((d) => d.campaignId === campaignId);
    const view = passView(seed.campaign, draws);
    const drawnIds = new Set(draws.filter((d) => d.isDrawn).map((d) => d.id));
    const winnerIds = new Set(
      seed.drawWinners.filter((w) => drawnIds.has(w.drawId)).map((w) => w.clientId),
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
    const drawnIds = new Set(seed.draws.filter((d) => d.isDrawn).map((d) => d.id));
    return delay({
      client,
      events: ledger.filter((e) => e.clientId === clientId && e.campaignId === campaignId),
      winners: seed.drawWinners.filter(
        (w) => w.clientId === clientId && drawnIds.has(w.drawId),
      ),
    });
  },

  async getDraws(campaignId): Promise<Draw[]> {
    return delay(
      seed.draws
        .filter((d) => d.campaignId === campaignId)
        .sort((a, b) => a.drawMonth.localeCompare(b.drawMonth)),
    );
  },

  async getWinners(campaignId: string, drawMonth: DrawMonth): Promise<DrawWinner[]> {
    // A month can hold a gold draw and a blue draw, so this is every winner of
    // every draw that has actually been run in that month.
    const ids = new Set(
      seed.draws
        .filter((d) => d.campaignId === campaignId && d.drawMonth === drawMonth && d.isDrawn)
        .map((d) => d.id),
    );
    return delay(seed.drawWinners.filter((w) => ids.has(w.drawId)));
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
};

export const DEMO_ACCOUNTS = seed.demoViewers.map((v) => ({
  email: v.email,
  role: v.role,
  name: v.fullName,
  password: DEMO_PASSWORD,
}));
