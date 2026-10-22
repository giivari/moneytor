"use client";

import { Fragment, useSyncExternalStore, type ReactNode } from "react";

export type FinancialColumn<T> = {
  key: string; heading: string; numeric?: boolean; secondary?: boolean;
  render: (record: T) => ReactNode;
};
type RowAction<T> = { onActivate: (record: T) => void; disabled?: boolean };
/** Nested controls keep their own interaction, including the label surrounding a money input. */
export function isFinancialRowControl(target: Element) {
  return !!target.closest("button, a, input, select, textarea, summary, label, [role='button'], [contenteditable='true']");
}
const query = "(min-width: 1021px)";
function subscribe(notify: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}
/** One ordered dataset and one mounted representation; presentation never sorts or slices. */
export function FinancialDataTable<T>({ label, records, identity, columns, compact, rowAction }: {
  label: string; records: readonly T[]; identity: (record: T) => string;
  columns: FinancialColumn<T>[]; compact: (record: T) => ReactNode;
  rowAction?: RowAction<T>;
}) {
  const desktop = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
  if (!desktop) return <div className="financial-record-list" aria-label={label}>
    {records.map(record => <Fragment key={identity(record)}>{compact(record)}</Fragment>)}
  </div>;
  return <FinancialTable label={label} records={records} identity={identity} columns={columns} rowAction={rowAction} />;
}
export function FinancialTable<T>({label,records,identity,columns,rowAction}:{label:string;records:readonly T[];identity:(record:T)=>string;columns:FinancialColumn<T>[];rowAction?:RowAction<T>}) {
  return <div className="financial-table-container"><table className="financial-data-table">
    <caption className="sr-only">{label}</caption>
    <thead><tr>{columns.map(column => <th key={column.key} scope="col" data-column={column.key} data-numeric={column.numeric} data-secondary={column.secondary}>{column.heading}</th>)}</tr></thead>
    <tbody>{records.map(record => <tr key={identity(record)} data-actionable={!!rowAction && !rowAction.disabled}
      onClick={rowAction ? event => {
        if (!rowAction.disabled && !isFinancialRowControl(event.target as Element)) rowAction.onActivate(record);
      } : undefined}>{columns.map(column =>
      <td key={column.key} data-column={column.key} data-numeric={column.numeric} data-secondary={column.secondary}>{column.render(record)}</td>)}</tr>)}</tbody>
  </table></div>;
}
