"use client";

import type { ReactNode } from "react";
import { ResponsiveDisclosure } from "./responsive-disclosure";

/** Keep controls mounted so collapsing never discards drafts or native validity. */
export function CompactFormSection({ id, label, summary, expanded, onExpandedChange, collapsible = true,
  disabled = false, invalid = false, action, children }: {
  id: string; label: string; summary: string; expanded: boolean; onExpandedChange: (expanded: boolean) => void;
  collapsible?: boolean; disabled?: boolean; invalid?: boolean; action?: ReactNode; children: ReactNode;
}) {
  return <fieldset className="automation-builder-section compact-form-section" data-builder-section={id}
    data-invalid={invalid || undefined} disabled={disabled}>
    <legend className="compact-form-legend">{label}</legend>
    <ResponsiveDisclosure label={invalid ? `${label} · Periksa isian` : label} summary={summary} expanded={expanded}
      onExpandedChange={onExpandedChange} collapsible={collapsible} action={action}>{children}</ResponsiveDisclosure>
  </fieldset>;
}
