import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { CampaignDetailsModal } from "../components/CampaignDetailsModal";
import { ClientStatementPanel } from "../components/ClientStatementPanel";
import { SearchIcon } from "../components/Icons";
import { Alert, EmptyState, Loading } from "../components/Loading";
import { Modal } from "../components/Modal";
import { api } from "../data";
import { formatMobile, monthAndYear, monthName, passTypeLabel, shortDate } from "../lib/format";
import { currentDrawMonth } from "../lib/passes";
import { useAsync } from "../lib/useAsync";
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
  const advisorId = viewer?.advisorId ?? "";

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [winnersMonth, setWinnersMonth] = useState<string | null>(null);
  const [openClientId, setOpenClientId] = useState<string | null>(null);

  const page = useAsync(async () => {
    const campaign = await api.getCampaign();
    const [activities, clients, draws] = await Promise.all([
      api.getActivities(campaign.id),
      api.getAdvisorClients(advisorId, campaign.id),
      api.getPublishedDraws(campaign.id),
    ]);
    return { campaign, activities, clients, draws };
  }, [advisorId]);

  const statement = useAsync<ClientStatement | null>(async () => {
    if (!openClientId || !page.data) return null;
    return api.getClientStatement(openClientId, page.data.campaign.id);
  }, [openClientId, page.data?.campaign.id]);

  const winners = useAsync(async () => {
    if (!winnersMonth || !page.data) return [];
    return api.getWinners(page.data.campaign.id, winnersMonth);
  }, [winnersMonth, page.data?.campaign.id]);

  if (page.loading) return <Loading label="Loading your clients…" />;
  if (page.error) return <div className="page"><Alert kind="err">{page.error}</Alert></div>;
  if (!page.data) return null;

  const { campaign, activities, clients, draws } = page.data;
  const drawMonth = currentDrawMonth(campaign);

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

      {draws.length > 0 && (
        <div className="toolbar">
          <span className="label">View past winners:</span>
          <div className="chips">
            {draws.map((d) => (
              <button
                key={d.id}
                type="button"
                className="chip"
                aria-pressed={winnersMonth === d.drawMonth}
                onClick={() => setWinnersMonth(d.drawMonth)}
              >
                {monthName(d.drawMonth)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The cut-off, up front. The statement footer says "Updated as of" too,
          but a consultant reading the table needs it before opening anything:
          an activity after this date is in the *next* draw, not this one. */}
      <div className="cutoff" role="note">
        <span className="draw">Entries for the {monthAndYear(drawMonth)} draw</span>
        {campaign.dataAsOf && (
          <span className="asof">
            No. of passes as of <b>{shortDate(campaign.dataAsOf)}</b>
          </span>
        )}
        <span className="note">
          Activity recorded after this date counts toward the following draw.
        </span>
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
                <td className="name" data-label="Name">{row.client.fullName}</td>
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
            statement={statement.data}
          />
        )}
      </Modal>

      <Modal
        open={winnersMonth !== null}
        onClose={() => setWinnersMonth(null)}
        title={winnersMonth ? `${monthName(winnersMonth)} draw winners` : "Winners"}
      >
        {winners.loading && <Loading />}
        {winners.error && <Alert kind="err">{winners.error}</Alert>}
        {winners.data && winners.data.length === 0 && (
          <EmptyState title="No winners published for this month yet" />
        )}
        {winners.data && winners.data.length > 0 && (
          <div className="tablewrap">
            <table className="ptable">
              <thead>
                <tr>
                  <th scope="col">Winner</th>
                  <th scope="col">Prize</th>
                  <th scope="col">Pass Type</th>
                </tr>
              </thead>
              <tbody>
                {winners.data.map((w) => (
                  <tr key={w.id}>
                    <td className="name">{w.displayName}</td>
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
            <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 12 }}>
              Winners are listed by first name and last initial, because this list is
              visible to every consultant in the firm.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
