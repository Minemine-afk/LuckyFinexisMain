import type { UploadPreview } from "../lib/ingest";
import type {
  Activity,
  AdvisorClientRow,
  Campaign,
  ClientRecord,
  ClientStatement,
  Draw,
  DrawWinner,
  DrawMonth,
  Viewer,
} from "../lib/types";

export interface CommitResult {
  inserted: number;
  skipped: number;
}

/** A client and how many passes they hold in one particular draw. */
export interface DrawEntrant {
  client: ClientRecord;
  passes: number;
}

/** One line off the draw sheet: who won, and what. */
export interface RecordedWinner {
  clientId: string;
  prize: string;
}

/**
 * Everything the UI is allowed to know about where data comes from.
 *
 * Two implementations satisfy it: `mockApi` (in-memory demo data, no backend)
 * and `supabaseApi` (Supabase Auth + PostgREST). Pages and components import the
 * interface, never a provider, so swapping the backend touches only this folder.
 *
 * The handful of methods that write are admin-only and go straight to PostgREST,
 * gated by row level security rather than by a server of our own — see the note
 * at the end of `supabase/migrations/0005_pass_ledger_writes.sql`.
 */
export interface PortalApi {
  signIn(email: string, password: string): Promise<Viewer>;
  signOut(): Promise<void>;
  /** Resolve an existing session on page load; null when signed out. */
  currentViewer(): Promise<Viewer | null>;
  /**
   * Watch the session for ending underneath the app — an expired or revoked
   * token, a refresh that failed, a sign-out in another tab, or a consultant
   * record that has stopped resolving.
   *
   * Without this the app only ever checks at page load, and a session that dies
   * mid-visit leaves the UI signed in: row level security answers a denied read
   * with an empty result rather than an error, so the consultant is told their
   * book is empty instead of being asked to sign in again.
   *
   * Returns an unsubscribe function.
   */
  onSessionChange(handler: (viewer: Viewer | null) => void): () => void;

  /**
   * Set a new password, after proving the current one.
   *
   * The current password is not ceremony: Supabase will change a password on
   * the strength of a session alone, so without this an unattended laptop is
   * enough to take a consultant's account away from them.
   */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;

  getCampaign(): Promise<Campaign>;
  getActivities(campaignId: string): Promise<Activity[]>;

  /** The advisor's client table — one row per client holding passes. */
  getAdvisorClients(advisorId: string, campaignId: string): Promise<AdvisorClientRow[]>;
  /** The full statement behind the magnifier icon, and the client's own page. */
  getClientStatement(clientId: string, campaignId: string): Promise<ClientStatement>;

  /**
   * Every draw in the campaign, drawn or not. The whole list is needed, not just
   * the published ones: which draws have run is what decides whether a pass is
   * still live, and the ones still to come are what a client's remaining passes
   * are waiting for.
   */
  getDraws(campaignId: string): Promise<Draw[]>;
  getWinners(campaignId: string, drawMonth: DrawMonth): Promise<DrawWinner[]>;

  /**
   * Admin: every client with the passes they hold in one draw.
   *
   * Includes clients holding **zero** — deliberately. The screen has to tell
   * "no client has that mobile number" from "that client is not in this draw",
   * and only a list carrying both can.
   */
  getDrawEntrants(campaignId: string, drawId: string): Promise<DrawEntrant[]>;

  /**
   * Admin: record the result of a draw, and close it.
   *
   * Closing is the part that matters: a pass is used up by the draw it entered,
   * so this is what turns every entrant's passes from `awaiting` into `drawn`
   * and either "Won — prize" or "Unsuccessful". Nothing else in the app spends a
   * pass. Re-recording the same winners is a no-op rather than a duplicate.
   */
  recordDraw(campaignId: string, drawId: string, winners: RecordedWinner[]): Promise<void>;

  /**
   * Admin: reopen a draw, discarding its recorded winners.
   *
   * The way back from a mistyped result. The entrants' passes return to
   * `awaiting`, and the month stops appearing on the winners page.
   */
  undoDraw(drawId: string): Promise<void>;

  /** Admin: dry-run an upload. Nothing is written. */
  previewUpload(file: File, campaignId: string): Promise<UploadPreview>;
  /** Admin: commit a previewed upload. Duplicates and rejects are skipped. */
  commitUpload(preview: UploadPreview, campaignId: string): Promise<CommitResult>;
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}
