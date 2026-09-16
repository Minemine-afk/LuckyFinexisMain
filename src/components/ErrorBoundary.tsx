import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches a render-time exception and shows something instead of nothing.
 *
 * Without one, React unmounts the whole tree on an unhandled error and leaves a
 * blank white page — no message, no way back, and nothing to tell a consultant
 * whether the problem is theirs or ours.
 *
 * A class, because React still has no hook equivalent for this.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The only place this goes today. When an error tracker is wired up, this
    // is the one line that changes — and until then, a support call is the
    // first anyone hears about a crash.
    console.error("[render] unhandled error:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="page">
        <div className="crashed card">
          <div className="card-pad">
            <h1>Something went wrong on this page</h1>
            <p>
              The rest of the portal is still working — use the menu on the left to go
              somewhere else, or try this page again. Nothing you have done has been lost,
              and no pass counts have been changed.
            </p>

            <div className="crashed-actions">
              <button
                className="btn"
                type="button"
                onClick={() => this.setState({ error: null })}
              >
                Try again
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => window.location.reload()}
              >
                Reload the page
              </button>
            </div>

            {/* The name and message only. A stack can carry more than it should,
                and the console already has the whole thing for whoever is
                debugging. This is here so a consultant can paste one line into
                a support message rather than describe a blank screen. */}
            <details className="crashed-detail">
              <summary>Technical detail</summary>
              <code>
                {error.name}: {error.message}
              </code>
            </details>
          </div>
        </div>
      </div>
    );
  }
}
