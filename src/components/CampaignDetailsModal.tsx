import { activityRule, passTypeLabel, shortDate } from "../lib/format";
import type { Activity, Campaign } from "../lib/types";
import { Modal } from "./Modal";

/**
 * The campaign details pop-up behind "Click here".
 *
 * When an admin has uploaded campaign artwork it is shown as-is, which is what
 * the mockup calls for. Until then this falls back to the campaign's own rules,
 * rendered from the activity table — a useful page rather than a broken image.
 */
export function CampaignDetailsModal({
  open,
  onClose,
  campaign,
  activities,
}: {
  open: boolean;
  onClose: () => void;
  campaign: Campaign;
  activities: Activity[];
}) {
  const byType = (t: "gold" | "blue") =>
    activities
      .filter((a) => a.passType === t)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <Modal open={open} onClose={onClose} title={`${campaign.name} — campaign details`}>
      {campaign.detailsImageUrl ? (
        <img
          className="details-art"
          src={campaign.detailsImageUrl}
          alt={`${campaign.name} campaign details`}
        />
      ) : (
        <>
          <p style={{ marginTop: 0, color: "var(--ink-2)" }}>
            Campaign artwork has not been uploaded yet, so here are the earning rules
            as they are currently configured. The campaign runs from{" "}
            {shortDate(campaign.startsOn)} to {shortDate(campaign.endsOn)}, with a draw
            every month.
          </p>

          {(["gold", "blue"] as const).map((t) =>
            byType(t).length === 0 ? null : (
              <section key={t} style={{ marginTop: 20 }}>
                <h4 style={{ marginBottom: 10 }}>
                  <span className={`badge ${t}`}>{passTypeLabel(t)} boarding passes</span>
                </h4>
                <div className="tablewrap">
                  <table className="ptable">
                    <thead>
                      <tr>
                        <th scope="col">Qualifying Activity</th>
                        <th scope="col" className="num">
                          Passes Earned
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {byType(t).map((a) => (
                        <tr key={a.id}>
                          <td className="name">{a.label}</td>
                          <td className="num">{activityRule(a)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ),
          )}

          <p style={{ marginTop: 22, fontSize: 12.5, color: "var(--ink-3)" }}>
            A pass earned in one month stays in every draw after it. Passes shown as
            pending are not in the draw until they are confirmed.
          </p>
        </>
      )}
    </Modal>
  );
}
