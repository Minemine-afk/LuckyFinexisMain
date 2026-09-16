import type { Capability, Viewer } from "../lib/types";

/**
 * What a viewer may do, kept apart from `AuthProvider` on purpose.
 *
 * `AuthProvider` imports the data layer, and the data layer needs these
 * helpers — putting them there makes `data → AuthProvider → data` a cycle, and
 * the app dies on first paint with a blank page rather than an error anyone can
 * read. These are pure functions over a `Viewer` and import nothing but its
 * type, so they can be used from either side.
 */

/** Whether this viewer may open a given page. */
export const can = (viewer: Viewer, capability: Capability): boolean =>
  capability === "admin" ? viewer.isAdmin : viewer.advisorId !== null;

/**
 * Where a viewer lands after signing in.
 *
 * The client book wins when there is one. Someone who is both a consultant and
 * an administrator is a consultant most days and an administrator on the days a
 * file needs loading — and the importer is one click away on the rail either
 * way, where landing on it would put their own clients two.
 */
export const homePathFor = (viewer: Viewer): string =>
  viewer.advisorId !== null ? "/clients" : "/admin";

/** For the account page and the demo account list. */
export const roleLabel = (viewer: Viewer): string => {
  if (viewer.advisorId !== null && viewer.isAdmin) return "Consultant and administrator";
  return viewer.isAdmin ? "Administrator" : "Consultant";
};
