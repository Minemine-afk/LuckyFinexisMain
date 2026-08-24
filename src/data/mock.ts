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
 * winning the August draw with an OSIM uJolly on a blue pass) so the UI can be
 * reviewed before a Supabase project exists.
 *
 * Set VITE_USE_MOCK=false and the app talks to Supabase instead; nothing outside
 * `src/data/` knows the difference.
 */

const CAMPAIGN_ID = "cmp-atw-2026";

export const campaign: Campaign = {
  id: CAMPAIGN_ID,
  name: "Around The World Client Campaign",
  slug: "around-the-world-2026",
  startsOn: "2026-07-01",
  endsOn: "2026-12-31",
  // In a real deployment this is a signed URL to the artwork an admin uploaded
  // to Supabase Storage. The demo ships an inline placeholder instead.
  detailsImageUrl: null,
  dataAsOf: "2026-08-15",
  // The mockup shows Jake keeping all 50 blue passes after winning in August,
  // so a win does not spend passes. Flip this once the campaign terms are
  // confirmed — `consumedByDrawId` on the ledger already supports it.
  consumePassesOnWin: false,
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
  // Jake Peralta — 21 gold, 50 blue, exactly as the client statement mockup shows.
  ev("cli-1", "act-gold-purchase", 1, "2026-07-04", "POL-88213"),
  ev("cli-1", "act-blue-referral", 5, "2026-07-11", "Referral batch Jul"),
  ev("cli-1", "act-blue-event", 2, "2026-07-19", "Mid-year market outlook"),
  ev("cli-1", "act-blue-guest", 3, "2026-07-19", "Mid-year market outlook"),

  // Rosa Diaz — two qualifying cases, a handful of blue.
  ev("cli-2", "act-gold-purchase", 2, "2026-07-08", "POL-88240 / POL-88241"),
  ev("cli-2", "act-blue-referral", 1, "2026-07-22", "Referral: A. Diaz"),
  ev("cli-2", "act-blue-event", 2, "2026-08-02", "Retirement planning clinic"),

  // Terry Jeffords — blue only, plus a testimonial and the app download.
  ev("cli-3", "act-blue-referral", 2, "2026-07-15", "Referral: S. Jeffords"),
  ev("cli-3", "act-blue-event", 1, "2026-07-19", "Mid-year market outlook"),
  ev("cli-3", "act-blue-guest", 1, "2026-07-19", "Guest: Sharon"),
  ev("cli-3", "act-blue-testimonial", 1, "2026-08-01", "Testimonial 2026-08"),
  ev("cli-3", "act-blue-finconnect", 1, "2026-08-03", "finConnect install"),

  // Gina Linetti — a gold case still inside its free-look window, so pending,
  // and a referral purchase that was clawed back when the policy was cancelled.
  ev("cli-4", "act-gold-purchase", 1, "2026-08-12", "POL-88301", "pending"),
  ev("cli-4", "act-gold-referral-purchase", 1, "2026-07-30", "POL-88266", "void", "Policy cancelled in free-look"),
  ev("cli-4", "act-blue-referral", 3, "2026-07-28", "Referral batch Jul"),
  ev("cli-4", "act-blue-finconnect", 1, "2026-07-29", "finConnect install"),

  // Charles Boyle — one event, the smallest possible qualifying client.
  ev("cli-5", "act-blue-event", 1, "2026-08-05", "Retirement planning clinic"),
];

export const draws: Draw[] = [
  { id: "draw-2026-07", campaignId: CAMPAIGN_ID, drawMonth: "2026-07", status: "published", drawnAt: "2026-08-01" },
  { id: "draw-2026-08", campaignId: CAMPAIGN_ID, drawMonth: "2026-08", status: "published", drawnAt: "2026-09-01" },
];

export const drawWinners: DrawWinner[] = [
  { id: "win-1", drawId: "draw-2026-07", drawMonth: "2026-07", clientId: "cli-3", displayName: "Terry J.", prize: "Dyson Airwrap", passType: "blue" },
  { id: "win-2", drawId: "draw-2026-07", drawMonth: "2026-07", clientId: "cli-2", displayName: "Rosa D.", prize: "Business class upgrade voucher", passType: "gold" },
  { id: "win-3", drawId: "draw-2026-08", drawMonth: "2026-08", clientId: "cli-1", displayName: "Jake P.", prize: "OSIM uJolly", passType: "blue" },
  { id: "win-4", drawId: "draw-2026-08", drawMonth: "2026-08", clientId: "cli-4", displayName: "Gina L.", prize: "Apple Watch Series 10", passType: "blue" },
];

/**
 * Demo sign-ins. Real deployments authenticate against Supabase Auth; these
 * exist so the portal can be clicked through with no backend, and are listed on
 * the login screen for that reason.
 */
export const demoViewers: Viewer[] = [
  { userId: "usr-client", email: "jake@b99.co", role: "client", fullName: "Jake Peralta", clientId: "cli-1", advisorId: null },
  { userId: "usr-advisor", email: "advisor@finexis.demo", role: "advisor", fullName: "Amy Santiago", clientId: null, advisorId: "adv-1" },
  { userId: "usr-advisor-2", email: "advisor2@finexis.demo", role: "advisor", fullName: "Norm Scully", clientId: null, advisorId: "adv-2" },
  { userId: "usr-admin", email: "admin@finexis.demo", role: "admin", fullName: "Holt R.", clientId: null, advisorId: null },
];
