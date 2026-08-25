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
 * reproduce the campaign mockups exactly (Jake Peralta at 21 gold / 50 blue,
 * winning this month's draw with an OSIM uJolly on a blue pass) so the UI can
 * be reviewed before a Supabase project exists.
 *
 * Set VITE_USE_MOCK=false and the app talks to Supabase instead; nothing outside
 * `src/data/` knows the difference.
 */

const CAMPAIGN_ID = "cmp-atw-2026";

/**
 * Demo dates are relative to the current month rather than fixed.
 *
 * Blue passes expire at the end of the month they are earned, so a fixed date
 * would mean the demo showed every blue pass expired a month after it was
 * written — the statement would read zero and look broken rather than
 * demonstrating the rule. Anchoring to today keeps the figures matching the
 * campaign mockups whenever the demo is opened.
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

/** Last day of the month `delta` months out, for the campaign close date. */
const endOfMonth = (delta: number): string => {
  const d = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + delta + 1, 0));
  return d.toISOString().slice(0, 10);
};

export const campaign: Campaign = {
  id: CAMPAIGN_ID,
  name: "Around The World Client Campaign",
  slug: "around-the-world-2026",
  startsOn: `${monthsFromNow(-1)}-01`,
  endsOn: endOfMonth(4),
  // In a real deployment this is a signed URL to the artwork an admin uploaded
  // to Supabase Storage. The demo ships an inline placeholder instead.
  detailsImageUrl: null,
  dataAsOf: dayIn(0, Math.min(NOW.getUTCDate(), 28)),
  // The mockup shows Jake keeping all 50 blue passes after winning in August,
  // so a win does not spend passes. Flip this once the campaign terms are
  // confirmed — `consumedByDrawId` on the ledger already supports it.
  consumePassesOnWin: false,
  // Blue passes are spent in the month they are earned; gold accumulates for
  // the whole campaign.
  passExpiry: { gold: "campaign_end", blue: "month_end" },
};

export const activities: Activity[] = [
  {
    id: "act-gold-purchase",
    campaignId: CAMPAIGN_ID,
    code: "purchase_qualifying_product",
    label: "Purchase Qualifying Product",
    passType: "gold",
    passesPerUnit: 21,
    unitLabel: "Case",
    sortOrder: 10,
  },
  {
    id: "act-gold-referral-purchase",
    campaignId: CAMPAIGN_ID,
    code: "successful_referral_purchase",
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
    code: "attend_client_event",
    label: "Attend Client Events",
    passType: "blue",
    passesPerUnit: 5,
    unitLabel: "Event",
    sortOrder: 40,
  },
  {
    id: "act-blue-guest",
    campaignId: CAMPAIGN_ID,
    code: "bring_guest_to_event",
    label: "Bring Guests For Client Events",
    passType: "blue",
    passesPerUnit: 10,
    unitLabel: "Guest",
    sortOrder: 50,
  },
  {
    id: "act-blue-testimonial",
    campaignId: CAMPAIGN_ID,
    code: "submit_testimonial",
    label: "Submit A Testimonial",
    passType: "blue",
    passesPerUnit: 3,
    unitLabel: null,
    sortOrder: 60,
  },
  {
    id: "act-blue-finconnect",
    campaignId: CAMPAIGN_ID,
    code: "download_finconnect",
    label: "Download finConnect",
    passType: "blue",
    passesPerUnit: 1,
    unitLabel: null,
    sortOrder: 70,
  },
];

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
  // Jake Peralta — 21 gold, 50 blue, exactly as the client statement mockup
  // shows. His gold was earned last month and carries forward; his blue is all
  // from this month, because blue would otherwise have expired.
  ev("cli-1", "act-gold-purchase", 1, dayIn(-1, 4), "POL-88213"),
  ev("cli-1", "act-blue-referral", 5, dayIn(0, 3), "Referral batch"),
  ev("cli-1", "act-blue-event", 2, dayIn(0, 11), "Market outlook briefing"),
  ev("cli-1", "act-blue-guest", 3, dayIn(0, 11), "Market outlook briefing"),

  // Rosa Diaz — two qualifying cases carried forward, a handful of live blue.
  ev("cli-2", "act-gold-purchase", 2, dayIn(-1, 8), "POL-88240 / POL-88241"),
  ev("cli-2", "act-blue-referral", 1, dayIn(0, 6), "Referral: A. Diaz"),
  ev("cli-2", "act-blue-event", 2, dayIn(0, 14), "Retirement planning clinic"),

  // Terry Jeffords — the worked example of expiry. Last month's blue is spent
  // and no longer counts; only this month's testimonial and app download do.
  ev("cli-3", "act-blue-referral", 2, dayIn(-1, 15), "Referral: S. Jeffords"),
  ev("cli-3", "act-blue-event", 1, dayIn(-1, 19), "Mid-year market outlook"),
  ev("cli-3", "act-blue-guest", 1, dayIn(-1, 19), "Guest: Sharon"),
  ev("cli-3", "act-blue-testimonial", 1, dayIn(0, 1), "Testimonial"),
  ev("cli-3", "act-blue-finconnect", 1, dayIn(0, 3), "finConnect install"),

  // Gina Linetti — a gold case still inside its free-look window, so pending,
  // and a referral purchase clawed back when the policy was cancelled.
  ev("cli-4", "act-gold-purchase", 1, dayIn(0, 12), "POL-88301", "pending"),
  ev("cli-4", "act-gold-referral-purchase", 1, dayIn(-1, 30), "POL-88266", "void", "Policy cancelled in free-look"),
  ev("cli-4", "act-blue-referral", 3, dayIn(0, 8), "Referral batch"),
  ev("cli-4", "act-blue-finconnect", 1, dayIn(-1, 29), "finConnect install"),

  // Charles Boyle — one event, the smallest possible qualifying client.
  ev("cli-5", "act-blue-event", 1, dayIn(0, 5), "Retirement planning clinic"),
];

export const draws: Draw[] = [
  { id: "draw-prev", campaignId: CAMPAIGN_ID, drawMonth: LAST_MONTH, status: "published", drawnAt: `${THIS_MONTH}-01` },
  { id: "draw-current", campaignId: CAMPAIGN_ID, drawMonth: THIS_MONTH, status: "published", drawnAt: `${THIS_MONTH}-15` },
];

export const drawWinners: DrawWinner[] = [
  { id: "win-1", drawId: "draw-prev", drawMonth: LAST_MONTH, clientId: "cli-3", displayName: "Terry J.", prize: "Dyson Airwrap", passType: "blue" },
  { id: "win-2", drawId: "draw-prev", drawMonth: LAST_MONTH, clientId: "cli-2", displayName: "Rosa D.", prize: "Business class upgrade voucher", passType: "gold" },
  { id: "win-3", drawId: "draw-current", drawMonth: THIS_MONTH, clientId: "cli-1", displayName: "Jake P.", prize: "OSIM uJolly", passType: "blue" },
  { id: "win-4", drawId: "draw-current", drawMonth: THIS_MONTH, clientId: "cli-4", displayName: "Gina L.", prize: "Apple Watch Series 10", passType: "blue" },
];

export const demoViewers: Viewer[] = [
  { userId: "usr-advisor", email: "advisor@finexis.demo", role: "advisor", fullName: "Amy Santiago", advisorId: "adv-1" },
  { userId: "usr-advisor-2", email: "advisor2@finexis.demo", role: "advisor", fullName: "Norm Scully", advisorId: "adv-2" },
  { userId: "usr-admin", email: "admin@finexis.demo", role: "admin", fullName: "Holt R.", advisorId: null },
];
