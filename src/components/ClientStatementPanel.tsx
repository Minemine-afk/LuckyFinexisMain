import { activityRule, monthName, passTypeLabel, shortDate } from "../lib/format";
import { buildPassBlocks, currentDrawMonth } from "../lib/passes";
import type { Activity, Campaign, ClientStatement } from "../lib/types";

/**
 * The client's boarding pass statement: one table per pass type listing every
 * qualifying activity and what it has earned, then any prizes won.
 *
 * The same panel is what a client sees on their own page and what an advisor
 * gets behind the magnifier icon, so there is exactly one description of how a
 * client's passes add up.
 */
export function ClientStatementPanel({
  campaign,
  activities,
  statement,
  showHeading = true,
}: {
  campaign: Campaign;
  activities: Activity[];
  statement: ClientStatement;
  showHeading?: boolean;
}) {
  const drawMonth = currentDrawMonth(campaign);
  const blocks = buildPassBlocks(activities, statement.events, campaign, drawMonth);
  const { winners } = statement;

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
          <h3 className="block-title">
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
              reads exactly like the mockup. Expired passes are named rather than
              quietly dropped — a client who remembers earning them deserves to
              see where they went. */}
          {(block.pending > 0 || block.voided > 0 || block.expired > 0 ||
            block.upcoming > 0) && (
            <p className="block-note">
              {block.expired > 0 && (
                <>
                  {block.expired} {passTypeLabel(block.passType).toLowerCase()}{" "}
                  {block.expired === 1 ? "pass entered an earlier draw" : "passes entered earlier draws"}{" "}
                  and {block.expired === 1 ? "has" : "have"} now expired.{" "}
                </>
              )}
              {block.pending > 0 && (
                <>
                  {block.pending} {passTypeLabel(block.passType).toLowerCase()}{" "}
                  {block.pending === 1 ? "pass is" : "passes are"} pending confirmation and
                  not yet in the draw.{" "}
                </>
              )}
              {block.upcoming > 0 && (
                <>
                  {block.upcoming} {block.upcoming === 1 ? "pass enters" : "passes enter"} a
                  later draw.{" "}
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

      <p className="statement-foot">Updated as of {shortDate(campaign.dataAsOf)}</p>
    </div>
  );
}
