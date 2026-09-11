import type { UploadPreview } from "../lib/ingest";
import type {
  Activity,
  AdvisorClientRow,
  Campaign,
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

/**
 * Everything the UI is allowed to know about where data comes from.
 *
 * Two implementations satisfy it: `mockApi` (in-memory demo data, no backend)
 * and `supabaseApi` (Supabase Auth + PostgREST, with the privileged writes
 * routed through Cloudflare Pages Functions). Pages and components import the
 * interface, never a provider, so swapping the backend touches only this folder.
 */
export interface PortalApi {
  signIn(email: string, password: string): Promise<Viewer>;
  signOut(): Promise<void>;
  /** Resolve an existing session on page load; null when signed out. */
  currentViewer(): Promise<Viewer | null>;

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
