import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when the app is running against the built-in demo data instead of Supabase. */
export const USE_MOCK =
  import.meta.env.VITE_USE_MOCK === "true" || !url || !anonKey;

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
