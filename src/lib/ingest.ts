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
  clientRef: string;
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
 */
export const naturalKey = (
  campaignId: string,
  clientRef: string,
  activityCode: string,
  earnedOn: string,
  reference: string,
): string =>
  [campaignId, clientRef, activityCode, earnedOn, reference]
    .map((p) => p.trim().toLowerCase())
    .join("|");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DRAW_MONTH = /^\d{4}-\d{2}$/;
const STATUSES: PassStatus[] = ["valid", "pending", "void"];

export interface IngestContext {
  campaignId: string;
  activities: Activity[];
  clients: ClientRecord[];
  /** Natural keys already in the ledger. */
  existingKeys: Set<string>;
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
  const clientByRef = new Map(ctx.clients.map((c) => [c.externalRef.toLowerCase(), c]));
  const seenInFile = new Set<string>();

  const previewRows = rows.map((row, i): PreviewRow => {
    const clientRef = row.client_ref ?? "";
    const activityCode = row.activity_code ?? "";
    const earnedOn = row.earned_on ?? "";
    const reference = row.reference ?? "";
    const activity = activityByCode.get(activityCode);
    const client = clientByRef.get(clientRef.toLowerCase());
    const units = Number(row.units);
    const key = naturalKey(ctx.campaignId, clientRef, activityCode, earnedOn, reference);

    const base = {
      line: lines[i] ?? i + 2,
      clientRef,
      clientName: client?.fullName ?? row.client_name ?? "—",
      activityCode,
      activityLabel: activity?.label ?? activityCode,
      earnedOn,
      reference,
      units: Number.isFinite(units) ? units : 0,
      passes: 0,
      drawMonth: "",
      status: "valid" as PassStatus,
      naturalKey: key,
    };

    const reject = (reason: string): PreviewRow => ({
      ...base,
      outcome: "reject",
      reason,
    });

    if (!clientRef) return reject("client_ref is blank");
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

    const filled: PreviewRow = {
      ...base,
      passes: units * activity.passesPerUnit,
      drawMonth,
      status,
      outcome: "insert",
      reason: null,
    };

    if (ctx.existingKeys.has(key)) {
      return { ...filled, outcome: "duplicate", reason: "Already in the ledger" };
    }
    if (seenInFile.has(key)) {
      return { ...filled, outcome: "duplicate", reason: "Repeated earlier in this file" };
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
  const clientByRef = new Map(ctx.clients.map((c) => [c.externalRef.toLowerCase(), c]));

  return preview.rows
    .filter((r) => r.outcome === "insert")
    .map((r, i) => {
      const activity = activityByCode.get(r.activityCode)!;
      const client = clientByRef.get(r.clientRef.toLowerCase())!;
      return {
        id: `${idPrefix}-${i}`,
        campaignId: ctx.campaignId,
        clientId: client.id,
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
