import { describe, expect, it } from "vitest";
import * as seed from "../data/mock";
import {
  buildPassBlocks,
  currentDrawMonth,
  drawMonthOf,
  expiredPasses,
  lastDrawMonthFor,
  passesForDraw,
  type CampaignRules,
} from "./passes";
import type { PassEvent } from "./types";

const eventsFor = (clientId: string) =>
  seed.passEvents.filter((e) => e.clientId === clientId);

/** The month the demo campaign is currently collecting for. */
const THIS_MONTH = currentDrawMonth(seed.campaign);

/** Rules with an explicit window, for tests that do not want the demo's dates. */
const rules = (
  gold: CampaignRules["passExpiry"]["gold"],
  blue: CampaignRules["passExpiry"]["blue"],
  endsOn = "2026-12-31",
): CampaignRules => ({ passExpiry: { gold, blue }, endsOn });

const event = (drawMonth: string, passes = 10): PassEvent => ({
  id: "e1",
  campaignId: "c",
  clientId: "cli",
  activityId: "a",
  units: 1,
  passes,
  earnedOn: `${drawMonth}-05`,
  drawMonth,
  status: "valid",
  voidReason: null,
  consumedByDrawId: null,
  reference: "r",
});

describe("pass totals", () => {
  it("reproduces the mockup: Jake Peralta holds 21 gold and 50 blue", () => {
    const events = eventsFor("cli-1");
    expect(passesForDraw(events, "gold", seed.activities, seed.campaign, THIS_MONTH)).toBe(21);
    expect(passesForDraw(events, "blue", seed.activities, seed.campaign, THIS_MONTH)).toBe(50);
  });

  it("breaks the blue passes down exactly as the statement shows", () => {
    const blocks = buildPassBlocks(seed.activities, eventsFor("cli-1"), seed.campaign, THIS_MONTH);
    const blue = blocks.find((b) => b.passType === "blue")!;
    const byLabel = Object.fromEntries(blue.rows.map((r) => [r.activity.label, r.passes]));

    expect(byLabel["Submit Referrals"]).toBe(10);
    expect(byLabel["Attend Client Events"]).toBe(10);
    expect(byLabel["Bring Guests For Client Events"]).toBe(30);
    expect(byLabel["Submit A Testimonial"]).toBe(0);
    expect(byLabel["Download finConnect"]).toBe(0);
  });

  it("lists every activity, including the ones worth nothing yet", () => {
    const blocks = buildPassBlocks(seed.activities, eventsFor("cli-5"), seed.campaign, THIS_MONTH);
    const rowCount = blocks.reduce((n, b) => n + b.rows.length, 0);
    expect(rowCount).toBe(seed.activities.length);
  });

  it("keeps pending and voided passes out of the total but still reports them", () => {
    const gina = eventsFor("cli-4");
    const gold = buildPassBlocks(seed.activities, gina, seed.campaign, THIS_MONTH)
      .find((b) => b.passType === "gold")!;

    // One pending case (21) and one voided referral purchase (21).
    expect(gold.total).toBe(0);
    expect(gold.pending).toBe(21);
    expect(gold.voided).toBe(21);
  });
});

describe("expiry", () => {
  const monthly = rules("campaign_end", "month_end");

  it("retires a blue pass once its own month is over", () => {
    const july = [event("2026-07")];
    expect(passesForDraw(july, "blue", [{ ...seed.activities[2], id: "a" }], monthly, "2026-07")).toBe(10);
    expect(passesForDraw(july, "blue", [{ ...seed.activities[2], id: "a" }], monthly, "2026-08")).toBe(0);
  });

  it("carries a gold pass through every remaining draw", () => {
    const july = [event("2026-07")];
    const gold = [{ ...seed.activities[0], id: "a" }];
    expect(passesForDraw(july, "gold", gold, monthly, "2026-08")).toBe(10);
    expect(passesForDraw(july, "gold", gold, monthly, "2026-12")).toBe(10);
  });

  it("stops a gold pass at the campaign's close", () => {
    const gold = [{ ...seed.activities[0], id: "a" }];
    expect(lastDrawMonthFor(event("2026-07"), "gold", monthly)).toBe("2026-12");
    expect(passesForDraw([event("2026-07")], "gold", gold, monthly, "2027-01")).toBe(0);
  });

  it("counts a retired blue pass as expired rather than losing it", () => {
    const blue = [{ ...seed.activities[2], id: "a" }];
    expect(expiredPasses([event("2026-07")], "blue", blue, monthly, "2026-08")).toBe(10);
    expect(expiredPasses([event("2026-07")], "blue", blue, monthly, "2026-07")).toBe(0);
  });

  it("shows Terry's expired blue on the statement instead of dropping it", () => {
    // Last month's referral, event and guest passes: 4 + 5 + 10.
    const blue = buildPassBlocks(seed.activities, eventsFor("cli-3"), seed.campaign, THIS_MONTH)
      .find((b) => b.passType === "blue")!;
    expect(blue.expired).toBe(19);
    // Only this month's testimonial and app download still count.
    expect(blue.total).toBe(4);
  });

  it("does not expire a pass that has not reached its draw yet", () => {
    const blue = [{ ...seed.activities[2], id: "a" }];
    const later = [event("2026-11")];
    expect(passesForDraw(later, "blue", blue, monthly, "2026-08")).toBe(0);
    expect(expiredPasses(later, "blue", blue, monthly, "2026-08")).toBe(0);
    const block = buildPassBlocks([{ ...seed.activities[2], id: "a" }], later, monthly, "2026-08")
      .find((b) => b.passType === "blue")!;
    expect(block.upcoming).toBe(10);
  });

  it("drops passes that were spent winning a draw", () => {
    const [first, ...rest] = eventsFor("cli-1");
    const spent = [{ ...first, consumedByDrawId: "draw-current" }, ...rest];
    expect(passesForDraw(spent, "gold", seed.activities, seed.campaign, THIS_MONTH)).toBe(0);
  });
});

describe("current draw month", () => {
  const window = { startsOn: "2026-07-01", endsOn: "2026-12-31" };

  it("is the calendar month while the campaign is running", () => {
    expect(currentDrawMonth(window, new Date("2026-09-14T00:00:00Z"))).toBe("2026-09");
  });

  it("holds at the first month before the campaign opens", () => {
    expect(currentDrawMonth(window, new Date("2026-05-02T00:00:00Z"))).toBe("2026-07");
  });

  it("holds at the last month once the campaign has closed", () => {
    expect(currentDrawMonth(window, new Date("2027-04-02T00:00:00Z"))).toBe("2026-12");
  });

  it("derives the draw month from the date the pass was earned", () => {
    expect(drawMonthOf("2026-08-15")).toBe("2026-08");
  });
});
