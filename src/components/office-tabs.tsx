"use client";

import { useRef } from "react";

export type OfficeTab<T extends string> = { id: T; label: string };

/**
 * Office-style tab strip. `sheet` mirrors Excel workbook sheet tabs, `pivot` mirrors Fluent pivots.
 * Tabs only switch which existing sections are visible; they never own financial data.
 */
export function OfficeTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix,
  variant = "sheet",
}: {
  label: string;
  tabs: OfficeTab<T>[];
  value: T;
  onChange: (value: T) => void;
  idPrefix: string;
  variant?: "sheet" | "pivot";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function move(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === value);
    const last = tabs.length - 1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? last
      : event.key === "ArrowRight" ? (index + 1) % tabs.length
      : (index + tabs.length - 1) % tabs.length;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  }
  return <div className={`office-${variant}-tabs`} role="tablist" aria-label={label} onKeyDown={move}>
    {tabs.map((tab, index) => <button
      key={tab.id}
      ref={(node) => { refs.current[index] = node; }}
      type="button"
      role="tab"
      id={`${idPrefix}-tab-${tab.id}`}
      aria-controls={`${idPrefix}-panel-${tab.id}`}
      aria-selected={tab.id === value}
      tabIndex={tab.id === value ? 0 : -1}
      className={`office-${variant}-tab`}
      onClick={() => onChange(tab.id)}
    >{tab.label}</button>)}
  </div>;
}
