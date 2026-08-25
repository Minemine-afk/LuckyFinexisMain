import type {
  Activity,
  DrawMonth,
  PassEvent,
  PassExpiry,
  PassStatus,
  PassType,
} from "./types";

/*
 * How long a pass of a given type keeps counting, per `PassExpiry` in types.ts:
 * `month_end` — in the draw for the month it was earned, and no later.
 * `campaign_end` — carries forward through every remaining draw.
 */

/** The campaign settings the pass arithmetic depends on. */
export interface CampaignRules {
  passExpiry: Record<PassType, PassExpiry>;
  /** ISO date the campaign closes; the last month any pass can count for. */
  endsOn: string;
}

/** A pass counts only while it is valid and has not been spent on a win. */
export const countsTowardDraw = (e: PassEvent): boolean =>
  e.status === "valid" && e.consumedByDrawId === null;

const sumPasses = (events: PassEvent[]): number =>
  events.reduce((n, e) => n + e.passes, 0);

/** "2026-08-14" → "2026-08". The draw a pass first becomes eligible for. */
export function drawMonthOf(earnedOn: string): DrawMonth {
  return earnedOn.slice(0, 7);
}

/**
 * The last draw month a pass still counts for.
 *
 * Expiry is *derived*, never stored — it is a function of when the pass was
 * earned and what type it is. That means there is no scheduled job to run, and
 * no window in which a missed job leaves last month's passes still counting.
 */
export function lastDrawMonthFor(
  event: PassEvent,
  passType: PassType,
  rules: CampaignRules,
): DrawMonth {
  return rules.passExpiry[passType] === "month_end"
    ? event.drawMonth
    : rules.endsOn.slice(0, 7);
}

/**
 * The draw currently being collected for: this calendar month, held inside the
 * campaign's own window so a statement read before it opens or after it closes
 * still shows a month the campaign actually ran.
 */
export function currentDrawMonth(
  campaign: { startsOn: string; endsOn: string },
  now: Date = new Date(),
): DrawMonth {
  const month = now.toISOString().slice(0, 7);
  const first = campaign.startsOn.slice(0, 7);
  const last = campaign.endsOn.slice(0, 7);
  if (month < first) return first;
  if (month > last) return last;
  return month;
}

/** Index of activity id → pass type, so events can be grouped without a join. */
const typeOf = (activities: Activity[]): Map<string, PassType> =>
  new Map(activities.map((a) => [a.id, a.passType]));

export interface ActivityRow {
  activity: Activity;
  /** Passes counting toward the draw in question — the number the client sees. */
  passes: number;
  /** How many times the client did the thing. */
  units: number;
  /** Earned but not yet countable, shown only when non-zero. */
  pending: number;
  /** Clawed back, shown only when non-zero. */
  voided: number;
  /** Counted in an earlier draw and now past their expiry. */
  expired: number;
  /** Deliberately deferred to a later draw and not counting yet. */
  upcoming: number;
}

export interface PassBlock {
  passType: PassType;
  total: number;
  pending: number;
  voided: number;
  expired: number;
  upcoming: number;
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
  rules: CampaignRules,
  drawMonth: DrawMonth,
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
      const rows = (byType.get(passType) ?? []).map((activity): ActivityRow => {
        const mine = events.filter((e) => e.activityId === activity.id);
        const countable = mine.filter(countsTowardDraw);
        const live = countable.filter(
          (e) =>
            e.drawMonth <= drawMonth &&
            drawMonth <= lastDrawMonthFor(e, passType, rules),
        );

        return {
          activity,
          passes: sumPasses(live),
          units: live.reduce((n, e) => n + e.units, 0),
          pending: sumPasses(mine.filter((e) => e.status === "pending")),
          voided: sumPasses(mine.filter((e) => e.status === "void")),
          expired: sumPasses(
            countable.filter((e) => lastDrawMonthFor(e, passType, rules) < drawMonth),
          ),
          upcoming: sumPasses(countable.filter((e) => e.drawMonth > drawMonth)),
        };
      });

      const sum = (pick: (r: ActivityRow) => number) =>
        rows.reduce((n, r) => n + pick(r), 0);

      return {
        passType,
        total: sum((r) => r.passes),
        pending: sum((r) => r.pending),
        voided: sum((r) => r.voided),
        expired: sum((r) => r.expired),
        upcoming: sum((r) => r.upcoming),
        rows,
      };
    });
}

/**
 * Passes of one type in the barrel for a given draw — what the consultant's
 * table shows, and what a draw would actually be run against.
 */
export function passesForDraw(
  events: PassEvent[],
  passType: PassType,
  activities: Activity[],
  rules: CampaignRules,
  drawMonth: DrawMonth,
): number {
  const types = typeOf(activities);
  return sumPasses(
    events.filter((e) => {
      if (types.get(e.activityId) !== passType) return false;
      if (!countsTowardDraw(e)) return false;
      return (
        e.drawMonth <= drawMonth && drawMonth <= lastDrawMonthFor(e, passType, rules)
      );
    }),
  );
}

/** Passes of one type that have run out, as of a given draw month. */
export function expiredPasses(
  events: PassEvent[],
  passType: PassType,
  activities: Activity[],
  rules: CampaignRules,
  drawMonth: DrawMonth,
): number {
  const types = typeOf(activities);
  return sumPasses(
    events.filter(
      (e) =>
        types.get(e.activityId) === passType &&
        countsTowardDraw(e) &&
        lastDrawMonthFor(e, passType, rules) < drawMonth,
    ),
  );
}

export const STATUS_LABEL: Record<PassStatus, string> = {
  valid: "Valid",
  pending: "Pending",
  void: "Voided",
};
