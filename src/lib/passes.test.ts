import { describe, expect, it } from "vitest";
import * as seed from "../data/mock";
import {
  buildPassBlocks,
  drawMonthOf,
  passesEligibleForDraw,
  totalPasses,
} from "./passes";

const eventsFor = (clientId: string) =>
  seed.passEvents.filter((e) => e.clientId === clientId);

describe("pass totals", () => {
  it("reproduces the mockup: Jake Peralta holds 21 gold and 50 blue", () => {
    const events = eventsFor("cli-1");
    expect(totalPasses(events, "gold", seed.activities)).toBe(21);
    expect(totalPasses(events, "blue", seed.activities)).toBe(50);
  });

  it("breaks the blue passes down exactly as the statement shows", () => {
    const blocks = buildPassBlocks(seed.activities, eventsFor("cli-1"));
    const blue = blocks.find((b) => b.passType === "blue")!;
    const byLabel = Object.fromEntries(blue.rows.map((r) => [r.activity.label, r.passes]));

    expect(byLabel["Submit Referrals"]).toBe(10);
    expect(byLabel["Attend Client Events"]).toBe(10);
    expect(byLabel["Bring Guests For Client Events"]).toBe(30);
    expect(byLabel["Submit A Testimonial"]).toBe(0);
    expect(byLabel["Download finConnect"]).toBe(0);
  });

  it("lists every activity, including the ones worth nothing yet", () => {
    const blocks = buildPassBlocks(seed.activities, eventsFor("cli-5"));
    const rowCount = blocks.reduce((n, b) => n + b.rows.length, 0);
    expect(rowCount).toBe(seed.activities.length);
  });

  it("keeps pending and voided passes out of the total but still reports them", () => {
    const gina = eventsFor("cli-4");
    const blocks = buildPassBlocks(seed.activities, gina);
    const gold = blocks.find((b) => b.passType === "gold")!;

    // One pending case (21) and one voided referral purchase (21).
    expect(gold.total).toBe(0);
    expect(gold.pending).toBe(21);
    expect(gold.voided).toBe(21);
    expect(totalPasses(gina, "gold", seed.activities)).toBe(0);
  });
});

describe("draw eligibility", () => {
  it("carries a pass forward into every later draw", () => {
    const events = eventsFor("cli-1"); // all earned in July
    expect(passesEligibleForDraw(events, "2026-07", "blue", seed.activities)).toBe(50);
    expect(passesEligibleForDraw(events, "2026-12", "blue", seed.activities)).toBe(50);
  });

  it("does not put a pass into a draw that happened before it was earned", () => {
    const events = eventsFor("cli-5"); // one August event
    expect(passesEligibleForDraw(events, "2026-07", "blue", seed.activities)).toBe(0);
    expect(passesEligibleForDraw(events, "2026-08", "blue", seed.activities)).toBe(5);
  });

  it("drops passes that were spent winning a draw", () => {
    const [first, ...rest] = eventsFor("cli-1");
    const spent = [{ ...first, consumedByDrawId: "draw-2026-08" }, ...rest];
    expect(totalPasses(spent, "gold", seed.activities)).toBe(0);
    expect(totalPasses(eventsFor("cli-1"), "gold", seed.activities)).toBe(21);
  });

  it("derives the draw month from the date the pass was earned", () => {
    expect(drawMonthOf("2026-08-15")).toBe("2026-08");
  });
});
