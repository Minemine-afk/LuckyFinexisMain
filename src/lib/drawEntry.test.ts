import { describe, expect, it } from "vitest";
import { findByMobile, normaliseMobile } from "./drawEntry";
import type { ClientRecord } from "./types";

const client = (id: string, mobile: string, fullName = `Client ${id}`): ClientRecord => ({
  id,
  externalRef: id,
  fullName,
  email: `${id}@example.com`,
  mobile,
  advisorId: "adv-1",
});

const BOOK = [
  client("cli-1", "9123 4567", "Jake Peralta"),
  client("cli-2", "98120034", "Rosa Diaz"),
  client("cli-3", "+65 9188 4420", "Terry Jeffords"),
];

describe("normalising a mobile number", () => {
  it.each([
    ["9123 4567", "91234567"],
    ["+65 9123 4567", "91234567"],
    ["6591234567", "91234567"],
    ["+65-9123-4567", "91234567"],
    [" 91234567 ", "91234567"],
  ])("reads %s as %s", (input, expected) => {
    expect(normaliseMobile(input)).toBe(expected);
  });

  it("leaves a local number starting 65 alone", () => {
    // 65123456 is a real eight-digit number, not a country code and six digits.
    expect(normaliseMobile("65123456")).toBe("65123456");
  });

  it("has nothing to say about an empty field", () => {
    expect(normaliseMobile("")).toBe("");
    expect(normaliseMobile("   ")).toBe("");
  });
});

describe("finding a client by mobile", () => {
  it("matches however the number was typed", () => {
    for (const typed of ["91234567", "9123 4567", "+65 9123 4567", "6591234567"]) {
      const m = findByMobile(BOOK, typed);
      expect(m.kind).toBe("ok");
      expect(m.kind === "ok" && m.client.fullName).toBe("Jake Peralta");
    }
  });

  it("matches a client whose stored number carries the country code", () => {
    const m = findByMobile(BOOK, "91884420");
    expect(m.kind === "ok" && m.client.id).toBe("cli-3");
  });

  it("reports a number nobody has", () => {
    expect(findByMobile(BOOK, "90000000").kind).toBe("none");
  });

  it("treats a blank field as no match rather than the first client", () => {
    expect(findByMobile(BOOK, "").kind).toBe("none");
  });

  /**
   * The case worth refusing. A shared mobile is common between spouses who are
   * both clients, and recording one person's prize against the other is worse
   * than asking which of them won.
   */
  it("refuses a number that two clients share", () => {
    const shared = [...BOOK, client("cli-9", "91234567", "Amy Santiago")];
    const m = findByMobile(shared, "9123 4567");
    expect(m.kind).toBe("ambiguous");
    expect(m.kind === "ambiguous" && m.count).toBe(2);
  });

  it("counts every client sharing the number, not just two", () => {
    const shared = [
      ...BOOK,
      client("cli-9", "91234567"),
      client("cli-10", "+65 9123 4567"),
    ];
    const m = findByMobile(shared, "91234567");
    expect(m.kind === "ambiguous" && m.count).toBe(3);
  });

  it("is not confused by clients with no number on file", () => {
    const sparse = [client("cli-7", ""), client("cli-8", "   "), ...BOOK];
    expect(findByMobile(sparse, "91234567").kind).toBe("ok");
    expect(findByMobile(sparse, "").kind).toBe("none");
  });
});
