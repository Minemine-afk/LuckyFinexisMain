import { parseCsv } from "../lib/csv";
import {
  buildPreview,
  missingHeaders,
  naturalKey,
  toPassEvents,
  type IngestContext,
  type UploadPreview,
} from "../lib/ingest";
import { currentDrawMonth, passesForDraw } from "../lib/passes";
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

const keyOf = (e: PassEvent): string => {
  const client = seed.clients.find((c) => c.id === e.clientId);
  const activity = seed.activities.find((a) => a.id === e.activityId);
  return naturalKey(
    e.campaignId,
    client?.externalRef ?? "",
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

  async getCampaign(): Promise<Campaign> {
    return delay(seed.campaign);
  },

  async getActivities(campaignId): Promise<Activity[]> {
    return delay(seed.activities.filter((a) => a.campaignId === campaignId));
  },

  async getAdvisorClients(advisorId, campaignId): Promise<AdvisorClientRow[]> {
    const mine = seed.clients.filter((c) => c.advisorId === advisorId);
    const drawMonth = currentDrawMonth(seed.campaign);
    const rows = mine
      .map((client) => {
        const events = ledger.filter(
          (e) => e.clientId === client.id && e.campaignId === campaignId,
        );
        return {
          client,
          gold: passesForDraw(events, "gold", seed.activities, seed.campaign, drawMonth),
          blue: passesForDraw(events, "blue", seed.activities, seed.campaign, drawMonth),
          hasAny: events.length > 0,
        };
      })
      // A client with nothing in the ledger is not in the campaign yet, so the
      // advisor's table stays a list of people who have actually earned something.
      .filter((r) => r.hasAny)
      .map(({ client, gold, blue }) => ({ client, gold, blue }));

    return delay(rows.sort((a, b) => b.gold + b.blue - (a.gold + a.blue)));
  },

  async getClientStatement(clientId, campaignId): Promise<ClientStatement> {
    const client = seed.clients.find((c) => c.id === clientId);
    if (!client) throw new ApiError("Client not found.", 404);
    const publishedDrawIds = new Set(
      seed.draws.filter((d) => d.status === "published").map((d) => d.id),
    );
    return delay({
      client,
      events: ledger.filter((e) => e.clientId === clientId && e.campaignId === campaignId),
      winners: seed.drawWinners.filter(
        (w) => w.clientId === clientId && publishedDrawIds.has(w.drawId),
      ),
    });
  },

  async getPublishedDraws(campaignId): Promise<Draw[]> {
    return delay(
      seed.draws
        .filter((d) => d.campaignId === campaignId && d.status === "published")
        .sort((a, b) => a.drawMonth.localeCompare(b.drawMonth)),
    );
  },

  async getWinners(campaignId: string, drawMonth: DrawMonth): Promise<DrawWinner[]> {
    const draw = seed.draws.find(
      (d) => d.campaignId === campaignId && d.drawMonth === drawMonth,
    );
    if (!draw || draw.status !== "published") return delay([]);
    return delay(seed.drawWinners.filter((w) => w.drawId === draw.id));
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
