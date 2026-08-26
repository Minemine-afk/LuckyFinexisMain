import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The project this app talks to, compiled in as a default.
 *
 * Both values are meant to be public: the URL is a hostname, and the anon key is
 * a JWT whose only claim is `role: anon`. It grants nothing on its own — every
 * table is protected by row level security, so a request carrying this key
 * returns exactly the rows the signed-in user's policies allow, and nothing to
 * an anonymous caller. Supabase publishes these for browsers for that reason.
 *
 * They are defaults rather than the only source: the environment variables below
 * still win, so a different Supabase project can be pointed at without a code
 * change. Hard-coding them means the build no longer silently falls back to demo
 * data when a host's build-time variables are missing — the failure mode that
 * cost most of a day.
 *
 * The service role key must never appear here, or in any VITE_ variable. It
 * bypasses row level security and would be readable by every visitor.
 */
const DEFAULT_URL = "https://neomyduxgyrzyjzyhxxf.supabase.co";
const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lb215ZHV4Z3lyenlqenloeHhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NTQ4MzUsImV4cCI6MjEwMzEzMDgzNX0.pCEvCIP9zGXRh5ReSPUsVEwlpCybndCw5STykiTQt6k";

const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

/**
 * True when the app is running against the built-in demo data instead of
 * Supabase. Now only ever a deliberate choice, since credentials are always
 * present.
 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

/** Why the app is on demo data, or null when it is not. */
export const MOCK_REASON: string | null = USE_MOCK
  ? 'VITE_USE_MOCK is set to "true"'
  : null;

let client: SupabaseClient | null = null;

/**
 * The browser client carries the anon key and the signed-in user's JWT. It can
 * only ever read what row level security allows that user to read, which is why
 * shipping the anon key in the bundle is safe and the service role key is not.
 */
export function supabase(): SupabaseClient {
  if (USE_MOCK) {
    throw new Error("Supabase client requested while running in demo mode.");
  }
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
