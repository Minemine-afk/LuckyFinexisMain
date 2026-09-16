import { Alert, EmptyState, Loading } from "../components/Loading";
import { api } from "../data";
import { monthAndYear, passTypeLabel } from "../lib/format";
import { useAsync, useRefreshOnFocus } from "../lib/useAsync";
import type { DrawWinner } from "../lib/types";

/**
 * Past winners, month by month, across the whole firm.
 *
 * Firm-wide rather than one consultant's own, because a campaign is a firm-wide
 * thing and a page showing a consultant nothing most months would not be worth
 * opening. What keeps that from being a client list handed to a competitor is
 * row level security: a consultant's own clients come back named, and everyone
 * else's arrive without a name and are rendered as "A client".
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

      {/* Precisely what the code does, not what would sound reassuring.
          `getWinners` shortens every name it can read, including your own
          clients', and a client belonging to another consultant comes back with
          no name at all because row level security withheld the row. */}
      {months.length > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 14 }}>
          Every winner is listed by first name and last initial, because this page is
          visible to every consultant in the firm. A winner shown as "A client" belongs
          to another consultant, whose client list you are not able to see.
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
            <th scope="col">Pass Type</th>
          </tr>
        </thead>
        <tbody>
          {winners.map((w) => (
            <tr key={w.id}>
              <td className="name" data-label="Winner">{w.displayName}</td>
              <td data-label="Prize">{w.prize}</td>
              <td data-label="Pass Type">
                <span className={`badge ${w.passType}`}>{passTypeLabel(w.passType)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
