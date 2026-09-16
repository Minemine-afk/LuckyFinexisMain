import { isOncePerClient } from "../lib/campaignRules";
import { drawMonthOf } from "../lib/passes";
import type {
  Activity,
  Advisor,
  Campaign,
  ClientRecord,
  Draw,
  DrawWinner,
  PassEvent,
  Viewer,
} from "../lib/types";

/**
 * The demo dataset. Everything here is invented — the numbers are chosen to
 * reproduce the campaign mockups (Jake Peralta entering 50 blue passes into last
 * month's draw and winning an OSIM uJolly with them) so the UI can be reviewed
 * before a Supabase project exists.
 *
 * Between them the five clients cover every state the pass rules can produce:
 * live, awaiting a result, won, unsuccessful, pending confirmation, voided, and
 * a once-per-client activity claimed twice.
 *
 * Set VITE_USE_MOCK=false and the app talks to Supabase instead; nothing outside
 * `src/data/` knows the difference.
 */

const CAMPAIGN_ID = "cmp-atw-2026";

/**
 * Demo dates are relative to the current month rather than fixed.
 *
 * Blue passes are spent by the monthly draw they enter, so a fixed date would
 * mean the demo showed every blue pass used up a month after it was written —
 * the statement would read zero and look broken rather than demonstrating the
 * rule. Anchoring to today keeps the figures matching the campaign mockups
 * whenever the demo is opened.
 */
const NOW = new Date();

/** `monthsFromNow(-1)` → last month as "YYYY-MM". */
const monthsFromNow = (delta: number): string => {
  const d = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + delta, 1));
  return d.toISOString().slice(0, 7);
};

/** A date inside the month `delta` months from now, e.g. dayIn(-1, 19). */
const dayIn = (delta: number, day: number): string =>
  `${monthsFromNow(delta)}-${String(day).padStart(2, "0")}`;

const THIS_MONTH = monthsFromNow(0);
const LAST_MONTH = monthsFromNow(-1);
const FIRST_MONTH = monthsFromNow(-2);
/** The month the campaign closes, and so the month the single gold draw runs. */
const FINAL_MONTH = monthsFromNow(4);

/** Last day of the month `delta` months out, for the campaign close date. */
const endOfMonth = (delta: number): string => {
  const d = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + delta + 1, 0));
  return d.toISOString().slice(0, 10);
};

export const campaign: Campaign = {
  id: CAMPAIGN_ID,
  name: "Around The World Client Campaign",
  slug: "around-the-world-2026",
  startsOn: `${FIRST_MONTH}-01`,
  endsOn: endOfMonth(4),
  // In a real deployment this is a signed URL to the artwork an admin uploaded
  // to Supabase Storage. The demo ships an inline placeholder instead.
  detailsImageUrl: null,
  dataAsOf: dayIn(0, Math.min(NOW.getUTCDate(), 28)),
  // Blue is drawn every month, so blue passes are used up every month. Gold is
  // drawn once at campaign close, so gold accumulates until then. If gold turns
  // out to be drawn monthly too, this line is the only thing that changes.
  drawSchedule: { gold: "campaign_end", blue: "monthly" },
};

/** The rate card, as `challenge_types` holds it — without the once-only flag. */
const rateCard: Omit<Activity, "oncePerClient">[] = [
  {
    id: "act-gold-purchase",
    campaignId: CAMPAIGN_ID,
    code: "purchase_product",
    label: "Purchase Qualifying Product",
    passType: "gold",
    passesPerUnit: 21,
    unitLabel: "Case",
    sortOrder: 10,
  },
  {
    id: "act-gold-referral-purchase",
    campaignId: CAMPAIGN_ID,
    code: "referral_purchase",
    label: "Successful Referral Purchase",
    passType: "gold",
    passesPerUnit: 21,
    unitLabel: "Referral",
    sortOrder: 20,
  },
  {
    id: "act-blue-referral",
    campaignId: CAMPAIGN_ID,
    code: "submit_referral",
    label: "Submit Referrals",
    passType: "blue",
    passesPerUnit: 2,
    unitLabel: "Referral",
    sortOrder: 30,
  },
  {
    id: "act-blue-event",
    campaignId: CAMPAIGN_ID,
    code: "attend_event",
    label: "Attend Client Events",
    passType: "blue",
    passesPerUnit: 5,
    unitLabel: "Event",
    sortOrder: 40,
  },
  {
    id: "act-blue-guest",
    campaignId: CAMPAIGN_ID,
    code: "bring_guest",
    label: "Bring Guests For Events",
    passType: "blue",
    passesPerUnit: 10,
    unitLabel: "Guest",
    sortOrder: 50,
  },
  {
    id: "act-blue-testimonial",
    campaignId: CAMPAIGN_ID,
    code: "testimonial",
    label: "Submit A Testimonial",
    passType: "blue",
    passesPerUnit: 3,
    unitLabel: "Submission",
    sortOrder: 60,
  },
  {
    id: "act-blue-finconnect",
    campaignId: CAMPAIGN_ID,
    code: "finconnect",
    label: "Download finConnect",
    passType: "blue",
    passesPerUnit: 1,
    unitLabel: "Download",
    sortOrder: 70,
  },
];

/** The flag comes from campaign terms, exactly as it does in `toActivity`. */
export const activities: Activity[] = rateCard.map((a) => ({
  ...a,
  oncePerClient: isOncePerClient(a.code),
}));

export const advisors: Advisor[] = [
  { id: "adv-1", fcCode: "FC001", fullName: "Amy Santiago", email: "advisor@finexis.demo" },
  // Deliberately has no clients holding passes, so the blank-table state the
  // mockup calls for can be seen by signing in as this consultant.
  { id: "adv-2", fcCode: "FC002", fullName: "Norm Scully", email: "advisor2@finexis.demo" },
];

export const clients: ClientRecord[] = [
  { id: "cli-1", externalRef: "C-1001", fullName: "Jake Peralta", email: "jake@b99.co", mobile: "99999999", advisorId: "adv-1" },
  { id: "cli-2", externalRef: "C-1002", fullName: "Rosa Diaz", email: "rosa@b99.co", mobile: "98120034", advisorId: "adv-1" },
  { id: "cli-3", externalRef: "C-1003", fullName: "Terry Jeffords", email: "terry@b99.co", mobile: "91884420", advisorId: "adv-1" },
  { id: "cli-4", externalRef: "C-1004", fullName: "Gina Linetti", email: "gina@b99.co", mobile: "92330117", advisorId: "adv-1" },
  { id: "cli-5", externalRef: "C-1005", fullName: "Charles Boyle", email: "charles@b99.co", mobile: "90042288", advisorId: "adv-1" },
  // Norm's client, with nothing earned — he stays out of the advisor table.
  { id: "cli-6", externalRef: "C-1006", fullName: "Michael Hitchcock", email: "hitchcock@b99.co", mobile: "81002233", advisorId: "adv-2" },
];

let seq = 0;
const ev = (
  clientId: string,
  activityId: string,
  units: number,
  earnedOn: string,
  reference: string,
  status: PassEvent["status"] = "valid",
  voidReason: string | null = null,
): PassEvent => {
  const activity = activities.find((a) => a.id === activityId)!;
  seq += 1;
  return {
    id: `pe-${String(seq).padStart(4, "0")}`,
    campaignId: CAMPAIGN_ID,
    clientId,
    activityId,
    units,
    passes: units * activity.passesPerUnit,
    earnedOn,
    drawMonth: drawMonthOf(earnedOn),
    status,
    voidReason,
    consumedByDrawId: null,
    reference,
  };
};

export const passEvents: PassEvent[] = [
  // Jake Peralta — the worked example the mockups are built around, and the one
  // client who shows all three blue states at once: 50 passes won the first
  // month's draw, last month's 4 are waiting on a result, and this month's 7 are
  // live. His 21 gold sit in the campaign-close ballot throughout.
  ev("cli-1", "act-gold-purchase", 1, dayIn(-2, 4), "POL-88213"),
  ev("cli-1", "act-blue-referral", 5, dayIn(-2, 3), "Referral batch"),
  ev("cli-1", "act-blue-event", 2, dayIn(-2, 11), "Market outlook briefing"),
  ev("cli-1", "act-blue-guest", 3, dayIn(-2, 11), "Market outlook briefing"),
  ev("cli-1", "act-blue-referral", 2, dayIn(-1, 14), "Referral: C. Santiago"),
  ev("cli-1", "act-blue-referral", 1, dayIn(0, 6), "Referral: G. Linetti"),
  ev("cli-1", "act-blue-event", 1, dayIn(0, 9), "Retirement planning clinic"),

  // Rosa Diaz — passes used up by a draw she did not win, which is the ordinary
  // case and the one the statement has to explain gracefully.
  ev("cli-2", "act-gold-purchase", 2, dayIn(-2, 8), "POL-88240 / POL-88241"),
  ev("cli-2", "act-blue-referral", 2, dayIn(-2, 6), "Referral: A. Diaz"),
  ev("cli-2", "act-blue-referral", 1, dayIn(0, 6), "Referral: M. Diaz"),
  ev("cli-2", "act-blue-event", 2, dayIn(0, 14), "Retirement planning clinic"),

  // Terry Jeffords — won the first draw on a small entry, showing that passes are
  // odds rather than entitlement. He also appears twice for both once-per-client
  // activities: the export lists the app download and the testimonial again, and
  // only the first of each counts.
  ev("cli-3", "act-blue-referral", 2, dayIn(-2, 15), "Referral: S. Jeffords"),
  ev("cli-3", "act-blue-event", 1, dayIn(-2, 19), "Mid-year market outlook"),
  ev("cli-3", "act-blue-guest", 1, dayIn(-2, 19), "Guest: Sharon"),
  ev("cli-3", "act-blue-testimonial", 1, dayIn(0, 1), "Testimonial"),
  ev("cli-3", "act-blue-testimonial", 1, dayIn(0, 22), "Testimonial (re-exported)"),
  ev("cli-3", "act-blue-finconnect", 1, dayIn(0, 3), "finConnect install"),
  ev("cli-3", "act-blue-finconnect", 1, dayIn(0, 18), "finConnect reinstall"),

  // Gina Linetti — a gold case still inside its free-look window, so pending,
  // and a referral purchase clawed back when the policy was cancelled.
  ev("cli-4", "act-gold-purchase", 1, dayIn(0, 12), "POL-88301", "pending"),
  ev("cli-4", "act-gold-referral-purchase", 1, dayIn(-2, 30), "POL-88266", "void", "Policy cancelled in free-look"),
  ev("cli-4", "act-blue-referral", 3, dayIn(0, 8), "Referral batch"),
  ev("cli-4", "act-blue-finconnect", 1, dayIn(-1, 29), "finConnect install"),

  // Charles Boyle — one event, the smallest possible qualifying client.
  ev("cli-5", "act-blue-event", 1, dayIn(0, 5), "Retirement planning clinic"),
];

/**
 * Gold and blue are drawn on different schedules, so they are separate rows.
 *
 * Only the first month's blue draw has been run. Last month's is closed but not
 * yet recorded — the real-world gap, where a client's passes are spent but the
 * result is not out — this month's is still collecting, and the gold draw waits
 * for campaign close.
 */
export const draws: Draw[] = [
  { id: "draw-blue-1", campaignId: CAMPAIGN_ID, drawMonth: FIRST_MONTH, passType: "blue", isDrawn: true, drawnAt: `${LAST_MONTH}-02` },
  { id: "draw-blue-2", campaignId: CAMPAIGN_ID, drawMonth: LAST_MONTH, passType: "blue", isDrawn: false, drawnAt: null },
  { id: "draw-blue-3", campaignId: CAMPAIGN_ID, drawMonth: THIS_MONTH, passType: "blue", isDrawn: false, drawnAt: null },
  { id: "draw-gold-final", campaignId: CAMPAIGN_ID, drawMonth: FINAL_MONTH, passType: "gold", isDrawn: false, drawnAt: null },
];

export const drawWinners: DrawWinner[] = [
  { id: "win-1", drawId: "draw-blue-1", drawMonth: FIRST_MONTH, clientId: "cli-1", displayName: "Jake P.", prize: "OSIM uJolly", passType: "blue" },
  { id: "win-2", drawId: "draw-blue-1", drawMonth: FIRST_MONTH, clientId: "cli-3", displayName: "Terry J.", prize: "Dyson Airwrap", passType: "blue" },
];

export const demoViewers: Viewer[] = [
  { userId: "usr-advisor", email: "advisor@finexis.demo", fullName: "Amy Santiago", advisorId: "adv-1", isAdmin: false },
  { userId: "usr-advisor-2", email: "advisor2@finexis.demo", fullName: "Norm Scully", advisorId: "adv-2", isAdmin: false },
  { userId: "usr-admin", email: "admin@finexis.demo", fullName: "Holt R.", advisorId: null, isAdmin: true },
  // Both at once, which is the common case in a small firm: the person who
  // loads the data also carries a book. Before capabilities replaced a single
  // role, this account could only be one of the two.
  { userId: "usr-both", email: "both@finexis.demo", fullName: "Madeline Wuntch", advisorId: "adv-1", isAdmin: true },
];
