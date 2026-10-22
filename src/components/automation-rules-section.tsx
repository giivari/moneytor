"use client";

import type { ReactNode } from "react";
import { ListToolbar } from "./list-toolbar";
import { SectionHeading } from "./section-heading";

export function AutomationRulesSection({ archived, onArchivedChange, children, utilities }: {
  archived: boolean; onArchivedChange: (value: boolean) => void; children: ReactNode; utilities?: ReactNode;
}) {
  return <section className="automation-rules" aria-label="Aturan otomatisasi">
    <SectionHeading title="Aturan" /><ListToolbar label="Filter dan urutan aturan">{utilities}<label className="finance-history-toggle">
      <input type="checkbox" checked={archived} onChange={(event) => onArchivedChange(event.target.checked)} />
      Tampilkan yang diarsipkan
    </label></ListToolbar>
    {children}
  </section>;
}
