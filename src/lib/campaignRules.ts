/**
 * Campaign terms the database has no column for yet.
 *
 * `challenge_types` is a rate card: code, label, pass type, passes per unit. It
 * carries no notion of an activity a client can only ever do once, so that lives
 * here — in one small file rather than scattered through the mappers, because it
 * is a campaign term the firm will want to change without reading any code
 * around it.
 *
 * To move it into the database later: add a boolean column to `challenge_types`,
 * read it in `toActivity`, and delete this file. Nothing else refers to these
 * codes.
 */

/**
 * Activities worth passes exactly once per client, however many times they turn
 * up in the ledger. A client downloads the app once and writes one testimonial;
 * further rows are the same event re-exported, not a second award.
 */
export const ONCE_PER_CLIENT: ReadonlySet<string> = new Set([
  "download_finconnect",
  "submit_testimonial",
]);

export const isOncePerClient = (code: string): boolean =>
  ONCE_PER_CLIENT.has(code.trim().toLowerCase());
