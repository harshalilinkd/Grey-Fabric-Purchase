"use client";

import Link from "next/link";
import { Icon } from "./Icon";

type EmptyAction = {
  label: string;
  icon?: string;
  onClick?: () => void;
  href?: string;
};

/**
 * Action-oriented empty state for inside a table card (the card hides its column
 * headers when empty). 60px --accent-soft icon tile + bold title + one muted line +
 * an optional "next best action" button. Matches the `.empty` token styling.
 */
export function EmptyState({
  icon,
  title,
  line,
  action,
}: {
  icon: string;
  title: string;
  line: string;
  action?: EmptyAction;
}) {
  return (
    <div className="empty">
      <div className="ph-icon"><Icon name={icon} size={26} /></div>
      <h3>{title}</h3>
      <p>{line}</p>
      {action &&
        (action.href ? (
          <Link className="btn btn-primary" href={action.href}>
            {action.icon && <Icon name={action.icon} />}
            {action.label}
          </Link>
        ) : (
          <button className="btn btn-primary" onClick={action.onClick}>
            {action.icon && <Icon name={action.icon} />}
            {action.label}
          </button>
        ))}
    </div>
  );
}
