import { Alert, EmptyState, Loading } from "../components/Loading";
import { api } from "../data";
import { monthAndYear } from "../lib/format";
import { useAsync, useRefreshOnFocus } from "../lib/useAsync";
import type { DrawWinner } from "../lib/types";

/**
 * Past winners, month by month, across the whole firm.
 *
 * Firm-wide and fully named: a campaign is a firm-wide thing, and a page showing
 * a consultant nothing most months would not be worth opening.
 *
 * The names come from `prizes_won.winner_name`, written when the draw is
 * recorded, not from a join onto `clients`. That is what lets every winner be
 * named without opening the client book: a consultant reading another's winner
 * gets a name and a prize and no route to anything else. It also makes the list
 * a record of what was announced rather than a live lookup — a client renamed
 * next year does not rewrite a result the firm has already published.
 *
 * Only draws that have actually been run appear. A prize recorded against a draw
 * still open is invisible here and everywhere else, which is what makes the
 * admin screen's two writes safe in either order.
 */
export function WinnersPage() {
  const page = useAsync(async () => {
    const campaign = await api.getCampaign();
    const draws = await api.getDraws(campaign.id);

    // Newest first: the month someone is looking for is almost always the one
    // that has just been drawn. Gold and blue are separate rows that can share a
    // month, so the months are de-duplicated before fetching.
    const months = [
      ...new Set(draws.filter((d) => d.isDrawn).map((d) => d.drawMonth)),
    ].sort((a, b) => b.localeCompare(a));

    const byMonth = await Promise.all(
      months.map(async (month) => ({
        month,
        winners: await api.getWinners(campaign.id, month),
      })),
    );

    // A month whose draw was run but had no winners recorded is not worth a
    // card of its own — it would read as a mistake rather than as information.
    return { campaign, months: byMonth.filter((m) => m.winners.length > 0) };
  }, []);

  useRefreshOnFocus(page.reload);

  if (page.loading) return <Loading label="Loading past winners…" />;
  if (page.error) return <div className="page"><Alert kind="err">{page.error}</Alert></div>;
  if (!page.data) return null;

  const { campaign, months } = page.data;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Past winners</h1>
        <p className="sub">
          Every draw that has been run in {campaign.name}, newest first.
        </p>
      </header>

      {months.length === 0 && (
        <EmptyState title="No draws have been run yet">
          Winners appear here as soon as a monthly draw is recorded. Until then, every
          pass entered is still waiting on a result.
        </EmptyState>
      )}

      {months.map(({ month, winners }) => (
        <div className="card" key={month} style={{ marginTop: 18 }}>
          <div className="card-pad">
            <h2 style={{ fontSize: 17, marginBottom: 4 }}>{monthAndYear(month)}</h2>
            <p style={{ color: "var(--ink-2)", marginTop: 0 }}>
              {winners.length} {winners.length === 1 ? "winner" : "winners"}
            </p>
            <WinnerTable winners={winners} />
          </div>
        </div>
      ))}

      {months.length > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 14 }}>
          This page lists every winner in the firm, not only your own clients.
        </p>
      )}
    </div>
  );
}

function WinnerTable({ winners }: { winners: DrawWinner[] }) {
  return (
    <div className="tablewrap">
      <table className="ptable stack">
        <thead>
          <tr>
            <th scope="col">Winner</th>
            <th scope="col">Prize</th>
          </tr>
        </thead>
        <tbody>
          {winners.map((w) => (
            <tr key={w.id}>
              <td className="name" data-label="Winner">{w.displayName}</td>
              <td data-label="Prize">{w.prize}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
