/**
 * Domain types for the campaign portal.
 *
 * The shapes here mirror the Supabase schema one-for-one (camelCase here,
 * snake_case in Postgres) so that `src/data/supabase.ts` is a straight mapping
 * and nothing else in the app has to know where the rows came from.
 */

/**
 * Who can sign in. Clients are records in this system, not users — the database
 * has no auth link on `clients`, and the portal is for consultants and the
 * administrators who load their data.
 */
export type Role = "advisor" | "admin";

export type PassType = "gold" | "blue";

/**
 * A pass is `valid` once it counts toward a draw. `pending` covers passes that
 * are earned but not yet countable — a policy still inside its free-look window,
 * a referral that has not completed. `void` is an earned pass that was taken back
 * (policy cancelled, referral fell through) and is kept rather than deleted so the
 * ledger stays append-only and auditable.
 */
export type PassStatus = "valid" | "pending" | "void";

/**
 * How often a draw is held for a pass type. `monthly` means a pass enters the
 * draw for the month it was earned; `campaign_end` means passes accumulate into
 * a single draw at campaign close.
 *
 * This is what decides when a pass is spent, because a pass is spent by the
 * draw it enters — see `src/lib/passes.ts`.
 */
export type DrawSchedule = "monthly" | "campaign_end";

/** A draw month, always "YYYY-MM". Lexicographic order is chronological order. */
export type DrawMonth = string;

export interface Campaign {
  id: string;
  name: string;
  slug: string;
  startsOn: string;
  endsOn: string;
  /** Signed URL to the campaign details artwork the admin uploaded. */
  detailsImageUrl: string | null;
  /** Date of the most recent committed CSV upload — drives "Updated as of". */
  dataAsOf: string | null;
  /**
   * When each pass type is drawn, and so when it is used up. Blue runs monthly;
   * gold accumulates into one draw at campaign close. Held per campaign because
   * it is a campaign term, not a property of the software — if gold turns out to
   * be drawn monthly too, this is the one value that changes.
   */
  drawSchedule: Record<PassType, DrawSchedule>;
}

export interface Activity {
  id: string;
  campaignId: string;
  code: string;
  label: string;
  passType: PassType;
  passesPerUnit: number;
  /**
   * What one unit of this activity is — "Case", "Referral", "Event", "Guest".
   * Null for one-off activities that are not counted per anything ("Submit A
   * Testimonial (3 Passes)"), which is why this is nullable rather than "".
   */
  unitLabel: string | null;
  sortOrder: number;
  /**
   * Worth passes exactly once per client, however many rows the ledger holds —
   * downloading the app, submitting a testimonial. Set from `ONCE_PER_CLIENT` in
   * `src/lib/campaignRules.ts`, because `challenge_types` has no column for it.
   */
  oncePerClient: boolean;
}

export interface Advisor {
  id: string;
  fcCode: string;
  fullName: string;
  email: string;
}

export interface ClientRecord {
  id: string;
  externalRef: string;
  fullName: string;
  email: string;
  mobile: string;
  advisorId: string;
}

export interface PassEvent {
  id: string;
  campaignId: string;
  clientId: string;
  activityId: string;
  units: number;
  /**
   * Passes awarded, stored rather than recomputed from `passesPerUnit`, so that
   * changing a campaign rule next month does not silently rewrite last month's
   * ledger.
   */
  passes: number;
  earnedOn: string;
  drawMonth: DrawMonth;
  status: PassStatus;
  voidReason: string | null;
  /**
   * Set when a specific pass was retired by hand. Ordinary spending is derived
   * from whether the pass's draw has run, so this stays null for almost every
   * row — it exists for administrative corrections.
   */
  consumedByDrawId: string | null;
  /** Policy number, referral name, event name — the thing that makes a row unique. */
  reference: string;
}

/**
 * One draw: a pass type, and the month it is drawn for. Gold and blue are drawn
 * separately, so a month can carry one row of each.
 */
export interface Draw {
  id: string;
  campaignId: string;
  drawMonth: DrawMonth;
  passType: PassType;
  /** Once true, every pass entered into this draw is spent. */
  isDrawn: boolean;
  drawnAt: string | null;
}

export interface DrawWinner {
  id: string;
  drawId: string;
  drawMonth: DrawMonth;
  clientId: string;
  /** Shortened for the firm-wide winners list — "Jake P." rather than the full name. */
  displayName: string;
  prize: string;
  passType: PassType;
}

/**
 * The signed-in user, as two independent facts rather than one role.
 *
 * They really are independent: the admin claim lives in `app_metadata`, the
 * consultant record lives in the `advisors` table, and one person can hold
 * both. A single `role` field could only ever report one of them, so granting
 * an admin claim to a practising consultant silently took their client book
 * away — the page they landed on changed, and `/clients` bounced them back.
 *
 * Everything the app gates on now asks which of these is true, not which name
 * the account goes by.
 */
export interface Viewer {
  userId: string;
  email: string;
  fullName: string;
  /** Non-null when this account has a consultant record, and so a client book. */
  advisorId: string | null;
  /** True when `app_metadata.role` is "admin" — the only place it can be claimed. */
  isAdmin: boolean;
}

/** What a page needs of a viewer. See `can` in `AuthProvider`. */
export type Capability = "clients" | "admin";

/** One row of the advisor's client table. `gold`/`blue` are live passes only. */
export interface AdvisorClientRow {
  client: ClientRecord;
  gold: number;
  blue: number;
  /**
   * Passes in a closed draw whose result is not recorded yet. Not shown per row
   * — the columns are the ballot now collecting — but summed across the book so
   * the page can explain a column of zeroes in the days after a month turns.
   */
  awaiting: number;
  /** True once this client has won a published draw — drives the Winner badge. */
  won: boolean;
}

/** Everything the client statement panel renders. */
export interface ClientStatement {
  client: ClientRecord;
  events: PassEvent[];
  winners: DrawWinner[];
}
