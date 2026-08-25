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

export type DrawStatus = "scheduled" | "drawn" | "published";

/** Re-exported from the pass rules so `Campaign` can be read on its own. */
export type PassExpiry = "month_end" | "campaign_end";

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
  /** Whether winning a draw spends the passes that were entered into it. */
  consumePassesOnWin: boolean;
  /**
   * How long each pass type keeps counting. Blue passes are typically spent in
   * the month they are earned; gold passes carry through the campaign. Held per
   * campaign because it is a campaign term, not a property of the software.
   */
  passExpiry: Record<PassType, PassExpiry>;
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
  /** Set when this pass was spent winning a draw. */
  consumedByDrawId: string | null;
  /** Policy number, referral name, event name — the thing that makes a row unique. */
  reference: string;
}

export interface Draw {
  id: string;
  campaignId: string;
  drawMonth: DrawMonth;
  status: DrawStatus;
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

/** The signed-in user, resolved to the record their role hangs off. */
export interface Viewer {
  userId: string;
  email: string;
  role: Role;
  fullName: string;
  /** Set when role === "advisor". */
  advisorId: string | null;
}

/** One row of the advisor's client table. */
export interface AdvisorClientRow {
  client: ClientRecord;
  gold: number;
  blue: number;
}

/** Everything the client statement panel renders. */
export interface ClientStatement {
  client: ClientRecord;
  events: PassEvent[];
  winners: DrawWinner[];
}
