import type {
  Activity,
  DrawMonth,
  PassEvent,
  PassStatus,
  PassType,
} from "./types";

/** Passes only count toward a draw once they are valid and not already spent. */
export const countsTowardDraw = (e: PassEvent): boolean =>
  e.status === "valid" && e.consumedByDrawId === null;

const sumPasses = (events: PassEvent[]): number =>
  events.reduce((n, e) => n + e.passes, 0);

export interface ActivityRow {
  activity: Activity;
  /** Valid, unspent passes — the number the mockup shows. */
  passes: number;
  /** How many times the client did the thing. */
  units: number;
  /** Earned but not yet countable, shown only when non-zero. */
  pending: number;
  /** Clawed back, shown only when non-zero. */
  voided: number;
}

export interface PassBlock {
  passType: PassType;
  total: number;
  pending: number;
  voided: number;
  rows: ActivityRow[];
}

/**
 * Build the two tables of the client statement: one block per pass type, each
 * listing every activity in the campaign — including the ones worth zero, which
 * the mockup shows as 0 rather than hiding, because a client wants to see what
 * they could still be earning.
 */
export function buildPassBlocks(
  activities: Activity[],
  events: PassEvent[],
): PassBlock[] {
  const byType = new Map<PassType, Activity[]>();
  for (const a of [...activities].sort((x, y) => x.sortOrder - y.sortOrder)) {
    const list = byType.get(a.passType) ?? [];
    list.push(a);
    byType.set(a.passType, list);
  }

  const order: PassType[] = ["gold", "blue"];
  return order
    .filter((t) => byType.has(t))
    .map((passType) => {
      const rows = (byType.get(passType) ?? []).map((activity) => {
        const mine = events.filter((e) => e.activityId === activity.id);
        const valid = mine.filter(countsTowardDraw);
        return {
          activity,
          passes: sumPasses(valid),
          units: valid.reduce((n, e) => n + e.units, 0),
          pending: sumPasses(mine.filter((e) => e.status === "pending")),
          voided: sumPasses(mine.filter((e) => e.status === "void")),
        };
      });

      return {
        passType,
        total: rows.reduce((n, r) => n + r.passes, 0),
        pending: rows.reduce((n, r) => n + r.pending, 0),
        voided: rows.reduce((n, r) => n + r.voided, 0),
        rows,
      };
    });
}

/** Valid, unspent passes of one type — what the advisor's table column shows. */
export function totalPasses(events: PassEvent[], passType: PassType, activities: Activity[]): number {
  const ids = new Set(activities.filter((a) => a.passType === passType).map((a) => a.id));
  return sumPasses(events.filter((e) => ids.has(e.activityId) && countsTowardDraw(e)));
}

/**
 * Passes in the barrel for a given monthly draw.
 *
 * A pass earned in July is in the July draw and every draw after it, so
 * eligibility is "earned on or before this month" rather than "earned in this
 * month". Passes already spent on a win drop out.
 */
export function passesEligibleForDraw(
  events: PassEvent[],
  drawMonth: DrawMonth,
  passType: PassType,
  activities: Activity[],
): number {
  const ids = new Set(activities.filter((a) => a.passType === passType).map((a) => a.id));
  return sumPasses(
    events.filter(
      (e) => ids.has(e.activityId) && countsTowardDraw(e) && e.drawMonth <= drawMonth,
    ),
  );
}

/** "2026-08-14" → "2026-08". The draw a pass first becomes eligible for. */
export function drawMonthOf(earnedOn: string): DrawMonth {
  return earnedOn.slice(0, 7);
}

export const STATUS_LABEL: Record<PassStatus, string> = {
  valid: "Valid",
  pending: "Pending",
  void: "Voided",
};
