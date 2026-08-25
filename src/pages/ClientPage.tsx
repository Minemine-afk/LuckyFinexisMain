import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { CampaignDetailsModal } from "../components/CampaignDetailsModal";
import { ClientStatementPanel } from "../components/ClientStatementPanel";
import { Alert, Loading } from "../components/Loading";
import { api } from "../data";
import { monthAndYear } from "../lib/format";
import { currentDrawMonth } from "../lib/passes";
import { useAsync } from "../lib/useAsync";

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
  const thisDraw = currentDrawMonth(campaign);

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

          <p className="block-note" style={{ marginTop: 14 }}>
            Counting toward the {monthAndYear(thisDraw)} draw.
          </p>
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
