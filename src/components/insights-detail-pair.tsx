"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type InsightsDetailItem = {
  key: string; title: string; summary?: string; mobileSummary?: string; content?: ReactNode;
  action: string; details: ReactNode;
};

/** Details are siblings of the aligned summaries, never children of one card. */
export function InsightsDetailPair({ label, items }: { label: string; items: readonly [InsightsDetailItem, InsightsDetailItem] }) {
  const [active, setActive] = useState<string | null>(null);
  const id = useId(), panelId = `${id}-details`;
  const panel = useRef<HTMLElement>(null), heading = useRef<HTMLDivElement>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const selected = items.find((item) => item.key === active);
  const restoreFocus = (key = active) => {
    if (key && panel.current?.contains(document.activeElement)) triggers.current[key]?.focus({ preventScroll: true });
  };
  const toggle = (key: string) => { restoreFocus(key); setActive((current) => current === key ? null : key); };
  const close = () => { restoreFocus(); setActive(null); };
  useLayoutEffect(() => {
    const element = heading.current;
    // Reveal only a newly opened offscreen heading, never financial/data updates.
    // Instant native positioning also respects reduced-motion preferences.
    if (active && element && element.getBoundingClientRect().top >= window.innerHeight) {
      element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
  }, [active]);
  return <div className="insight-detail-pair" role="group" aria-label={label}>
    {items.map((item) => <section className="surface insight-panel insight-summary-card" key={item.key} aria-label={item.title}>
      <div className="insight-summary-content">{item.content ?? <><h2>{item.title}</h2><p className="insight-note">{item.summary}</p></>}</div>
      <button type="button" className="insight-detail-trigger" id={`${id}-${item.key}`} ref={(element) => { triggers.current[item.key] = element; }}
        aria-expanded={active === item.key} aria-controls={panelId} onClick={() => toggle(item.key)}>{item.action}</button>
    </section>)}
    <section className="surface insight-panel insight-detail-panel" id={panelId} ref={panel} hidden={!selected} role="region"
      aria-labelledby={selected ? `${id}-${selected.key}` : undefined}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      {selected && <><div className="insight-detail-heading" ref={heading}><h3>{selected.title}</h3><button type="button" className="finance-secondary" onClick={close} aria-label={`Tutup rincian ${selected.title}`}>Tutup rincian</button></div>
        <div className="insight-detail-content" key={selected.key}>{selected.details}</div></>}
    </section>
  </div>;
}
