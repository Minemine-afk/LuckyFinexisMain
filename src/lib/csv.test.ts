import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("reads a plain file", () => {
    const { headers, rows } = parseCsv("client_ref,units\nC-1001,2\nC-1002,3\n");
    expect(headers).toEqual(["client_ref", "units"]);
    expect(rows).toEqual([
      { client_ref: "C-1001", units: "2" },
      { client_ref: "C-1002", units: "3" },
    ]);
  });

  it("keeps a comma inside a quoted field where it belongs", () => {
    const { rows } = parseCsv('client_ref,reference\nC-1001,"Boyle, Charles"\n');
    expect(rows[0].reference).toBe("Boyle, Charles");
  });

  it("handles escaped quotes and embedded newlines", () => {
    const { rows } = parseCsv('a,b\n"say ""hi""","line1\nline2"\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].a).toBe('say "hi"');
    expect(rows[0].b).toBe("line1\nline2");
  });

  it("normalises header spelling so exports from different tools line up", () => {
    const { headers } = parseCsv("Client Ref,Activity-Code\nC-1,x\n");
    expect(headers).toEqual(["client_ref", "activity_code"]);
  });

  it("tolerates CRLF line endings and a trailing blank line", () => {
    const { rows } = parseCsv("a,b\r\n1,2\r\n\r\n");
    expect(rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("reports the source line of each row for error messages", () => {
    const { lines } = parseCsv('a\n1\n"two\nlines"\n3\n');
    expect(lines).toEqual([2, 3, 5]);
  });

  it("returns nothing for an empty file rather than throwing", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [], lines: [] });
  });
});
