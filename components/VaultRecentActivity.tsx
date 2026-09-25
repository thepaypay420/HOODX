import { activityTransactionUrl, recentVaultActivity } from "@/lib/vaultActivity";

const dateLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function VaultRecentActivity({ slug }: { slug: string }) {
  const [activity] = recentVaultActivity(slug);
  if (!activity) return null;

  return (
    <aside className="vault-recent-action" aria-label="Latest curator action">
      <div className="vault-action-kicker"><i aria-hidden="true" />Latest curator action</div>
      <div className="vault-action-flow" aria-hidden="true">
        <span className="vault-action-asset">GAIN</span>
        <span className="vault-action-track"><i /></span>
        <span className="vault-action-reserve">WETH</span>
      </div>
      <h2>{activity.title}</h2>
      <p>{activity.detail}</p>
      <div className="vault-action-meta">
        <strong>{activity.result}</strong>
        <a href={activityTransactionUrl(activity.txHash)} target="_blank" rel="noreferrer">
          {dateLabel.format(new Date(activity.confirmedAt))} <span aria-hidden="true">↗</span>
        </a>
      </div>
    </aside>
  );
}
