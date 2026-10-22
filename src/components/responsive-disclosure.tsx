"use client";

import { useId, useState, type ReactNode } from "react";
import { CaretRight } from "@phosphor-icons/react";

/** Controlled expansion is available for forms; existing secondary disclosures retain local state. */
export function ResponsiveDisclosure({ label, children, desktopExpanded = false, className = "", expanded: controlledExpanded,
  onExpandedChange, summary, collapsible = true, action }: {
  label: string; children: ReactNode; desktopExpanded?: boolean; className?: string; expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void; summary?: ReactNode; collapsible?: boolean; action?: ReactNode;
}) {
  const contentId = useId();
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const heading = summary === undefined ? <span>{label}</span> : <span className="disclosure-label"><span>{label}</span>
    {!expanded && summary && <span className="disclosure-summary">{summary}</span>}</span>;
  const toggle = collapsible ? <button type="button" className="disclosure-toggle" aria-expanded={expanded} aria-controls={contentId}
      onClick={() => { const next = !expanded; if (onExpandedChange) onExpandedChange(next); else setLocalExpanded(next); }}>
      <CaretRight size={16} aria-hidden="true" />{heading}
    </button> : <div className="disclosure-heading">{heading}</div>;
  return <div className={`responsive-disclosure ${className}`} data-expanded={expanded} data-desktop-expanded={desktopExpanded}>
    {action ? <div className="disclosure-heading-row">{toggle}{action}</div> : toggle}
    <div className="disclosure-content" id={contentId}>{children}</div>
  </div>;
}
