import { Icon } from "./Icon";

/**
 * On-brand empty state for screens whose functionality isn't wired up yet.
 * Renders the page header + a centered "coming soon" card.
 */
export function PagePlaceholder({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: string;
  icon: string;
}) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>

      <div className="placeholder">
        <div className="ph-icon">
          <Icon name={icon} size={26} />
        </div>
        <h2>{title}</h2>
        <p>
          This screen is part of the Grey FMS shell. The layout and navigation are in
          place — data and actions will be wired up next.
        </p>
        <span className="pill info">Coming soon</span>
      </div>
    </>
  );
}
