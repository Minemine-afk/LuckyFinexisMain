import { describe, expect, it } from "vitest";
import * as seed from "../data/mock";
import { parseCsv } from "./csv";
import {
  buildPreview,
  claimKey,
  missingHeaders,
  naturalKey,
  toPassEvents,
  type IngestContext,
} from "./ingest";

const ctx = (existing: string[] = [], claimed: string[] = []): IngestContext => ({
  campaignId: seed.campaign.id,
  activities: seed.activities,
  clients: seed.clients,
  existingKeys: new Set(existing),
  claimed: new Set(claimed),
});

const preview = (csv: string, context = ctx()) => {
  const { rows, lines } = parseCsv(csv);
  return buildPreview("upload.csv", rows, lines, context);
};

const HEAD = "client_ref,activity_code,units,earned_on,reference";

describe("header validation", () => {
  it("names the columns that are missing", () => {
    expect(missingHeaders(["client_ref", "units"])).toEqual(["activity_code", "earned_on"]);
  });

  it("passes a complete header row", () => {
    expect(missingHeaders(["client_ref", "activity_code", "units", "earned_on"])).toEqual([]);
  });
});

describe("row validation", () => {
  it("accepts a good row and works out the passes", () => {
    const p = preview(`${HEAD}\nC-1001,attend_event,2,2026-09-01,Sep briefing`);
    expect(p.counts).toEqual({ insert: 1, duplicate: 0, reject: 0 });
    expect(p.rows[0].passes).toBe(10); // 2 events x 5 passes
    expect(p.rows[0].drawMonth).toBe("2026-09");
  });

  it("rejects a client reference that is not on the books", () => {
    const p = preview(`${HEAD}\nC-9999,attend_event,1,2026-09-01,x`);
    expect(p.rows[0].outcome).toBe("reject");
    expect(p.rows[0].reason).toMatch(/No client with reference/);
  });

  it("rejects an activity the campaign does not run", () => {
    const p = preview(`${HEAD}\nC-1001,ate_a_sandwich,1,2026-09-01,x`);
    expect(p.rows[0].reason).toMatch(/Unknown activity_code/);
  });

  it.each([
    ["01/09/2026", /earned_on must be YYYY-MM-DD/],
    ["2026-9-1", /earned_on must be YYYY-MM-DD/],
  ])("rejects the date %s", (date, message) => {
    const p = preview(`${HEAD}\nC-1001,attend_event,1,${date},x`);
    expect(p.rows[0].reason).toMatch(message);
  });

  it.each(["0", "-2", "1.5", "many"])("rejects units of %s", (units) => {
    const p = preview(`${HEAD}\nC-1001,attend_event,${units},2026-09-01,x`);
    expect(p.rows[0].reason).toMatch(/units must be a whole number above zero/);
  });

  it("rejects a status it does not recognise", () => {
    const p = preview(
      `${HEAD},status\nC-1001,attend_event,1,2026-09-01,x,maybe`,
    );
    expect(p.rows[0].reason).toMatch(/status must be one of/);
  });

  it("refuses to backdate a pass into a draw that already happened", () => {
    const p = preview(
      `${HEAD},draw_month\nC-1001,attend_event,1,2026-09-01,x,2026-07`,
    );
    expect(p.rows[0].reason).toMatch(/before the month the pass was earned/);
  });

  it("allows deferring a pass to a later draw", () => {
    const p = preview(
      `${HEAD},draw_month\nC-1001,attend_event,1,2026-09-01,x,2026-11`,
    );
    expect(p.rows[0].outcome).toBe("insert");
    expect(p.rows[0].drawMonth).toBe("2026-11");
  });

  it("keeps counting the remaining rows after a bad one", () => {
    const p = preview(
      `${HEAD}\nC-9999,attend_event,1,2026-09-01,x\nC-1001,attend_event,1,2026-09-02,y`,
    );
    expect(p.counts).toEqual({ insert: 1, duplicate: 0, reject: 1 });
  });
});

describe("deduplication", () => {
  const row = `C-1001,attend_event,1,2026-09-01,Sep briefing`;

  it("skips a row already in the ledger", () => {
    const key = naturalKey(seed.campaign.id, "C-1001", "attend_event", "2026-09-01", "Sep briefing");
    const p = preview(`${HEAD}\n${row}`, ctx([key]));
    expect(p.counts.duplicate).toBe(1);
    expect(p.rows[0].reason).toBe("Already in the ledger");
  });

  it("skips a row repeated inside the same file", () => {
    const p = preview(`${HEAD}\n${row}\n${row}`);
    expect(p.counts).toEqual({ insert: 1, duplicate: 1, reject: 0 });
    expect(p.rows[1].reason).toBe("Repeated earlier in this file");
  });

  it("treats two different references on the same day as two events", () => {
    const p = preview(
      `${HEAD}\nC-1001,purchase_product,1,2026-09-01,POL-1\nC-1001,purchase_product,1,2026-09-01,POL-2`,
    );
    expect(p.counts.insert).toBe(2);
  });

  it("ignores case and padding when matching a row it has seen", () => {
    const key = naturalKey(seed.campaign.id, "c-1001", "attend_event", "2026-09-01", "sep briefing");
    const p = preview(`${HEAD}\n${row}`, ctx([key]));
    expect(p.counts.duplicate).toBe(1);
  });
});

describe("committing a preview", () => {
  it("turns only the accepted rows into ledger entries", () => {
    const context = ctx();
    const p = preview(
      `${HEAD}\nC-1001,attend_event,2,2026-09-01,Sep\nC-9999,attend_event,1,2026-09-01,bad`,
      context,
    );
    const events = toPassEvents(p, context, "test");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      clientId: "cli-1",
      activityId: "act-blue-event",
      units: 2,
      passes: 10,
      earnedOn: "2026-09-01",
      drawMonth: "2026-09",
      status: "valid",
      consumedByDrawId: null,
    });
  });

  it("stores the reference exactly as written, commas and capitals intact", () => {
    const context = ctx();
    const p = preview(`${HEAD}\nC-1001,attend_event,1,2026-09-01,"Boyle, Charles"`, context);
    const events = toPassEvents(p, context, "test");
    expect(events[0].reference).toBe("Boyle, Charles");
    // ...even though the key used to spot a duplicate is case-folded.
    expect(p.rows[0].naturalKey).toContain("boyle, charles");
  });
});

describe("once-per-client activities", () => {
  it("takes only the first of two downloads in the same file", () => {
    const p = preview(
      `${HEAD}\n` +
        `C-1001,finconnect,1,2026-09-03,install\n` +
        `C-1001,finconnect,1,2026-09-18,reinstall`,
    );
    expect(p.rows[0].outcome).toBe("insert");
    expect(p.rows[1].outcome).toBe("duplicate");
    expect(p.rows[1].reason).toMatch(/once per client/);
  });

  it("turns one away when the client already has it in the ledger", () => {
    const context = ctx([], [claimKey("C-1001", "finconnect")]);
    const p = preview(`${HEAD}\nC-1001,finconnect,1,2026-09-18,reinstall`, context);
    expect(p.rows[0].outcome).toBe("duplicate");
    expect(toPassEvents(p, context, "t")).toHaveLength(0);
  });

  it("does not let one client's claim block another's", () => {
    const context = ctx([], [claimKey("C-1001", "finconnect")]);
    const p = preview(`${HEAD}\nC-1002,finconnect,1,2026-09-18,install`, context);
    expect(p.rows[0].outcome).toBe("insert");
  });

  it("caps the testimonial too, and it is still worth 3 passes", () => {
    const p = preview(
      `${HEAD}\n` +
        `C-1001,testimonial,1,2026-09-01,first\n` +
        `C-1001,testimonial,1,2026-09-22,again`,
    );
    expect(p.rows[0].outcome).toBe("insert");
    expect(p.rows[0].passes).toBe(3);
    expect(p.rows[1].outcome).toBe("duplicate");
  });

  it("leaves repeatable activities alone", () => {
    const p = preview(
      `${HEAD}\n` +
        `C-1001,attend_event,1,2026-09-03,Briefing\n` +
        `C-1001,attend_event,1,2026-09-18,Clinic`,
    );
    expect(p.rows.map((r) => r.outcome)).toEqual(["insert", "insert"]);
  });

  it("prefers the more precise reason when the very same row is re-uploaded", () => {
    const key = naturalKey(seed.campaign.id, "C-1001", "finconnect", "2026-09-03", "install");
    const context = ctx([key], [claimKey("C-1001", "finconnect")]);
    const p = preview(`${HEAD}\nC-1001,finconnect,1,2026-09-03,install`, context);
    expect(p.rows[0].reason).toBe("Already in the ledger");
  });

  it("does not let a voided row hold the slot", () => {
    const p = preview(
      `${HEAD},status\n` +
        `C-1001,finconnect,1,2026-09-03,install,void\n` +
        `C-1001,finconnect,1,2026-09-18,reinstall,valid`,
    );
    expect(p.rows[1].outcome).toBe("insert");
  });
});
