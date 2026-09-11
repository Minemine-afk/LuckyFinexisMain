import { describe, expect, it } from "vitest";
import * as seed from "../data/mock";
import {
  awaitingPasses,
  ballotMonth,
  buildDrawHistory,
  buildPassBlocks,
  currentDrawMonth,
  drawMonthOf,
  drawnKeys,
  eligibleEvents,
  livePasses,
  passState,
  passView,
  type CampaignRules,
  type PassView,
} from "./passes";
import type { Activity, Draw, PassEvent } from "./types";

const eventsFor = (clientId: string) =>
  seed.passEvents.filter((e) => e.clientId === clientId);

const winnersFor = (clientId: string) =>
  seed.drawWinners.filter((w) => w.clientId === clientId);

/** The demo as it stands today: one drawn month, one awaiting, one collecting. */
const SEED = passView(seed.campaign, seed.draws);

/** Rules with an explicit window, for tests that do not want the demo's dates. */
const rules = (
  gold: CampaignRules["drawSchedule"]["gold"],
  blue: CampaignRules["drawSchedule"]["blue"],
  endsOn = "2026-12-31",
): CampaignRules => ({ drawSchedule: { gold, blue }, endsOn });

const view = (
  currentMonth: string,
  draws: Draw[] = [],
  r: CampaignRules = rules("campaign_end", "monthly"),
): PassView => ({ rules: r, drawn: drawnKeys(draws), currentMonth });

const event = (drawMonth: string, passes = 10, over: Partial<PassEvent> = {}): PassEvent => ({
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
  ...over,
});

const draw = (passType: "gold" | "blue", drawMonth: string, isDrawn: boolean): Draw => ({
  id: `${passType}-${drawMonth}`,
  campaignId: "c",
  drawMonth,
  passType,
  isDrawn,
  drawnAt: isDrawn ? `${drawMonth}-28` : null,
});

/** A single-activity rate card, so `event` above can be summed against it. */
const card = (over: Partial<Activity> = {}): Activity[] => [
  {
    id: "a",
    campaignId: "c",
    code: "x",
    label: "Something",
    passType: "blue",
    passesPerUnit: 10,
    unitLabel: "Thing",
    sortOrder: 1,
    oncePerClient: false,
    ...over,
  },
];

describe("a pass belongs to one ballot", () => {
  const blue = card();
  const gold = card({ passType: "gold" });

  it("is live while its own month is the one collecting", () => {
    expect(passState(event("2026-07"), "blue", view("2026-07"))).toBe("live");
    expect(livePasses([event("2026-07")], "blue", blue, view("2026-07"))).toBe(10);
  });

  it("is not carried into the next month, drawn or not", () => {
    const v = view("2026-08", [draw("blue", "2026-07", false)]);
    expect(passState(event("2026-07"), "blue", v)).toBe("awaiting");
    expect(livePasses([event("2026-07")], "blue", blue, v)).toBe(0);
    expect(awaitingPasses([event("2026-07")], "blue", blue, v)).toBe(10);
  });

  it("is used up once its own draw is recorded", () => {
    const v = view("2026-07", [draw("blue", "2026-07", true)]);
    expect(passState(event("2026-07"), "blue", v)).toBe("drawn");
    expect(livePasses([event("2026-07")], "blue", blue, v)).toBe(0);
  });

  it("stops awaiting once the result comes in", () => {
    const v = view("2026-08", [draw("blue", "2026-07", true)]);
    expect(passState(event("2026-07"), "blue", v)).toBe("drawn");
    expect(awaitingPasses([event("2026-07")], "blue", blue, v)).toBe(0);
  });

  it("waits its turn when deliberately deferred to a later draw", () => {
    expect(passState(event("2026-11"), "blue", view("2026-08"))).toBe("upcoming");
    expect(livePasses([event("2026-11")], "blue", blue, view("2026-08"))).toBe(0);
  });

  it("leaves gold accumulating across every month until its one draw", () => {
    const held = [event("2026-07"), event("2026-09", 10, { id: "e2" })];
    expect(ballotMonth(held[0], "gold", rules("campaign_end", "monthly"))).toBe("2026-12");
    expect(livePasses(held, "gold", gold, view("2026-10"))).toBe(20);

    const after = view("2026-12", [draw("gold", "2026-12", true)]);
    expect(livePasses(held, "gold", gold, after)).toBe(0);
  });

  it("does not let the blue draw touch gold", () => {
    const v = view("2026-07", [draw("blue", "2026-07", true)]);
    expect(livePasses([event("2026-07")], "gold", gold, v)).toBe(10);
  });

  it("honours a pass retired by hand, with no draw to explain it", () => {
    const byHand = [event("2026-07", 10, { consumedByDrawId: "adjustment-1" })];
    expect(livePasses(byHand, "blue", blue, view("2026-07"))).toBe(0);
  });

  it("switches gold to monthly with one setting and nothing else", () => {
    const everyMonth = rules("monthly", "monthly");
    const v = view("2026-08", [], everyMonth);
    expect(livePasses([event("2026-07")], "gold", gold, v)).toBe(0);
  });
});

describe("once-per-client activities", () => {
  const once = card({ oncePerClient: true, passesPerUnit: 3 });

  it("counts the first download and ignores the rest", () => {
    const twice = [
      event("2026-07", 1, { id: "e1", earnedOn: "2026-07-03" }),
      event("2026-07", 1, { id: "e2", earnedOn: "2026-07-18" }),
    ];
    expect(livePasses(twice, "blue", once, view("2026-07"))).toBe(1);
  });

  it("keeps the earliest, not whichever came first in the file", () => {
    const shuffled = [
      event("2026-07", 1, { id: "late", earnedOn: "2026-07-18", reference: "reinstall" }),
      event("2026-07", 1, { id: "early", earnedOn: "2026-07-03", reference: "install" }),
    ];
    const kept = eligibleEvents(once, shuffled);
    expect(kept).toHaveLength(1);
    expect(kept[0].reference).toBe("install");
  });

  it("caps the units, not the passes — a testimonial is still worth 3", () => {
    const twice = [
      event("2026-07", 3, { id: "e1", earnedOn: "2026-07-01" }),
      event("2026-07", 3, { id: "e2", earnedOn: "2026-07-22" }),
    ];
    expect(livePasses(twice, "blue", once, view("2026-07"))).toBe(3);
  });

  it("caps a single row that claims two units, at that row's own rate", () => {
    const overclaimed = [event("2026-07", 6, { units: 2 })];
    expect(livePasses(overclaimed, "blue", once, view("2026-07"))).toBe(3);
    expect(eligibleEvents(once, overclaimed)[0].units).toBe(1);
  });

  it("does not let a voided row hold the slot", () => {
    const events = [
      event("2026-07", 3, { id: "dead", earnedOn: "2026-07-01", status: "void" }),
      event("2026-07", 3, { id: "real", earnedOn: "2026-07-10" }),
    ];
    expect(livePasses(events, "blue", once, view("2026-07"))).toBe(3);
  });

  it("leaves repeatable activities alone", () => {
    const repeatable = card({ passesPerUnit: 5 });
    const twice = [
      event("2026-07", 5, { id: "e1", earnedOn: "2026-07-03" }),
      event("2026-07", 5, { id: "e2", earnedOn: "2026-07-18" }),
    ];
    expect(livePasses(twice, "blue", repeatable, view("2026-07"))).toBe(10);
  });

  it("caps Terry's duplicated download and testimonial in the demo data", () => {
    const blue = buildPassBlocks(seed.activities, eventsFor("cli-3"), SEED)
      .find((b) => b.passType === "blue")!;
    const byLabel = Object.fromEntries(blue.rows.map((r) => [r.activity.label, r.passes]));
    // Two rows each in the ledger; one testimonial (3) and one download (1).
    expect(byLabel["Submit A Testimonial"]).toBe(3);
    expect(byLabel["Download finConnect"]).toBe(1);
    expect(blue.total).toBe(4);
  });
});

describe("the demo dataset", () => {
  it("shows Jake all three blue states at once", () => {
    const events = eventsFor("cli-1");
    expect(livePasses(events, "gold", seed.activities, SEED)).toBe(21);
    expect(livePasses(events, "blue", seed.activities, SEED)).toBe(7);
    expect(awaitingPasses(events, "blue", seed.activities, SEED)).toBe(4);
  });

  it("breaks this month's blue passes down exactly as the statement shows", () => {
    const blue = buildPassBlocks(seed.activities, eventsFor("cli-1"), SEED)
      .find((b) => b.passType === "blue")!;
    const byLabel = Object.fromEntries(blue.rows.map((r) => [r.activity.label, r.passes]));

    expect(byLabel["Submit Referrals"]).toBe(2);
    expect(byLabel["Attend Client Events"]).toBe(5);
    // Earlier months' passes are in earlier ballots, so they read zero here.
    expect(byLabel["Bring Guests For Client Events"]).toBe(0);
    expect(blue.drawn).toBe(50);
    expect(blue.awaiting).toBe(4);
  });

  it("lists every activity, including the ones worth nothing yet", () => {
    const blocks = buildPassBlocks(seed.activities, eventsFor("cli-5"), SEED);
    const rowCount = blocks.reduce((n, b) => n + b.rows.length, 0);
    expect(rowCount).toBe(seed.activities.length);
  });

  it("keeps pending and voided passes out of the total but still reports them", () => {
    const gold = buildPassBlocks(seed.activities, eventsFor("cli-4"), SEED)
      .find((b) => b.passType === "gold")!;
    expect(gold.total).toBe(0);
    expect(gold.pending).toBe(21);
    expect(gold.voided).toBe(21);
  });
});

describe("previous passes", () => {
  const historyFor = (clientId: string) =>
    buildDrawHistory(seed.activities, eventsFor(clientId), SEED, winnersFor(clientId));

  it("shows Jake the draw he won, the one awaiting, and the ones still open", () => {
    const byState = Object.fromEntries(
      historyFor("cli-1").map((h) => [h.state, h]),
    );

    expect(byState.won.passes).toBe(50);
    expect(byState.won.prize).toBe("OSIM uJolly");
    expect(byState.won.passType).toBe("blue");
    expect(byState.awaiting.passes).toBe(4);
    expect(byState.awaiting.prize).toBeNull();
  });

  it("lists both open ballots — this month's blue and the campaign-close gold", () => {
    const open = historyFor("cli-1").filter((h) => h.state === "open");
    expect(open.map((h) => h.passType).sort()).toEqual(["blue", "gold"]);
    expect(open.find((h) => h.passType === "gold")!.passes).toBe(21);
  });

  it("marks a drawn ballot the client did not win as unsuccessful", () => {
    const entry = historyFor("cli-2").find((h) => h.state === "unsuccessful")!;
    expect(entry.passType).toBe("blue");
    expect(entry.passes).toBe(4);
    expect(entry.prize).toBeNull();
  });

  it("names where the passes came from", () => {
    const won = historyFor("cli-1").find((h) => h.state === "won")!;
    expect(won.parts).toContain("5 referrals");
    expect(won.parts).toContain("3 guests");
  });

  it("orders the newest ballot first", () => {
    const months = historyFor("cli-1").map((h) => h.drawMonth);
    expect([...months].sort().reverse()).toEqual(months);
  });

  it("leaves out pending and voided passes, which are in no ballot", () => {
    // Gina's only confirmed passes are blue; her gold is pending or voided.
    expect(historyFor("cli-4").every((h) => h.passType === "blue")).toBe(true);
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
