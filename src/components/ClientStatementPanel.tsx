import { useState } from "react";
import { activityRule, monthAndYear, monthName, passTypeLabel, shortDate } from "../lib/format";
import { buildDrawHistory, buildPassBlocks, passView } from "../lib/passes";
import type { Activity, Campaign, ClientStatement, Draw } from "../lib/types";

/**
 * The client's boarding pass statement: one table per pass type listing every
 * qualifying activity and what it has earned, then any prizes won.
 *
 * The totals are the ballot now collecting, and nothing else. A pass belongs to
 * the draw for the month it was earned and is used up by it, so last month's
 * passes are not in this month's number — whether or not that draw has been run
 * yet. That is the figure most likely to surprise a client, so everything
 * missing from it is named directly beneath the table rather than left to be
 * discovered, and Previous Passes accounts for every pass month by month.
 */
export function ClientStatementPanel({
  campaign,
  activities,
  draws,
  statement,
  showHeading = true,
}: {
  campaign: Campaign;
  activities: Activity[];
  draws: Draw[];
  statement: ClientStatement;
  showHeading?: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  const view = passView(campaign, draws);
  const blocks = buildPassBlocks(activities, statement.events, view);
  const { winners } = statement;
  const history = buildDrawHistory(activities, statement.events, view, winners);

  return (
    <div className="statement">
      {showHeading && (
        <div className="statement-head">
          <h2>{campaign.name}</h2>
          <div className="who">Name: {statement.client.fullName}</div>
        </div>
      )}

      {blocks.map((block) => (
        <section className="block" key={block.passType}>
          <h3 className={`block-title ${block.passType}-title`}>
            Total {passTypeLabel(block.passType)} Boarding Passes:{" "}
            <span className="total">{block.total}</span>
          </h3>

          <div className="tablewrap">
            <table className="ptable">
              <thead>
                <tr>
                  <th scope="col">Qualifying Activity</th>
                  <th scope="col" className="num">
                    No. Of Passes
                  </th>
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row) => (
                  <tr key={row.activity.id}>
                    <td className="name">
                      {row.activity.label} ({activityRule(row.activity)})
                    </td>
                    <td className={`num${row.passes === 0 ? " zero" : ""}`}>{row.passes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Only shown when there is something to explain, so a clean account
              reads exactly like the mockup. Spent passes are named rather than
              quietly dropped — a client who remembers earning them deserves to
              see where they went. */}
          {(block.pending > 0 || block.voided > 0 || block.drawn > 0 ||
            block.awaiting > 0 || block.upcoming > 0) && (
            <p className="block-note">
              {block.drawn > 0 && (
                <>
                  {block.drawn} {passTypeLabel(block.passType).toLowerCase()}{" "}
                  {block.drawn === 1 ? "pass has" : "passes have"} already been
                  entered into a draw and used up.{" "}
                </>
              )}
              {/* The month is deliberately not named here: awaiting passes can
                  span more than one closed draw. Previous Passes has them
                  month by month. */}
              {block.awaiting > 0 && (
                <>
                  {block.awaiting} {passTypeLabel(block.passType).toLowerCase()}{" "}
                  {block.awaiting === 1 ? "pass is" : "passes are"} in a closed draw,
                  awaiting the result.{" "}
                </>
              )}
              {block.upcoming > 0 && (
                <>
                  {block.upcoming} {block.upcoming === 1 ? "pass enters" : "passes enter"} a
                  later draw.{" "}
                </>
              )}
              {block.pending > 0 && (
                <>
                  {block.pending} {passTypeLabel(block.passType).toLowerCase()}{" "}
                  {block.pending === 1 ? "pass is" : "passes are"} pending confirmation and
                  not yet in the draw.{" "}
                </>
              )}
              {block.voided > 0 && (
                <>
                  {block.voided} {block.voided === 1 ? "pass was" : "passes were"} withdrawn.
                </>
              )}
            </p>
          )}
        </section>
      ))}

      {/* The prizes table appears only when the client has actually won
          something — an empty prizes table reads as a loss. */}
      {winners.length > 0 && (
        <section className="block">
          <h3 className="block-title">Prizes Won</h3>
          <div className="tablewrap">
            <table className="ptable">
              <thead>
                <tr>
                  <th scope="col">Monthly Draw</th>
                  <th scope="col">Prize</th>
                  <th scope="col">Pass Type</th>
                </tr>
              </thead>
              <tbody>
                {[...winners]
                  .sort((a, b) => a.drawMonth.localeCompare(b.drawMonth))
                  .map((w) => (
                    <tr key={w.id}>
                      <td className="name">{monthName(w.drawMonth)}</td>
                      <td>{w.prize}</td>
                      <td>
                        <span className={`badge ${w.passType}`}>
                          {passTypeLabel(w.passType)}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Folded away by default: the tables above are the account as it stands,
          and history is what you go looking for once the total surprises you. */}
      {history.length > 0 && (
        <section className="block">
          <button
            type="button"
            className="disclosure"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <span className="caret" aria-hidden="true">
              {historyOpen ? "▾" : "▸"}
            </span>
            Previous Passes
          </button>

          {historyOpen && (
            <div className="tablewrap">
              {/* Stacked into cards on a narrow screen: the outcome is the whole
                  point of this table, and it is the last column, so it would be
                  the first thing scrolled off. */}
              <table className="ptable stack">
                <thead>
                  <tr>
                    <th scope="col">Draw</th>
                    <th scope="col">Earned From</th>
                    <th scope="col" className="num">
                      Passes Entered
                    </th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr
                      key={`${entry.passType}-${entry.drawMonth}`}
                      className={entry.state === "won" ? "won-row" : undefined}
                    >
                      <td className="name hist-draw" data-label="Draw">
                        {monthAndYear(entry.drawMonth)}{" "}
                        <span className={`badge ${entry.passType}`}>
                          {passTypeLabel(entry.passType)}
                        </span>
                      </td>
                      <td data-label="Earned from">{entry.parts.join(", ") || "—"}</td>
                      <td className="num" data-label="Passes entered">
                        {entry.passes}
                      </td>
                      <td data-label="Outcome">
                        {entry.state === "won" && (
                          <span className="outcome won">Won — {entry.prize}</span>
                        )}
                        {entry.state === "unsuccessful" && (
                          <span className="outcome unsuccessful">Unsuccessful</span>
                        )}
                        {entry.state === "awaiting" && (
                          <span className="outcome awaiting">Awaiting result</span>
                        )}
                        {entry.state === "open" && (
                          <span className="outcome open">In the draw</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="block-note">
                Passes go into the draw for the month they were earned and are used
                up by it, win or not — they are never carried into the next month.
                Only the ones marked <b>in the draw</b> are counted in the totals
                above.
              </p>
            </div>
          )}
        </section>
      )}

      <p className="statement-foot">Updated as of {shortDate(campaign.dataAsOf)}</p>
    </div>
  );
}
