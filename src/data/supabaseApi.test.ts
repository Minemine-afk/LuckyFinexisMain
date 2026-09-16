import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Session handling in the Supabase provider.
 *
 * The thing worth pinning down here is that a session never outlives a failed
 * resolution. `signInWithPassword` writes a session to browser storage before
 * anything knows whether the account maps to a consultant, so every path that
 * refuses a user has to end that session too — otherwise the app says "signed
 * out" while a live, auto-refreshing token sits in localStorage.
 */

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const auth = {
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
  };
  return {
    maybeSingle,
    auth,
    client: {
      auth,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    },
  };
});

vi.mock("../lib/supabase", () => ({
  supabase: () => mocks.client,
  USE_MOCK: false,
  MOCK_REASON: null,
}));

import { supabaseApi } from "./supabaseApi";

const user = (over: Record<string, unknown> = {}) => ({
  id: "auth-user-1",
  email: "amy@finexis.example",
  app_metadata: {},
  ...over,
});

/** The `advisors` lookup inside `resolveViewer`. */
const advisorRow = (data: unknown) => mocks.maybeSingle.mockResolvedValue({ data, error: null });
const noAdvisorRow = () => mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.signOut.mockResolvedValue({ error: null });
});

describe("signing in", () => {
  beforeEach(() => {
    mocks.auth.signInWithPassword.mockResolvedValue({ data: { user: user() }, error: null });
  });

  it("returns the consultant when the account resolves", async () => {
    advisorRow({ id: "adv-1", fc_name: "Amy Santiago" });
    const viewer = await supabaseApi.signIn("amy@finexis.example", "pw");

    expect(viewer).toMatchObject({ role: "advisor", advisorId: "adv-1", fullName: "Amy Santiago" });
    expect(mocks.auth.signOut).not.toHaveBeenCalled();
  });

  it("ends the session when no consultant record is linked", async () => {
    noAdvisorRow();
    await expect(supabaseApi.signIn("amy@finexis.example", "pw")).rejects.toThrow(
      /No consultant record/,
    );
    // The whole point: the password was right, so a session now exists.
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("ends the session when the advisors table cannot be read", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(supabaseApi.signIn("amy@finexis.example", "pw")).rejects.toThrow(
      /Could not read the advisors table/,
    );
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("reports the original reason even if signing out then fails", async () => {
    noAdvisorRow();
    mocks.auth.signOut.mockRejectedValue(new Error("network down"));
    await expect(supabaseApi.signIn("amy@finexis.example", "pw")).rejects.toThrow(
      /No consultant record/,
    );
  });

  it("admits an admin on app_metadata alone, with no advisor row", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({
      data: { user: user({ app_metadata: { role: "admin" } }) },
      error: null,
    });
    noAdvisorRow();

    const viewer = await supabaseApi.signIn("holt@finexis.example", "pw");
    expect(viewer.role).toBe("admin");
    expect(mocks.auth.signOut).not.toHaveBeenCalled();
  });

  it("does not try to end a session that was never created", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials", status: 400 },
    });
    await expect(supabaseApi.signIn("amy@finexis.example", "nope")).rejects.toThrow(
      /Invalid login credentials/,
    );
    expect(mocks.auth.signOut).not.toHaveBeenCalled();
  });
});

describe("resuming a session on page load", () => {
  it("returns null when there is no session, without signing anything out", async () => {
    mocks.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    expect(await supabaseApi.currentViewer()).toBeNull();
    expect(mocks.auth.signOut).not.toHaveBeenCalled();
  });

  it("ends a stored session that no longer resolves", async () => {
    mocks.auth.getSession.mockResolvedValue({ data: { session: { user: user() } }, error: null });
    noAdvisorRow();

    await expect(supabaseApi.currentViewer()).rejects.toThrow(/No consultant record/);
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an unreadable session from no session at all", async () => {
    mocks.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { message: "storage unavailable" },
    });
    await expect(supabaseApi.currentViewer()).rejects.toThrow(/Could not read your session/);
  });
});

describe("watching the session", () => {
  let fire: (event: string, session: unknown) => void;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    mocks.auth.onAuthStateChange.mockImplementation((cb: typeof fire) => {
      fire = cb;
      return { data: { subscription: { unsubscribe } } };
    });
  });

  it("reports a signed-out session", () => {
    const handler = vi.fn();
    supabaseApi.onSessionChange(handler);

    fire("SIGNED_OUT", null);
    expect(handler).toHaveBeenCalledWith(null);
  });

  it("reports a session that has vanished under any event", () => {
    const handler = vi.fn();
    supabaseApi.onSessionChange(handler);

    fire("TOKEN_REFRESHED", null);
    expect(handler).toHaveBeenCalledWith(null);
  });

  it("leaves sign-in to whoever called signIn, so the two cannot race", () => {
    const handler = vi.fn();
    supabaseApi.onSessionChange(handler);

    fire("SIGNED_IN", { user: user() });
    expect(handler).not.toHaveBeenCalled();
  });

  it("re-checks the account on a token refresh and passes the viewer on", async () => {
    advisorRow({ id: "adv-1", fc_name: "Amy Santiago" });
    const handler = vi.fn();
    supabaseApi.onSessionChange(handler);

    fire("TOKEN_REFRESHED", { user: user() });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(handler.mock.calls[0][0]).toMatchObject({ advisorId: "adv-1" });
  });

  it("ends the session when a refresh finds the account no longer resolves", async () => {
    noAdvisorRow();
    const handler = vi.fn();
    supabaseApi.onSessionChange(handler);

    fire("TOKEN_REFRESHED", { user: user() });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(null));
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("stops listening when unsubscribed", () => {
    supabaseApi.onSessionChange(vi.fn())();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
