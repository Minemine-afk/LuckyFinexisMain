import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { CampaignDetailsModal } from "../components/CampaignDetailsModal";
import { ClientStatementPanel } from "../components/ClientStatementPanel";
import { RefreshIcon, SearchIcon } from "../components/Icons";
import { Alert, EmptyState, Loading } from "../components/Loading";
import { Modal } from "../components/Modal";
import { api } from "../data";
import { formatMobile, monthAndYear, monthName, shortDate } from "../lib/format";
import { ballotFor, passView } from "../lib/passes";
import { useAsync, useRefreshOnFocus } from "../lib/useAsync";
import type { ClientStatement } from "../lib/types";

/**
 * The consultant's view: every client of theirs holding passes, and the full
 * breakdown of how each one earned them.
 *
 * A consultant with no qualifying clients still gets this page, with an empty
 * table rather than an error — being at zero is a normal state early in a
 * campaign, not a fault.
 */
export function AdvisorPage() {
  const { viewer } = useAuth();
  const navigate = useNavigate();
  const advisorId = viewer?.advisorId ?? "";

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [openClientId, setOpenClientId] = useState<string | null>(null);

  const page = useAsync(async () => {
    const campaign = await api.getCampaign();
    const [activities, clients, draws] = await Promise.all([
      api.getActivities(campaign.id),
      api.getAdvisorClients(advisorId, campaign.id),
      api.getDraws(campaign.id),
    ]);
    return { campaign, activities, clients, draws };
  }, [advisorId]);

  const statement = useAsync<ClientStatement | null>(async () => {
    if (!openClientId || !page.data) return null;
    return api.getClientStatement(openClientId, page.data.campaign.id);
  }, [openClientId, page.data?.campaign.id]);

  // Pass counts get read out to clients, so the page should not be showing
  // whatever the database held when it was opened this morning.
  useRefreshOnFocus(page.reload);

  if (page.loading) return <Loading label="Loading your clients…" />;
  if (page.error) return <div className="page"><Alert kind="err">{page.error}</Alert></div>;
  if (!page.data) return null;

  const { campaign, activities, clients, draws } = page.data;
  const view = passView(campaign, draws);
  const drawMonth = view.currentMonth;

  // One chip per month that has actually been drawn. Gold and blue are separate
  // rows and can fall in the same month, so the months are de-duplicated.
  const drawnMonths = [
    ...new Set(draws.filter((d) => d.isDrawn).map((d) => d.drawMonth)),
  ].sort();

  // Where gold is actually going. Not the earliest gold draw on the calendar —
  // a campaign with a gold draw every month still pools all of it into the last
  // one, and naming July's would tell a consultant the opposite of the truth.
  const goldBallot = ballotFor("gold", view);

  // Passes across the book sitting in a closed draw with no result recorded. In
  // the days after a month turns this is why the blue column has collapsed, and
  // a consultant should not have to open five statements to find that out.
  const awaiting = clients.reduce((n, row) => n + row.awaiting, 0);
  const awaitingMonths = draws
    .filter((d) => !d.isDrawn && d.drawMonth < drawMonth)
    .map((d) => monthName(d.drawMonth));

  return (
    <div className="page">
      <header className="page-head">
        <h1>{campaign.name}</h1>
        <p className="sub">
          <button type="button" className="linkish" onClick={() => setDetailsOpen(true)}>
            Click here
          </button>{" "}
          for campaign details.
        </p>
      </header>

      {drawnMonths.length > 0 && (
        <div className="toolbar">
          <span className="label">View past winners:</span>
          <div className="chips">
            {/* These lead to the winners page rather than opening a copy of
                it here. One rendering of the firm's winners, one place the
                privacy note lives. */}
            {drawnMonths.map((month) => (
              <button
                key={month}
                type="button"
                className="chip"
                onClick={() => navigate("/winners")}
              >
                {monthName(month)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The cut-off, up front. The statement footer says "Updated as of" too,
          but a consultant reading the table needs it before opening anything:
          an activity after this date is in the *next* draw, not this one.

          Which draw the counts below are for now matters more than it did, since
          a pass is used up by the draw it enters — and gold and blue are not
          going into the same one. */}
      <div className="cutoff" role="note">
        <span className="draw">Entries for the {monthAndYear(drawMonth)} draw</span>
        {campaign.dataAsOf && (
          <span className="asof">
            No. of passes as of <b>{shortDate(campaign.dataAsOf)}</b>
          </span>
        )}
        <button
          type="button"
          className="refresh"
          onClick={() => page.reload()}
          disabled={page.loading}
        >
          {page.loading ? <span className="spinner" /> : <RefreshIcon />}
          {page.loading ? "Refreshing…" : "Refresh"}
        </button>
        <span className="note">
          The counts below are this draw only. Blue passes enter the draw for the
          month they were earned and are used up by it — they are not carried
          forward.{" "}
          {campaign.drawSchedule.gold === "monthly"
            ? `Gold passes enter the same draw.`
            : `Gold passes are held for the ${monthAndYear(goldBallot)} draw.`}{" "}
          Activity recorded after this date counts toward the following draw.
        </span>
        {awaiting > 0 && (
          <span className="pending-note">
            {awaiting} {awaiting === 1 ? "pass" : "passes"} across your clients{" "}
            {awaiting === 1 ? "is" : "are"} in the{" "}
            {awaitingMonths.length > 0 ? `${awaitingMonths.join(" and ")} ` : "previous "}
            draw, awaiting {awaitingMonths.length > 1 ? "results" : "a result"}.
            They are not counted above. Open a client to see theirs.
          </span>
        )}
      </div>

      <div className="tablewrap card" style={{ boxShadow: "none" }}>
        <table className="ptable stack">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Mobile</th>
              <th scope="col">Email</th>
              <th scope="col" className="num">Gold Passes</th>
              <th scope="col" className="num">Blue Passes</th>
              <th scope="col" className="num">Total</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((row) => (
              <tr key={row.client.id}>
                <td className="name" data-label="Name">
                  {row.client.fullName}
                  {/* A consultant scanning a column of zeroes needs to see that
                      this one is zero because they won, not because they never
                      took part. */}
                  {row.won && <span className="winner-badge">Winner</span>}
                </td>
                <td data-label="Mobile">{formatMobile(row.client.mobile)}</td>
                <td data-label="Email">{row.client.email}</td>
                <td
                  className={`num gold-val${row.gold === 0 ? " zero" : ""}`}
                  data-label="Gold Passes"
                >
                  {row.gold}
                </td>
                <td
                  className={`num blue-val${row.blue === 0 ? " zero" : ""}`}
                  data-label="Blue Passes"
                >
                  {row.blue}
                </td>
                {/* Gold and blue enter separate draws, so this is a quick read of
                    how active the client is rather than odds in either draw. */}
                <td className="num total-val" data-label="Total">
                  {row.gold + row.blue}
                </td>
                <td data-label="Details">
                  <button
                    type="button"
                    className="rowbtn"
                    onClick={() => setOpenClientId(row.client.id)}
                    aria-label={`View how ${row.client.fullName} earned their passes`}
                  >
                    <SearchIcon />
                  </button>
                </td>
              </tr>
            ))}

            {clients.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 0 }}>
                  <EmptyState title="No clients holding passes yet">
                    None of your clients has earned a boarding pass in this campaign so
                    far. They appear here as soon as a qualifying activity is recorded.
                  </EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CampaignDetailsModal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        campaign={campaign}
        activities={activities}
      />

      <Modal
        open={openClientId !== null}
        onClose={() => setOpenClientId(null)}
        title="Client boarding passes"
      >
        {statement.loading && <Loading />}
        {statement.error && <Alert kind="err">{statement.error}</Alert>}
        {statement.data && (
          <ClientStatementPanel
            campaign={campaign}
            activities={activities}
            draws={draws}
            statement={statement.data}
          />
        )}
      </Modal>

    </div>
  );
}
