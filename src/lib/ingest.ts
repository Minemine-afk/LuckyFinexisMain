import type { CsvRow } from "./csv";
import { drawMonthOf } from "./passes";
import type { Activity, ClientRecord, PassEvent, PassStatus } from "./types";

/**
 * Turning CSV rows into ledger entries.
 *
 * The ledger is append-only, so an upload never overwrites anything: each row
 * either becomes a new pass event, is recognised as one already stored, or is
 * rejected with a reason the admin can act on. Re-uploading last week's file is
 * therefore a no-op rather than a duplicate award, which is the whole point of
 * the natural key below.
 */

export const REQUIRED_HEADERS = [
  "client_ref",
  "activity_code",
  "units",
  "earned_on",
] as const;

export const OPTIONAL_HEADERS = [
  "fc_code",
  "client_name",
  "client_email",
  "client_mobile",
  "reference",
  "draw_month",
  "status",
  "void_reason",
] as const;

export type RowOutcome = "insert" | "duplicate" | "reject";

export interface PreviewRow {
  /** Line in the source file, so "row 42" means something to whoever fixes it. */
  line: number;
  outcome: RowOutcome;
  reason: string | null;
  /** Verbatim from the file, so a reject reason can quote what was written. */
  clientRef: string;
  /**
   * The client the row resolved to. Empty on a rejected row, which by
   * definition never resolved one.
   */
  clientId: string;
  clientName: string;
  activityCode: string;
  activityLabel: string;
  /** Kept verbatim: the natural key is case-folded, the ledger entry is not. */
  earnedOn: string;
  reference: string;
  units: number;
  passes: number;
  drawMonth: string;
  status: PassStatus;
  naturalKey: string;
}

export interface UploadPreview {
  filename: string;
  rows: PreviewRow[];
  counts: Record<RowOutcome, number>;
}

/**
 * What makes a row unique. Two uploads describing the same event — same client,
 * same activity, same date, same reference — collapse to one ledger entry.
 * `reference` is what separates two genuinely different events on the same day
 * (two policies, two referrals), which is why an empty reference is allowed but
 * means "there is only one of these per client per activity per day".
 *
 * **`clientId` is the resolved client, not the `client_ref` the file carried.**
 * A spreadsheet may identify a client by email one month and by a client code
 * the next; keyed on the raw text those are two different keys for one event,
 * and re-running a load would double the passes. Keyed on the client id they
 * agree — and they agree with the unique index on `pass_ledger`, which is
 * built from `client_id` for the same reason.
 */
export const naturalKey = (
  campaignId: string,
  clientId: string,
  activityCode: string,
  earnedOn: string,
  reference: string,
): string =>
  [campaignId, clientId, activityCode, earnedOn, reference]
    .map((p) => p.trim().toLowerCase())
    .join("|");

/** A `client_ref` that matches more than one client resolves to this. */
const AMBIGUOUS = Symbol("ambiguous");

type Match = ClientRecord | typeof AMBIGUOUS;

/**
 * Index clients by every identifier a spreadsheet might plausibly carry — the
 * primary key, the external reference, and the email address.
 *
 * The alternative was choosing one, and every choice was wrong for someone: the
 * Supabase mapping puts the UUID in `externalRef` because `clients` has no
 * reference column, and nobody is typing UUIDs into a spreadsheet. Accepting
 * any of them works with emails today and with a proper client code the day one
 * exists, with no further change.
 *
 * A value that matches two different clients is marked ambiguous rather than
 * resolving to whichever was indexed last. Couples who are both clients of the
 * same consultant often share an email, and silently filing one person's passes
 * against their spouse is worse than refusing the row.
 */
function indexClients(clients: ClientRecord[]): Map<string, Match> {
  const index = new Map<string, Match>();

  const add = (value: string | null | undefined, client: ClientRecord): void => {
    const key = (value ?? "").trim().toLowerCase();
    if (!key) return;
    const seen = index.get(key);
    if (seen === undefined) index.set(key, client);
    else if (seen !== AMBIGUOUS && seen.id !== client.id) index.set(key, AMBIGUOUS);
  };

  for (const client of clients) {
    add(client.id, client);
    add(client.externalRef, client);
    add(client.email, client);
  }
  return index;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DRAW_MONTH = /^\d{4}-\d{2}$/;
const STATUSES: PassStatus[] = ["valid", "pending", "void"];

/**
 * What a client has already claimed of a once-per-client activity. Separate from
 * the natural key because the whole point is that the date and reference do
 * *not* make a second one distinct.
 */
export const claimKey = (clientId: string, activityCode: string): string =>
  [clientId, activityCode].map((p) => p.trim().toLowerCase()).join("|");

export interface IngestContext {
  campaignId: string;
  activities: Activity[];
  clients: ClientRecord[];
  /** Natural keys already in the ledger. */
  existingKeys: Set<string>;
  /** `claimKey`s of once-per-client activities already earned, void rows aside. */
  claimed: Set<string>;
}

/** Header problems are fatal for the whole file, so they are reported separately. */
export function missingHeaders(headers: string[]): string[] {
  return REQUIRED_HEADERS.filter((h) => !headers.includes(h));
}

export function buildPreview(
  filename: string,
  rows: CsvRow[],
  lines: number[],
  ctx: IngestContext,
): UploadPreview {
  const activityByCode = new Map(ctx.activities.map((a) => [a.code, a]));
  const clientIndex = indexClients(ctx.clients);
  const seenInFile = new Set<string>();
  // Claims made earlier in this same file, so one upload carrying two finConnect
  // rows for a client lands only the first — the ledger is not consulted twice.
  const claimedInFile = new Set<string>();

  const previewRows = rows.map((row, i): PreviewRow => {
    const clientRef = row.client_ref ?? "";
    const activityCode = row.activity_code ?? "";
    const earnedOn = row.earned_on ?? "";
    const reference = row.reference ?? "";
    const activity = activityByCode.get(activityCode);
    const match = clientIndex.get(clientRef.trim().toLowerCase());
    const client = match === AMBIGUOUS ? undefined : match;
    const units = Number(row.units);

    const base = {
      line: lines[i] ?? i + 2,
      clientRef,
      clientId: "",
      clientName: client?.fullName ?? row.client_name ?? "—",
      activityCode,
      activityLabel: activity?.label ?? activityCode,
      earnedOn,
      reference,
      units: Number.isFinite(units) ? units : 0,
      passes: 0,
      drawMonth: "",
      status: "valid" as PassStatus,
      // Placeholder until the client resolves. A rejected row never has its key
      // compared against anything; it only has to be unique enough to render.
      naturalKey: `unresolved|${clientRef}|${activityCode}|${earnedOn}|${reference}`,
    };

    const reject = (reason: string): PreviewRow => ({
      ...base,
      outcome: "reject",
      reason,
    });

    if (!clientRef) return reject("client_ref is blank");
    if (match === AMBIGUOUS) {
      return reject(
        `"${clientRef}" matches more than one client — use a reference unique to one`,
      );
    }
    if (!client) return reject(`No client with reference ${clientRef}`);
    if (!activityCode) return reject("activity_code is blank");
    if (!activity) return reject(`Unknown activity_code "${activityCode}"`);
    if (!ISO_DATE.test(earnedOn)) return reject("earned_on must be YYYY-MM-DD");
    if (!Number.isInteger(units) || units <= 0) return reject("units must be a whole number above zero");

    const status = (row.status || "valid").toLowerCase() as PassStatus;
    if (!STATUSES.includes(status)) {
      return reject(`status must be one of ${STATUSES.join(", ")}`);
    }

    const drawMonth = row.draw_month || drawMonthOf(earnedOn);
    if (!DRAW_MONTH.test(drawMonth)) return reject("draw_month must be YYYY-MM");
    if (drawMonth < drawMonthOf(earnedOn)) {
      return reject("draw_month is before the month the pass was earned");
    }

    // Only now that the client has resolved, because the key is built from the
    // client id rather than whatever text the file used to name them.
    const key = naturalKey(ctx.campaignId, client.id, activityCode, earnedOn, reference);

    const filled: PreviewRow = {
      ...base,
      clientId: client.id,
      passes: units * activity.passesPerUnit,
      drawMonth,
      status,
      naturalKey: key,
      outcome: "insert",
      reason: null,
    };

    if (ctx.existingKeys.has(key)) {
      return { ...filled, outcome: "duplicate", reason: "Already in the ledger" };
    }
    if (seenInFile.has(key)) {
      return { ...filled, outcome: "duplicate", reason: "Repeated earlier in this file" };
    }

    // Checked after the natural key so that re-uploading the very same row still
    // reads "Already in the ledger", which is the more precise answer.
    if (activity.oncePerClient && status !== "void") {
      const claim = claimKey(client.id, activityCode);
      if (ctx.claimed.has(claim) || claimedInFile.has(claim)) {
        return {
          ...filled,
          outcome: "duplicate",
          reason: `${activity.label} counts once per client, and this one already has it`,
        };
      }
      claimedInFile.add(claim);
    }

    seenInFile.add(key);
    return filled;
  });

  const counts: Record<RowOutcome, number> = { insert: 0, duplicate: 0, reject: 0 };
  for (const r of previewRows) counts[r.outcome] += 1;

  return { filename, rows: previewRows, counts };
}

/** Turn the accepted rows of a preview into ledger entries. */
export function toPassEvents(
  preview: UploadPreview,
  ctx: IngestContext,
  idPrefix: string,
): PassEvent[] {
  const activityByCode = new Map(ctx.activities.map((a) => [a.code, a]));

  return preview.rows
    .filter((r) => r.outcome === "insert")
    .map((r, i) => {
      // Both resolved during the preview. An "insert" row that got past the
      // rejects has a known activity and a known client, and re-resolving the
      // client here from `clientRef` would risk disagreeing with the natural
      // key the preview already built and showed to the admin.
      const activity = activityByCode.get(r.activityCode)!;
      return {
        id: `${idPrefix}-${i}`,
        campaignId: ctx.campaignId,
        clientId: r.clientId,
        activityId: activity.id,
        units: r.units,
        passes: r.passes,
        earnedOn: r.earnedOn,
        drawMonth: r.drawMonth,
        status: r.status,
        voidReason: null,
        consumedByDrawId: null,
        reference: r.reference,
      };
    });
}
