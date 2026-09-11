import { useState } from "react";
import { activityRule, monthAndYear, monthName, passTypeLabel, shortDate } from "../lib/format";
import { buildDrawHistory, buildPassBlocks, drawnKeys } from "../lib/passes";
import type { Activity, Campaign, ClientStatement, Draw } from "../lib/types";

/**
 * The client's boarding pass statement: one table per pass type listing every
 * qualifying activity and what it has earned, then any prizes won.
 *
 * The counts are live passes only — a pass is used up by the draw it enters, so
 * anything already drawn for has gone. That is the number most likely to
 * surprise a client, so the passes they have spent are named directly beneath
 * the table rather than left to be discovered, and Previous Passes shows where
 * every one of them went.
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

  const drawn = drawnKeys(draws);
  const blocks = buildPassBlocks(activities, statement.events, campaign, drawn);
  const { winners } = statement;
  const history = buildDrawHistory(
    activities,
    statement.events,
    campaign,
    drawn,
    winners,
  );

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
          {(block.pending > 0 || block.voided > 0 || block.spent > 0) && (
            <p className="block-note">
              {block.spent > 0 && (
                <>
                  {block.spent} {passTypeLabel(block.passType).toLowerCase()}{" "}
                  {block.spent === 1 ? "pass has" : "passes have"} already been
                  entered into a draw and used up.{" "}
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
                        {entry.state === "spent" && (
                          <span className="outcome spent">Not drawn — passes used</span>
                        )}
                        {entry.state === "open" && (
                          <span className="outcome open">Still in the draw</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="block-note">
                Every pass entered into a draw is used up by it, whether or not it
                wins. Passes marked <b>still in the draw</b> are the ones counted
                in the totals above.
              </p>
            </div>
          )}
        </section>
      )}

      <p className="statement-foot">Updated as of {shortDate(campaign.dataAsOf)}</p>
    </div>
  );
}
