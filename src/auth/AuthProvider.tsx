import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../data";
import type { Viewer } from "../lib/types";

interface AuthState {
  viewer: Viewer | null;
  /** True until the initial session lookup finishes, so guards do not bounce. */
  loading: boolean;
  /**
   * True when a session ended by itself rather than by the user signing out, so
   * the login page can say why they are back on it.
   */
  sessionEnded: boolean;
  signIn(email: string, password: string): Promise<Viewer>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);
  // Read inside the subscription without making it a dependency, so the
  // listener is registered once rather than torn down on every sign-in.
  const hadViewer = useRef(false);
  hadViewer.current = viewer !== null;

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
        // `currentViewer` has already ended that session.
        if (!cancelled) setViewer(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The session can end without the app doing anything: a token expires, a
   * refresh fails, an administrator revokes access, or the user signs out in
   * another tab. Checking only at page load meant the UI stayed signed in and
   * every query quietly returned nothing — which renders as "no clients yet"
   * rather than as a session that needs renewing.
   */
  useEffect(() => {
    return api.onSessionChange((next) => {
      if (next === null && hadViewer.current) setSessionEnded(true);
      setViewer(next);
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const next = await api.signIn(email, password);
    setSessionEnded(false);
    setViewer(next);
    return next;
  }, []);

  const signOut = useCallback(async () => {
    // The local session is cleared whatever the server says. A sign-out that
    // failed on a network error would otherwise leave someone signed in on a
    // machine they are trying to walk away from.
    try {
      await api.signOut();
    } finally {
      // Deliberate, so the login page should not claim the session expired.
      setSessionEnded(false);
      setViewer(null);
    }
  }, []);

  const value = useMemo(
    () => ({ viewer, loading, sessionEnded, signIn, signOut }),
    [viewer, loading, sessionEnded, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>.");
  return ctx;
}
