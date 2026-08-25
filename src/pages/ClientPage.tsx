import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { CampaignDetailsModal } from "../components/CampaignDetailsModal";
import { ClientStatementPanel } from "../components/ClientStatementPanel";
import { Alert, Loading } from "../components/Loading";
import { api } from "../data";
import { monthAndYear } from "../lib/format";
import { countsTowardDraw } from "../lib/passes";
import { useAsync } from "../lib/useAsync";

/** The draw a pass earned today would first go into. */
function currentDrawMonth(startsOn: string, endsOn: string): string {
  const now = new Date().toISOString().slice(0, 7);
  const start = startsOn.slice(0, 7);
  const end = endsOn.slice(0, 7);
  if (now < start) return start;
  if (now > end) return end;
  return now;
}

/** A client's own view: their statement, and nothing about anybody else. */
export function ClientPage() {
  const { viewer } = useAuth();
  const clientId = viewer?.clientId ?? "";
  const [detailsOpen, setDetailsOpen] = useState(false);

  const page = useAsync(async () => {
    const campaign = await api.getCampaign();
    const [activities, statement] = await Promise.all([
      api.getActivities(campaign.id),
      api.getClientStatement(clientId, campaign.id),
    ]);
    return { campaign, activities, statement };
  }, [clientId]);

  if (page.loading) return <Loading label="Loading your boarding passes…" />;
  if (page.error) return <div className="page"><Alert kind="err">{page.error}</Alert></div>;
  if (!page.data) return null;

  const { campaign, activities, statement } = page.data;
  const thisDraw = currentDrawMonth(campaign.startsOn, campaign.endsOn);
  // Passes dated to a later draw exist only when an admin has deliberately
  // deferred them, so the explanation is shown only when there are some.
  const heldBack = statement.events
    .filter((e) => countsTowardDraw(e) && e.drawMonth > thisDraw)
    .reduce((n, e) => n + e.passes, 0);

  return (
    <div className="page">
      <div className="card">
        <div className="card-pad">
          <ClientStatementPanel
            campaign={campaign}
            activities={activities}
            statement={statement}
          />

          <div style={{ textAlign: "center", marginTop: 18 }}>
            <button type="button" className="linkish" onClick={() => setDetailsOpen(true)}>
              Campaign details and how to earn more passes
            </button>
          </div>

          {heldBack > 0 && (
            <p className="block-note" style={{ marginTop: 14 }}>
              {heldBack} of your passes enter a later draw than {monthAndYear(thisDraw)}.
            </p>
          )}
        </div>
      </div>

      <CampaignDetailsModal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        campaign={campaign}
        activities={activities}
      />
    </div>
  );
}
