import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../data";
import type { Viewer } from "../lib/types";

interface AuthState {
  viewer: Viewer | null;
  /** True until the initial session lookup finishes, so guards do not bounce. */
  loading: boolean;
  signIn(email: string, password: string): Promise<Viewer>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .currentViewer()
      .then((v) => {
        if (!cancelled) setViewer(v);
      })
      .catch(() => {
        // A session that cannot be resolved to a profile is treated as signed
        // out rather than as an error the user has to read on first paint.
        if (!cancelled) setViewer(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const next = await api.signIn(email, password);
    setViewer(next);
    return next;
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut();
    setViewer(null);
  }, []);

  const value = useMemo(
    () => ({ viewer, loading, signIn, signOut }),
    [viewer, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>.");
  return ctx;
}

/** Where each role lands after signing in. */
export const homePathFor = (viewer: Viewer): string =>
  viewer.role === "advisor" ? "/clients" : "/admin";
