import { beforeEach, describe, expect, it } from "vitest";
import { mockApi, resetMockLedger } from "./mockApi";
import * as seed from "./mock";

/**
 * The demo provider's draw handling.
 *
 * Worth testing rather than waving through, because recording a draw is the one
 * action in the app that spends passes — and the demo is where that behaviour is
 * shown to people before it is trusted against real clients. A demo that does
 * not spend them is demonstrating the wrong thing.
 */

const CAMPAIGN = seed.campaign.id;
/** The demo's closed-but-unrecorded blue draw — the real-world case. */
const AWAITING = seed.draws.find((d) => !d.isDrawn && d.passType === "blue")!;

const drawById = async (id: string) =>
  (await mockApi.getDraws(CAMPAIGN)).find((d) => d.id === id)!;

beforeEach(() => {
  resetMockLedger();
});

describe("who is in a draw", () => {
  it("lists every client, so a zero can be told from a stranger", async () => {
    const entrants = await mockApi.getDrawEntrants(CAMPAIGN, AWAITING.id);
    expect(entrants).toHaveLength(seed.clients.length);
  });

  it("puts the largest holdings first", async () => {
    const entrants = await mockApi.getDrawEntrants(CAMPAIGN, AWAITING.id);
    const passes = entrants.map((e) => e.passes);
    expect([...passes].sort((a, b) => b - a)).toEqual(passes);
  });

  it("refuses a draw that is not in this campaign", async () => {
    await expect(mockApi.getDrawEntrants(CAMPAIGN, "no-such-draw")).rejects.toThrow(
      /no longer exists/i,
    );
  });
});

describe("recording and undoing a draw", () => {
  const winnerOf = async () => {
    const entrants = await mockApi.getDrawEntrants(CAMPAIGN, AWAITING.id);
    return entrants.find((e) => e.passes > 0)!;
  };

  it("closes the draw and publishes the winner", async () => {
    const winner = await winnerOf();
    await mockApi.recordDraw(CAMPAIGN, AWAITING.id, [
      { clientId: winner.client.id, prize: "Dyson Airwrap" },
    ]);

    expect((await drawById(AWAITING.id)).isDrawn).toBe(true);
    const published = await mockApi.getWinners(CAMPAIGN, AWAITING.drawMonth);
    expect(published.map((w) => w.prize)).toContain("Dyson Airwrap");
  });

  it("spends the passes that were in it", async () => {
    const winner = await winnerOf();
    const advisorId = winner.client.advisorId;

    const before = await mockApi.getAdvisorClients(advisorId, CAMPAIGN);
    const awaitingBefore = before.reduce((n, r) => n + r.awaiting, 0);
    expect(awaitingBefore).toBeGreaterThan(0);

    await mockApi.recordDraw(CAMPAIGN, AWAITING.id, [
      { clientId: winner.client.id, prize: "Dyson Airwrap" },
    ]);

    const after = await mockApi.getAdvisorClients(advisorId, CAMPAIGN);
    expect(after.reduce((n, r) => n + r.awaiting, 0)).toBeLessThan(awaitingBefore);
    expect(after.find((r) => r.client.id === winner.client.id)?.won).toBe(true);
  });

  it("gives the passes back when undone", async () => {
    const winner = await winnerOf();
    const advisorId = winner.client.advisorId;
    const before = await mockApi.getAdvisorClients(advisorId, CAMPAIGN);

    await mockApi.recordDraw(CAMPAIGN, AWAITING.id, [
      { clientId: winner.client.id, prize: "Dyson Airwrap" },
    ]);
    await mockApi.undoDraw(AWAITING.id);

    expect((await drawById(AWAITING.id)).isDrawn).toBe(false);
    expect(await mockApi.getWinners(CAMPAIGN, AWAITING.drawMonth)).toHaveLength(0);

    const after = await mockApi.getAdvisorClients(advisorId, CAMPAIGN);
    expect(after.map((r) => [r.client.id, r.gold, r.blue, r.awaiting, r.won])).toEqual(
      before.map((r) => [r.client.id, r.gold, r.blue, r.awaiting, r.won]),
    );
  });

  it("replaces the winners rather than appending on a second recording", async () => {
    const entrants = (await mockApi.getDrawEntrants(CAMPAIGN, AWAITING.id)).filter(
      (e) => e.passes > 0,
    );
    await mockApi.recordDraw(CAMPAIGN, AWAITING.id, [
      { clientId: entrants[0].client.id, prize: "Dyson Airwrap" },
    ]);
    await mockApi.recordDraw(CAMPAIGN, AWAITING.id, [
      { clientId: entrants[0].client.id, prize: "Dyson Airwrap" },
    ]);

    expect(await mockApi.getWinners(CAMPAIGN, AWAITING.drawMonth)).toHaveLength(1);
  });

  it("closes a draw nobody entered, because it still ran", async () => {
    await mockApi.recordDraw(CAMPAIGN, AWAITING.id, []);
    expect((await drawById(AWAITING.id)).isDrawn).toBe(true);
  });

  it("names the winner in full, as the firm-wide page shows them", async () => {
    const winner = await winnerOf();
    await mockApi.recordDraw(CAMPAIGN, AWAITING.id, [
      { clientId: winner.client.id, prize: "Dyson Airwrap" },
    ]);
    const published = await mockApi.getWinners(CAMPAIGN, AWAITING.drawMonth);
    expect(published[0].displayName).toBe(winner.client.fullName);
  });

  it("puts a recorded draw back when the demo is reset", async () => {
    await mockApi.recordDraw(CAMPAIGN, AWAITING.id, [
      { clientId: (await winnerOf()).client.id, prize: "Dyson Airwrap" },
    ]);
    resetMockLedger();

    expect((await drawById(AWAITING.id)).isDrawn).toBe(false);
    expect(await mockApi.getWinners(CAMPAIGN, AWAITING.drawMonth)).toHaveLength(0);
  });
});
