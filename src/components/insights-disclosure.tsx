"use client";

import { useState, type ReactNode } from "react";

/** A fresh mount is closed. Ordinary renders retain each explicitly opened section.
 * Deferred children keep detailed charts/tables out of the initial mobile layout. */
export function InsightsDisclosure({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return <details className="surface insight-panel insight-disclosure" open={expanded}
    onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><span><strong>{title}</strong><small>{summary}</small></span></summary>
    {expanded && <div className="insight-disclosure-content">{children}</div>}
  </details>;
}
