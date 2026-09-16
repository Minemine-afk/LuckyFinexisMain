import type { ClientRecord } from "./types";

/**
 * Finding a client by the mobile number an administrator reads off a draw sheet.
 *
 * Draws are run offline. What comes back is a list of numbers and prizes, typed
 * in by hand from whatever the winner wrote down — so the matching has to cope
 * with `+65 9123 4567`, `6591234567` and `91234567` all being the same person,
 * and has to refuse rather than guess when a number names two of them.
 */

/**
 * A mobile number reduced to the digits that identify a person.
 *
 * Digits only, and a leading Singapore country code is dropped: a stored
 * `91234567` and a typed `+65 9123 4567` are the same client, and an admin
 * copying from a phone's contact list gets the longer form. 65 is only removed
 * when what remains is a plausible local number, so an 8-digit number that
 * happens to start `65` — and there are real ones — survives intact.
 *
 * Deliberately separate from `formatMobile` in `format.ts`, which exists to put
 * a space in the middle for display and must not start deciding identity.
 */
export function normaliseMobile(value: string): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("65")) return digits.slice(2);
  return digits;
}

export type MobileMatch =
  | { kind: "ok"; client: ClientRecord }
  /** Two or more clients answer to this number. */
  | { kind: "ambiguous"; count: number }
  | { kind: "none" };

/** A number that matches more than one client resolves to this. */
const AMBIGUOUS = Symbol("ambiguous");

type Entry = ClientRecord | typeof AMBIGUOUS;

/**
 * Index clients by their normalised mobile number.
 *
 * A number matching two different clients is marked ambiguous rather than
 * resolving to whichever was indexed last — the same rule, and for the same
 * reason, as `indexClients` in `ingest.ts`. Couples often share a mobile on
 * file, and recording one person's prize against their spouse is worse than
 * asking the administrator to identify which of them won.
 */
function indexByMobile(clients: ClientRecord[]): Map<string, Entry> {
  const index = new Map<string, Entry>();
  for (const client of clients) {
    const key = normaliseMobile(client.mobile);
    if (!key) continue;
    const seen = index.get(key);
    if (seen === undefined) index.set(key, client);
    else if (seen !== AMBIGUOUS && seen.id !== client.id) index.set(key, AMBIGUOUS);
  }
  return index;
}

/**
 * Resolve a typed mobile number against a client list.
 *
 * Builds the index on every call, which is the right trade at this scale: an
 * administrator types one number every few seconds, and a stale index after a
 * refresh would be a far worse bug than the work of rebuilding a map of a few
 * thousand entries.
 */
export function findByMobile(clients: ClientRecord[], input: string): MobileMatch {
  const key = normaliseMobile(input);
  if (!key) return { kind: "none" };

  const hit = indexByMobile(clients).get(key);
  if (hit === undefined) return { kind: "none" };
  if (hit === AMBIGUOUS) {
    const count = clients.filter((c) => normaliseMobile(c.mobile) === key).length;
    return { kind: "ambiguous", count };
  }
  return { kind: "ok", client: hit };
}

/**
 * Prize suggestions, offered as a datalist rather than a fixed list.
 *
 * The prize is whatever was actually given away, so the field stays free text —
 * these only save typing and keep the wording consistent between months. Gold is
 * the campaign-close pool and carries the larger prizes; blue is drawn monthly.
 */
export const PRIZE_SUGGESTIONS: Record<"gold" | "blue", string[]> = {
  gold: [
    "Business class return flight to Tokyo",
    "5-night stay at Marina Bay Sands",
    "Singapore Airlines travel voucher ($3,000)",
    "Rimowa cabin luggage set",
  ],
  blue: [
    "Apple AirPods Pro",
    "Dyson Airwrap",
    "OSIM uJolly massage chair",
    "Sentosa weekend staycation",
    "Dining voucher ($200)",
    "Klook travel credit ($150)",
  ],
};
