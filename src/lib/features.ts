import { USE_MOCK } from "./supabase";

/**
 * Whether the client statement is reachable.
 *
 * The client view needs row level security policies letting a client read their
 * own ledger. Without them, RLS denies by default and every query comes back
 * empty — so the page would show zero passes to someone who has earned fifty,
 * with no error to explain it. Wrong numbers presented as fact are worse than a
 * closed door, so the route stays shut against a backend that cannot answer.
 *
 * Demo data has no such limit, so the statement stays open there. Set
 * VITE_CLIENT_PORTAL=true once the policies exist; no code change needed.
 *
 * Kept as a pure function so the default can be asserted in a test — the risk
 * worth guarding is someone later making this default to open.
 */
export const clientPortalEnabled = (
  useMock: boolean,
  envFlag: string | undefined,
): boolean => useMock || envFlag === "true";

export const CLIENT_PORTAL_ENABLED = clientPortalEnabled(
  USE_MOCK,
  import.meta.env.VITE_CLIENT_PORTAL,
);
