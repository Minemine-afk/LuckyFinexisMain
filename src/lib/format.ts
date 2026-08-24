import type { Activity, DrawMonth, PassType } from "./types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08" → "August". Month chips and the prizes table use the bare name. */
export function monthName(drawMonth: DrawMonth): string {
  const i = Number(drawMonth.slice(5, 7)) - 1;
  return MONTHS[i] ?? drawMonth;
}

/** "2026-08" → "August 2026", for anywhere the year is not obvious from context. */
export function monthAndYear(drawMonth: DrawMonth): string {
  return `${monthName(drawMonth)} ${drawMonth.slice(0, 4)}`;
}

/** "2026-08-15" → "15 Aug 2026", the format the mockup footer uses. */
export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

/**
 * The parenthetical after an activity name:
 *   "Purchase Qualifying Product (21 Passes Per Case)"
 *   "Submit A Testimonial (3 Passes)"
 *   "Download finConnect (1 Pass)"
 */
export function activityRule(a: Activity): string {
  const passes = `${a.passesPerUnit} ${a.passesPerUnit === 1 ? "Pass" : "Passes"}`;
  return a.unitLabel ? `${passes} Per ${a.unitLabel}` : passes;
}

export const passTypeLabel = (t: PassType): string =>
  t === "gold" ? "Gold" : "Blue";

/** Mobile numbers arrive from the CSV unformatted; group them for reading. */
export function formatMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return mobile;
}

/** "Jake Peralta" → "Jake P." for the firm-wide winners list. */
export function shortenName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
