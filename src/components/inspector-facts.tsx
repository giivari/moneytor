import type { ReactNode } from "react";

/** Inspector body building block: label/value pairs whose values stay selectable. */
export function InspectorFacts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <dl className="inspector-facts">{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}
