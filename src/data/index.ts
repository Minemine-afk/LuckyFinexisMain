import { USE_MOCK } from "../lib/supabase";
import type { PortalApi } from "./api";
import { mockApi } from "./mockApi";
import { supabaseApi } from "./supabaseApi";

/** The single place the rest of the app gets its data from. */
export const api: PortalApi = USE_MOCK ? mockApi : supabaseApi;

export { USE_MOCK };
export { ApiError } from "./api";
export type { PortalApi, CommitResult } from "./api";
