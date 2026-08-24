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
