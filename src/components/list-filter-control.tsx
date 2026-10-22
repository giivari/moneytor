"use client";

import { ListOrderControl } from "./list-sort-control";
import { useMobileViewport } from "./use-mobile-viewport";

/** One control per viewport; the logical filter and dataset stay shared. */
export function ListFilterControl<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (value: T) => void; options: readonly { value: T; label: string }[]; label: string;
}) {
  const mobile = useMobileViewport();
  const select = (next: string) => { const option = options.find(item => item.value === next); if (option) onChange(option.value); };
  if (mobile) return <ListOrderControl value={value} setValue={select} options={options} label={label} className="list-filter-control" />;
  return <div className="filter-row" role="group" aria-label={label}>{options.map(option =>
    <button key={option.value} type="button" className={`filter-chip ${value === option.value ? "active" : ""}`}
      data-kind={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}
