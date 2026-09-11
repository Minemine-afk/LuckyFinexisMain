import type {
  Activity,
  Draw,
  DrawMonth,
  DrawSchedule,
  DrawWinner,
  PassEvent,
  PassStatus,
  PassType,
} from "./types";

/*
 * The campaign rule, in one sentence: a pass is spent by the draw it enters,
 * won or not.
 *
 * Which draw a pass enters depends on the schedule for its type, per
 * `DrawSchedule` in types.ts:
 *   `monthly`      — the draw for the month the pass was earned.
 *   `campaign_end` — one draw at campaign close; passes accumulate until then.
 *
 * Spending is *derived*, never written: a pass is spent once its draw is marked
 * drawn. There is no job to run, no ledger rewrite when a draw happens, and no
 * window in which a missed job leaves last month's passes still counting. The
 * one stored form — `consumedByDrawId` on the event — is still honoured, so an
 * administrator can retire an individual pass by hand.
 */

/** The campaign settings the pass arithmetic depends on. */
export interface CampaignRules {
  drawSchedule: Record<PassType, DrawSchedule>;
  /** ISO date the campaign closes; the month the campaign-end draw runs in. */
  endsOn: string;
}

/** Identifies a draw by what it draws, not by row id: "blue|2026-09". */
export const drawKey = (passType: PassType, drawMonth: DrawMonth): string =>
  `${passType}|${drawMonth}`;

const sumPasses = (events: PassEvent[]): number =>
  events.reduce((n, e) => n + e.passes, 0);

/** "2026-08-14" → "2026-08". The month a pass was earned in. */
export function drawMonthOf(earnedOn: string): DrawMonth {
  return earnedOn.slice(0, 7);
}

/** The draw this pass goes into — the only one it will ever go into. */
export function drawEnteredBy(
  event: PassEvent,
  passType: PassType,
  rules: CampaignRules,
): DrawMonth {
  return rules.drawSchedule[passType] === "monthly"
    ? event.drawMonth
    : rules.endsOn.slice(0, 7);
}

/**
 * The draws that have actually been run, as keys. Anything whose draw is in
 * this set has been spent by it.
 */
export function drawnKeys(draws: Draw[]): Set<string> {
  return new Set(
    draws.filter((d) => d.isDrawn).map((d) => drawKey(d.passType, d.drawMonth)),
  );
}

/** Spent: its draw has run, or an administrator retired it individually. */
export function isSpent(
  event: PassEvent,
  passType: PassType,
  rules: CampaignRules,
  drawn: Set<string>,
): boolean {
  if (event.consumedByDrawId !== null) return true;
  return drawn.has(drawKey(passType, drawEnteredBy(event, passType, rules)));
}

/** Live: confirmed, and still waiting on its draw. This is the headline number. */
export function isLive(
  event: PassEvent,
  passType: PassType,
  rules: CampaignRules,
  drawn: Set<string>,
): boolean {
  return event.status === "valid" && !isSpent(event, passType, rules, drawn);
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
  /** Live passes — the number the client sees. */
  passes: number;
  /** How many times the client did the thing, counting only live passes. */
  units: number;
  /** Earned but not yet confirmed, shown only when non-zero. */
  pending: number;
  /** Clawed back, shown only when non-zero. */
  voided: number;
  /** Already entered a draw that has run, and so used up. */
  spent: number;
}

export interface PassBlock {
  passType: PassType;
  total: number;
  pending: number;
  voided: number;
  spent: number;
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
  drawn: Set<string>,
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
        const live = mine.filter((e) => isLive(e, passType, rules, drawn));

        return {
          activity,
          passes: sumPasses(live),
          units: live.reduce((n, e) => n + e.units, 0),
          pending: sumPasses(mine.filter((e) => e.status === "pending")),
          voided: sumPasses(mine.filter((e) => e.status === "void")),
          spent: sumPasses(
            mine.filter(
              (e) => e.status === "valid" && isSpent(e, passType, rules, drawn),
            ),
          ),
        };
      });

      const sum = (pick: (r: ActivityRow) => number) =>
        rows.reduce((n, r) => n + pick(r), 0);

      return {
        passType,
        total: sum((r) => r.passes),
        pending: sum((r) => r.pending),
        voided: sum((r) => r.voided),
        spent: sum((r) => r.spent),
        rows,
      };
    });
}

/**
 * Live passes of one type — what the consultant's table shows, and what the
 * next draw of that type would actually be run against.
 */
export function livePasses(
  events: PassEvent[],
  passType: PassType,
  activities: Activity[],
  rules: CampaignRules,
  drawn: Set<string>,
): number {
  const types = typeOf(activities);
  return sumPasses(
    events.filter(
      (e) =>
        types.get(e.activityId) === passType && isLive(e, passType, rules, drawn),
    ),
  );
}

/** Passes of one type already used up by a draw that has run. */
export function spentPasses(
  events: PassEvent[],
  passType: PassType,
  activities: Activity[],
  rules: CampaignRules,
  drawn: Set<string>,
): number {
  const types = typeOf(activities);
  return sumPasses(
    events.filter(
      (e) =>
        types.get(e.activityId) === passType &&
        e.status === "valid" &&
        isSpent(e, passType, rules, drawn),
    ),
  );
}

/** One row of the Previous Passes history: a draw this client had passes in. */
export interface DrawEntry {
  passType: PassType;
  drawMonth: DrawMonth;
  /** Passes this client entered into that draw. */
  passes: number;
  /** Where they came from — "5 referrals", "2 events" — for the detail line. */
  parts: string[];
  /** `won` and `spent` are past draws; `open` is one still to run. */
  state: "won" | "spent" | "open";
  /** The prize, when this draw was won. */
  prize: string | null;
}

/**
 * The Previous Passes view: every draw this client's passes went into, newest
 * first, with what came of it.
 *
 * Draws still to run are included as `open` — a client looking at "0 live blue
 * passes" needs the December gold draw in the same list to see that 21 gold are
 * still in play, not gone.
 */
export function buildDrawHistory(
  activities: Activity[],
  events: PassEvent[],
  rules: CampaignRules,
  drawn: Set<string>,
  winners: DrawWinner[],
): DrawEntry[] {
  const types = typeOf(activities);
  const byId = new Map(activities.map((a) => [a.id, a]));

  // Group confirmed passes by the draw they entered.
  const groups = new Map<string, PassEvent[]>();
  for (const e of events) {
    if (e.status !== "valid") continue;
    const passType = types.get(e.activityId);
    if (!passType) continue;
    const key = drawKey(passType, drawEnteredBy(e, passType, rules));
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const wonAt = new Map(
    winners.map((w) => [drawKey(w.passType, w.drawMonth), w.prize]),
  );

  return [...groups.entries()]
    .map(([key, group]): DrawEntry => {
      const [passType, drawMonth] = key.split("|") as [PassType, DrawMonth];
      const spent =
        drawn.has(key) || group.every((e) => e.consumedByDrawId !== null);
      const prize = wonAt.get(key) ?? null;

      // Collapse to "5 referrals, 2 events" rather than listing every row: the
      // per-activity detail already lives in the tables above.
      const units = new Map<string, number>();
      for (const e of group) {
        const a = byId.get(e.activityId);
        if (!a) continue;
        units.set(a.id, (units.get(a.id) ?? 0) + e.units);
      }
      const parts = [...units.entries()].map(([id, n]) => {
        const a = byId.get(id)!;
        const noun = a.unitLabel ? a.unitLabel.toLowerCase() : a.label.toLowerCase();
        return `${n} ${noun}${n === 1 || !a.unitLabel ? "" : "s"}`;
      });

      return {
        passType,
        drawMonth,
        passes: sumPasses(group),
        parts,
        state: prize !== null ? "won" : spent ? "spent" : "open",
        prize,
      };
    })
    .sort(
      (a, b) => b.drawMonth.localeCompare(a.drawMonth) || a.passType.localeCompare(b.passType),
    );
}

export const STATUS_LABEL: Record<PassStatus, string> = {
  valid: "Valid",
  pending: "Pending",
  void: "Voided",
};
