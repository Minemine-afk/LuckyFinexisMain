import { useCallback, useEffect, useRef, useState } from "react";

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Run an async loader and keep its result, error and in-flight state together.
 *
 * Results are dropped if the inputs changed while the request was in the air,
 * so switching quickly between clients cannot leave the previous client's
 * statement on screen.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    const ticket = ++run.current;
    setLoading(true);
    setError(null);

    loader()
      .then((result) => {
        if (run.current === ticket) setData(result);
      })
      .catch((err: unknown) => {
        if (run.current !== ticket) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Something went wrong.");
      })
      .finally(() => {
        if (run.current === ticket) setLoading(false);
      });
    // The loader closure changes on every render; `deps` is the real input list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

/**
 * Re-run a loader when the tab comes back to the foreground.
 *
 * A consultant leaves the portal open on a second monitor for a day at a time.
 * Without this, the pass counts on screen are whatever the database held when
 * the page was first opened — and a stale pass count is the one thing this page
 * must not show, because it is read out to clients.
 *
 * Throttled, so alt-tabbing repeatedly does not hammer the database.
 */
export function useRefreshOnFocus(reload: () => void, minIntervalMs = 30_000): void {
  const last = useRef(Date.now());

  useEffect(() => {
    const maybe = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last.current < minIntervalMs) return;
      last.current = now;
      reload();
    };

    window.addEventListener("focus", maybe);
    document.addEventListener("visibilitychange", maybe);
    return () => {
      window.removeEventListener("focus", maybe);
      document.removeEventListener("visibilitychange", maybe);
    };
  }, [reload, minIntervalMs]);
}
