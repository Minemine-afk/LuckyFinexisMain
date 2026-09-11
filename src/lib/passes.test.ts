import { describe, expect, it } from "vitest";
import * as seed from "../data/mock";
import {
  buildDrawHistory,
  buildPassBlocks,
  currentDrawMonth,
  drawEnteredBy,
  drawMonthOf,
  drawnKeys,
  livePasses,
  spentPasses,
  type CampaignRules,
} from "./passes";
import type { Draw, PassEvent } from "./types";

const eventsFor = (clientId: string) =>
  seed.passEvents.filter((e) => e.clientId === clientId);

const winnersFor = (clientId: string) =>
  seed.drawWinners.filter((w) => w.clientId === clientId);

/** Which draws the demo has actually run — last month's blue, and no other. */
const SEED_DRAWN = drawnKeys(seed.draws);

/** Rules with an explicit window, for tests that do not want the demo's dates. */
const rules = (
  gold: CampaignRules["drawSchedule"]["gold"],
  blue: CampaignRules["drawSchedule"]["blue"],
  endsOn = "2026-12-31",
): CampaignRules => ({ drawSchedule: { gold, blue }, endsOn });

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

const draw = (passType: "gold" | "blue", drawMonth: string, isDrawn: boolean): Draw => ({
  id: `${passType}-${drawMonth}`,
  campaignId: "c",
  drawMonth,
  passType,
  isDrawn,
  drawnAt: isDrawn ? `${drawMonth}-28` : null,
});

describe("pass totals", () => {
  it("reproduces the mockup: Jake entered 50 blue passes and has 21 gold", () => {
    const events = eventsFor("cli-1");
    // Gold waits on the campaign-close draw, so all 21 are still live.
    expect(livePasses(events, "gold", seed.activities, seed.campaign, SEED_DRAWN)).toBe(21);
    // The 50 blue he won with went with last month's draw.
    expect(spentPasses(events, "blue", seed.activities, seed.campaign, SEED_DRAWN)).toBe(50);
    // This month he has started again: 1 referral (2) and 1 event (5).
    expect(livePasses(events, "blue", seed.activities, seed.campaign, SEED_DRAWN)).toBe(7);
  });

  it("breaks this month's blue passes down exactly as the statement shows", () => {
    const blocks = buildPassBlocks(seed.activities, eventsFor("cli-1"), seed.campaign, SEED_DRAWN);
    const blue = blocks.find((b) => b.passType === "blue")!;
    const byLabel = Object.fromEntries(blue.rows.map((r) => [r.activity.label, r.passes]));

    expect(byLabel["Submit Referrals"]).toBe(2);
    expect(byLabel["Attend Client Events"]).toBe(5);
    // Last month's guest passes went into the draw he won, so they read zero.
    expect(byLabel["Bring Guests For Client Events"]).toBe(0);
    expect(byLabel["Submit A Testimonial"]).toBe(0);
    expect(byLabel["Download finConnect"]).toBe(0);
  });

  it("lists every activity, including the ones worth nothing yet", () => {
    const blocks = buildPassBlocks(seed.activities, eventsFor("cli-5"), seed.campaign, SEED_DRAWN);
    const rowCount = blocks.reduce((n, b) => n + b.rows.length, 0);
    expect(rowCount).toBe(seed.activities.length);
  });

  it("keeps pending and voided passes out of the total but still reports them", () => {
    const gina = eventsFor("cli-4");
    const gold = buildPassBlocks(seed.activities, gina, seed.campaign, SEED_DRAWN)
      .find((b) => b.passType === "gold")!;

    // One pending case (21) and one voided referral purchase (21).
    expect(gold.total).toBe(0);
    expect(gold.pending).toBe(21);
    expect(gold.voided).toBe(21);
  });
});

describe("spending a pass on the draw it enters", () => {
  const monthly = rules("campaign_end", "monthly");
  const blueOnly = [{ ...seed.activities[2], id: "a" }];
  const goldOnly = [{ ...seed.activities[0], id: "a" }];

  it("leaves a blue pass live while its own draw is still to run", () => {
    const drawn = drawnKeys([draw("blue", "2026-07", false)]);
    expect(livePasses([event("2026-07")], "blue", blueOnly, monthly, drawn)).toBe(10);
  });

  it("spends a blue pass the moment its month's draw is run", () => {
    const drawn = drawnKeys([draw("blue", "2026-07", true)]);
    expect(livePasses([event("2026-07")], "blue", blueOnly, monthly, drawn)).toBe(0);
    expect(spentPasses([event("2026-07")], "blue", blueOnly, monthly, drawn)).toBe(10);
  });

  it("does not let one month's draw touch another month's passes", () => {
    const drawn = drawnKeys([draw("blue", "2026-07", true)]);
    expect(livePasses([event("2026-08")], "blue", blueOnly, monthly, drawn)).toBe(10);
  });

  it("does not let the blue draw touch gold", () => {
    const drawn = drawnKeys([draw("blue", "2026-07", true)]);
    expect(livePasses([event("2026-07")], "gold", goldOnly, monthly, drawn)).toBe(10);
  });

  it("holds gold for the campaign-close draw whatever month it was earned in", () => {
    expect(drawEnteredBy(event("2026-07"), "gold", monthly)).toBe("2026-12");
    expect(drawEnteredBy(event("2026-11"), "gold", monthly)).toBe("2026-12");
  });

  it("spends every gold pass at once when the campaign-close draw runs", () => {
    const drawn = drawnKeys([draw("gold", "2026-12", true)]);
    const held = [event("2026-07"), { ...event("2026-11"), id: "e2" }];
    expect(livePasses(held, "gold", goldOnly, monthly, drawn)).toBe(0);
    expect(spentPasses(held, "gold", goldOnly, monthly, drawn)).toBe(20);
  });

  it("honours a pass retired by hand even with no draw run", () => {
    const spent = [{ ...event("2026-07"), consumedByDrawId: "adjustment-1" }];
    expect(livePasses(spent, "blue", blueOnly, monthly, new Set())).toBe(0);
  });

  it("reports Terry's spent blue on the statement instead of dropping it", () => {
    // Last month's referral, event and guest passes: 4 + 5 + 10.
    const blue = buildPassBlocks(seed.activities, eventsFor("cli-3"), seed.campaign, SEED_DRAWN)
      .find((b) => b.passType === "blue")!;
    expect(blue.spent).toBe(19);
    // Only this month's testimonial and app download are still in a draw.
    expect(blue.total).toBe(4);
  });

  it("switches gold to monthly with one setting and nothing else", () => {
    const everyMonth = rules("monthly", "monthly");
    const drawn = drawnKeys([draw("gold", "2026-07", true)]);
    expect(livePasses([event("2026-07")], "gold", goldOnly, everyMonth, drawn)).toBe(0);
  });
});

describe("previous passes", () => {
  it("shows Jake the draw he won, and the one he is still in", () => {
    const history = buildDrawHistory(
      seed.activities,
      eventsFor("cli-1"),
      seed.campaign,
      SEED_DRAWN,
      winnersFor("cli-1"),
    );

    const won = history.find((h) => h.state === "won")!;
    expect(won.passType).toBe("blue");
    expect(won.passes).toBe(50);
    expect(won.prize).toBe("OSIM uJolly");

    const open = history.filter((h) => h.state === "open");
    // This month's blue, plus the gold waiting on the campaign-close draw.
    expect(open.map((h) => h.passType).sort()).toEqual(["blue", "gold"]);
    expect(open.find((h) => h.passType === "gold")!.passes).toBe(21);
  });

  it("marks passes spent by a draw that was not won", () => {
    const history = buildDrawHistory(
      seed.activities,
      eventsFor("cli-2"),
      seed.campaign,
      SEED_DRAWN,
      winnersFor("cli-2"),
    );
    const spent = history.find((h) => h.state === "spent")!;
    expect(spent.passType).toBe("blue");
    expect(spent.passes).toBe(4);
    expect(spent.prize).toBeNull();
  });

  it("names where the passes came from", () => {
    const history = buildDrawHistory(
      seed.activities,
      eventsFor("cli-1"),
      seed.campaign,
      SEED_DRAWN,
      winnersFor("cli-1"),
    );
    const won = history.find((h) => h.state === "won")!;
    expect(won.parts).toContain("5 referrals");
    expect(won.parts).toContain("3 guests");
  });

  it("orders the newest draw first", () => {
    const history = buildDrawHistory(
      seed.activities,
      eventsFor("cli-1"),
      seed.campaign,
      SEED_DRAWN,
      winnersFor("cli-1"),
    );
    const months = history.map((h) => h.drawMonth);
    expect([...months].sort().reverse()).toEqual(months);
  });

  it("leaves out pending and voided passes, which are in no draw", () => {
    const history = buildDrawHistory(
      seed.activities,
      eventsFor("cli-4"),
      seed.campaign,
      SEED_DRAWN,
      winnersFor("cli-4"),
    );
    // Gina's only confirmed passes are blue; her gold is pending or voided.
    expect(history.every((h) => h.passType === "blue")).toBe(true);
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
