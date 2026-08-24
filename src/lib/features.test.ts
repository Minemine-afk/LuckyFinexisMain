import { describe, expect, it } from "vitest";
import { clientPortalEnabled } from "./features";

describe("client portal gate", () => {
  it("is closed against a real backend by default", () => {
    // The case that matters: a live Supabase project whose RLS policies do not
    // yet let a client read their own passes. Opening here shows them zeros.
    expect(clientPortalEnabled(false, undefined)).toBe(false);
    expect(clientPortalEnabled(false, "")).toBe(false);
    expect(clientPortalEnabled(false, "false")).toBe(false);
  });

  it("opens only on an explicit true, not on any truthy string", () => {
    expect(clientPortalEnabled(false, "true")).toBe(true);
    expect(clientPortalEnabled(false, "yes")).toBe(false);
    expect(clientPortalEnabled(false, "1")).toBe(false);
  });

  it("stays open on demo data, which has no policies to be blocked by", () => {
    expect(clientPortalEnabled(true, undefined)).toBe(true);
    expect(clientPortalEnabled(true, "false")).toBe(true);
  });
});
