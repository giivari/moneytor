"use client";

import type { ReactNode } from "react";
import { ListToolbar } from "./list-toolbar";
import { SectionHeading } from "./section-heading";

export function AutomationRulesSection({ archived, onArchivedChange, children, utilities, action }: {
  archived: boolean; onArchivedChange: (value: boolean) => void; children: ReactNode; utilities?: ReactNode; action?: ReactNode;
}) {
  return <section className="surface automation-rules" aria-label="Aturan otomatisasi">
    <SectionHeading title="Aturan" action={action} /><ListToolbar label="Filter dan urutan aturan">{utilities}<label className="finance-history-toggle">
      <input type="checkbox" checked={archived} onChange={(event) => onArchivedChange(event.target.checked)} />
      Tampilkan yang diarsipkan
    </label></ListToolbar>
    {children}
  </section>;
}
