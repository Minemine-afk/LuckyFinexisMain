import type {
  Activity,
  Campaign,
  Draw,
  DrawMonth,
  DrawSchedule,
  DrawWinner,
  PassEvent,
  PassStatus,
  PassType,
} from "./types";

/*
 * The campaign rule, in one sentence: a pass belongs to one ballot, and is used
 * up by it.
 *
 * Which ballot depends on the schedule for its type, per `DrawSchedule`:
 *   `monthly`      — the draw for the month the pass was earned. It is in that
 *                    ballot and no other; it is never carried forward.
 *   `campaign_end` — one draw at campaign close; passes accumulate until then.
 *
 * A valid pass is therefore in exactly one of four states, and everything on
 * screen derives from `passState` below:
 *
 *   live       its ballot is the one now collecting        counted in the total
 *   upcoming   deliberately deferred to a later ballot     not counted yet
 *   awaiting   its ballot closed, the draw is not recorded "Awaiting result"
 *   drawn      its ballot has been run                     won, or unsuccessful
 *
 * The distinction between `live` and `awaiting` is the one that earns its keep.
 * September's draw is run in October, so for a few days a client holds both
 * September's closed ballot and October's open one. Adding them into a single
 * "Blue Passes" number would show two ballots as one.
 *
 * None of this is stored. Nothing is written when a draw happens beyond
 * `draws.is_drawn`, so there is no scheduled job to miss — which matters,
 * because Pages Functions have no cron triggers.
 */

/** The campaign settings the pass arithmetic depends on. */
export interface CampaignRules {
  drawSchedule: Record<PassType, DrawSchedule>;
  /** ISO date the campaign closes; the month the campaign-end draw runs in. */
  endsOn: string;
}

/**
 * Everything needed to place a pass, gathered once per page rather than threaded
 * through as four more arguments at every call site.
 */
export interface PassView {
  rules: CampaignRules;
  /** `drawKey` of every draw already run. */
  drawn: Set<string>;
  /** The ballot now collecting. */
  currentMonth: DrawMonth;
  /**
   * For a pass type drawn once at campaign close, the month of the last draw of
   * that type that actually exists. Absent when the campaign has none scheduled.
   */
  finalBallot: Partial<Record<PassType, DrawMonth>>;
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

/**
 * The ballot this pass is in — the only one it will ever be in.
 *
 * For a `campaign_end` type the ballot is the last draw of that type that the
 * campaign actually has, rather than a month computed from the campaign's end
 * date. Those two are not the same thing: a draw is held after the period it
 * covers, so the campaign-close gold draw sits in January for a campaign ending
 * in December. Deriving the month arithmetically meant gold was only ever spent
 * if `campaigns.end_date` happened to land in the same month as a gold draw —
 * and when it did not, nothing failed, gold simply stayed live for ever.
 *
 * The campaign end month remains the fallback, for a campaign with no draw of
 * that type scheduled yet.
 */
export function ballotMonth(
  event: PassEvent,
  passType: PassType,
  view: PassView,
): DrawMonth {
  if (view.rules.drawSchedule[passType] === "monthly") return event.drawMonth;
  return view.finalBallot[passType] ?? view.rules.endsOn.slice(0, 7);
}

/**
 * The draws that have actually been run, as keys. A pass whose ballot is in this
 * set has been used up by it.
 */
export function drawnKeys(draws: Draw[]): Set<string> {
  return new Set(
    draws.filter((d) => d.isDrawn).map((d) => drawKey(d.passType, d.drawMonth)),
  );
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

/** Gather the campaign settings, the draws that have run, and today's ballot. */
export function passView(
  campaign: Campaign,
  draws: Draw[],
  now: Date = new Date(),
): PassView {
  // The last draw of each type, which is where a campaign-close pass ends up.
  const finalBallot: Partial<Record<PassType, DrawMonth>> = {};
  for (const d of draws) {
    const seen = finalBallot[d.passType];
    if (!seen || d.drawMonth > seen) finalBallot[d.passType] = d.drawMonth;
  }

  return {
    rules: { drawSchedule: campaign.drawSchedule, endsOn: campaign.endsOn },
    drawn: drawnKeys(draws),
    currentMonth: currentDrawMonth(campaign, now),
    finalBallot,
  };
}

/**
 * The ballot a pass type is collecting into — the month a consultant should be
 * told their clients' passes are heading for.
 */
export function ballotFor(passType: PassType, view: PassView): DrawMonth {
  return view.rules.drawSchedule[passType] === "monthly"
    ? view.currentMonth
    : view.finalBallot[passType] ?? view.rules.endsOn.slice(0, 7);
}

export type PassState = "live" | "upcoming" | "awaiting" | "drawn";

/**
 * Where a confirmed pass stands. The single place the four states are decided.
 *
 * `drawn` covers both winning and losing: for the arithmetic they are the same
 * thing — the pass is gone. Which of the two it was needs the client's prizes,
 * so that split happens in `buildDrawHistory`, where they are to hand.
 */
export function passState(
  event: PassEvent,
  passType: PassType,
  view: PassView,
): PassState {
  // An administrator retiring one pass by hand, which no draw explains.
  if (event.consumedByDrawId !== null) return "drawn";

  const ballot = ballotMonth(event, passType, view);
  if (view.drawn.has(drawKey(passType, ballot))) return "drawn";

  // A monthly pass is live only while its own month is the one collecting. A
  // campaign-end pass has one ballot for the whole campaign, so it stays live
  // until that draw runs — which is what lets gold accumulate.
  if (view.rules.drawSchedule[passType] === "monthly") {
    if (ballot < view.currentMonth) return "awaiting";
    if (ballot > view.currentMonth) return "upcoming";
  }
  return "live";
}

/** In the ballot now collecting. This is the headline number. */
export const isLive = (
  event: PassEvent,
  passType: PassType,
  view: PassView,
): boolean => event.status === "valid" && passState(event, passType, view) === "live";

/**
 * Apply the once-per-client cap.
 *
 * **Expects one client's events.** The cap is per client per activity, and this
 * function has no client id to group by — every caller already holds a single
 * client's ledger.
 *
 * Of the non-void events for a once-only activity, the earliest survives and is
 * capped to one unit; the rest are dropped silently. Void rows never hold the
 * slot — a cancelled testimonial should not block the real one — and are passed
 * through so they still report as withdrawn.
 */
export function eligibleEvents(
  activities: Activity[],
  events: PassEvent[],
): PassEvent[] {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const claimed = new Set<string>();

  // Earliest first, so it is the *first* download that counts.
  const ordered = [...events].sort(
    (a, b) => a.earnedOn.localeCompare(b.earnedOn) || a.id.localeCompare(b.id),
  );

  const kept: PassEvent[] = [];
  for (const event of ordered) {
    const activity = byId.get(event.activityId);
    if (!activity?.oncePerClient || event.status === "void") {
      kept.push(event);
      continue;
    }
    if (claimed.has(event.activityId)) continue;
    claimed.add(event.activityId);
    kept.push(capToOneUnit(event));
  }
  return kept;
}

/**
 * One unit's worth of a row that claims more.
 *
 * The rate comes from the row itself rather than today's rate card, for the same
 * reason `passes` is stored rather than derived: changing a campaign rule next
 * month must not rewrite last month's ledger. A testimonial row reading
 * `units: 2, passes: 6` caps to 3 passes, not to 1.
 */
const capToOneUnit = (event: PassEvent): PassEvent => {
  if (event.units <= 1) return event;
  return { ...event, units: 1, passes: Math.round(event.passes / event.units) };
};

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
  /** In a closed ballot whose draw has not been recorded yet. */
  awaiting: number;
  /** Deliberately deferred to a later ballot. */
  upcoming: number;
  /** In a ballot that has been run, won or not. */
  drawn: number;
}

export interface PassBlock {
  passType: PassType;
  total: number;
  pending: number;
  voided: number;
  awaiting: number;
  upcoming: number;
  drawn: number;
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
  view: PassView,
): PassBlock[] {
  const eligible = eligibleEvents(activities, events);

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
        const mine = eligible.filter((e) => e.activityId === activity.id);
        const confirmed = mine.filter((e) => e.status === "valid");
        const inState = (state: PassState) =>
          confirmed.filter((e) => passState(e, passType, view) === state);
        const live = inState("live");

        return {
          activity,
          passes: sumPasses(live),
          units: live.reduce((n, e) => n + e.units, 0),
          pending: sumPasses(mine.filter((e) => e.status === "pending")),
          voided: sumPasses(mine.filter((e) => e.status === "void")),
          awaiting: sumPasses(inState("awaiting")),
          upcoming: sumPasses(inState("upcoming")),
          drawn: sumPasses(inState("drawn")),
        };
      });

      const sum = (pick: (r: ActivityRow) => number) =>
        rows.reduce((n, r) => n + pick(r), 0);

      return {
        passType,
        total: sum((r) => r.passes),
        pending: sum((r) => r.pending),
        voided: sum((r) => r.voided),
        awaiting: sum((r) => r.awaiting),
        upcoming: sum((r) => r.upcoming),
        drawn: sum((r) => r.drawn),
        rows,
      };
    });
}

/** Passes of one type in the ballot now collecting — the consultant's column. */
export function livePasses(
  events: PassEvent[],
  passType: PassType,
  activities: Activity[],
  view: PassView,
): number {
  const types = typeOf(activities);
  return sumPasses(
    eligibleEvents(activities, events).filter(
      (e) => types.get(e.activityId) === passType && isLive(e, passType, view),
    ),
  );
}

/**
 * Passes of one type whose ballot is `month` — a draw's entrants.
 *
 * Selects on the ballot rather than on state, which is the difference that makes
 * it useful: `livePasses` and `awaitingPasses` both stop counting the moment a
 * draw is recorded, and the screen that records a draw needs the number *after*
 * it has been recorded too — to say how many passes an undo would give back, and
 * to keep showing who was in the draw once it is closed.
 *
 * Voided passes never entered anything, so they are left out. Pending ones are
 * counted: a pass earned but not yet confirmed is still in the ballot for the
 * month it was earned, and excluding it would understate the pool.
 */
export function ballotPasses(
  events: PassEvent[],
  passType: PassType,
  month: DrawMonth,
  activities: Activity[],
  view: PassView,
): number {
  const types = typeOf(activities);
  return sumPasses(
    eligibleEvents(activities, events).filter(
      (e) =>
        types.get(e.activityId) === passType &&
        e.status !== "void" &&
        ballotMonth(e, passType, view) === month,
    ),
  );
}

/** Passes of one type sitting in a closed ballot whose draw has not been run. */
export function awaitingPasses(
  events: PassEvent[],
  passType: PassType,
  activities: Activity[],
  view: PassView,
): number {
  const types = typeOf(activities);
  return sumPasses(
    eligibleEvents(activities, events).filter(
      (e) =>
        types.get(e.activityId) === passType &&
        e.status === "valid" &&
        passState(e, passType, view) === "awaiting",
    ),
  );
}

/** One row of the Previous Passes history: a ballot this client had passes in. */
export interface DrawEntry {
  passType: PassType;
  drawMonth: DrawMonth;
  /** Passes this client has in that ballot. */
  passes: number;
  /** Where they came from — "5 referrals", "2 events" — for the detail line. */
  parts: string[];
  state: "won" | "unsuccessful" | "awaiting" | "open";
  /** The prize, when this ballot was won. */
  prize: string | null;
}

/**
 * The Previous Passes view: every ballot this client's passes are or were in,
 * newest first, with what came of it.
 *
 * Ballots still to run are included as `open` — a client looking at "0 live blue
 * passes" needs the gold draw in the same list to see that 21 gold are still in
 * play, not gone — and closed ones with no result yet as `awaiting`, which is
 * the honest answer to "so what happened to September?".
 */
export function buildDrawHistory(
  activities: Activity[],
  events: PassEvent[],
  view: PassView,
  winners: DrawWinner[],
): DrawEntry[] {
  const types = typeOf(activities);
  const byId = new Map(activities.map((a) => [a.id, a]));

  // Group confirmed passes by the ballot they are in.
  const groups = new Map<string, PassEvent[]>();
  for (const e of eligibleEvents(activities, events)) {
    if (e.status !== "valid") continue;
    const passType = types.get(e.activityId);
    if (!passType) continue;
    const key = drawKey(passType, ballotMonth(e, passType, view));
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
      const prize = wonAt.get(key) ?? null;

      // Every pass in a group shares a ballot, so the first settles the state.
      const state = passState(group[0], passType, view);
      const outcome: DrawEntry["state"] =
        state === "drawn" ? (prize !== null ? "won" : "unsuccessful")
        : state === "awaiting" ? "awaiting"
        : "open";

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
        // An activity counted per something reads "5 referrals". One that is not
        // counted per anything reads as its own name — "1 submit a testimonial"
        // is not English.
        if (!a.unitLabel) return n > 1 ? `${a.label} ×${n}` : a.label;
        const noun = a.unitLabel.toLowerCase();
        return `${n} ${noun}${n === 1 ? "" : "s"}`;
      });

      return {
        passType,
        drawMonth,
        passes: sumPasses(group),
        parts,
        state: outcome,
        prize,
      };
    })
    .sort(
      (a, b) =>
        b.drawMonth.localeCompare(a.drawMonth) || a.passType.localeCompare(b.passType),
    );
}

export const STATUS_LABEL: Record<PassStatus, string> = {
  valid: "Valid",
  pending: "Pending",
  void: "Voided",
};
