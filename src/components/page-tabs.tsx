"use client";

import { createContext, useContext, useId, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Underline tabs for a page header. Every panel is server-rendered; only visibility changes here,
 * so figures never depend on client state.
 */
type TabsState = { selected: string; select: (id: string) => void };
const TabsContext = createContext<TabsState>({ selected: "", select: () => {} });

export function PageTabs({ label, tabs, heading, shared }: {
  label: string; tabs: { id: string; label: string; panel: ReactNode }[];
  /** Page header content above the tab list. */ heading?: ReactNode;
  /** Content shown under the tab list for every tab (e.g. KPIs). */ shared?: ReactNode;
}) {
  const [selected, setSelected] = useState(tabs[0]?.id ?? "");
  const base = useId();
  const select = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() => document.getElementById(`${base}-tab-${id}`)?.scrollIntoView({ block: "nearest" }));
  };
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === selected), last = tabs.length - 1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? last : event.key === "ArrowRight" ? (index + 1) % tabs.length : (index + last) % tabs.length;
    const id = tabs[next]!.id;
    setSelected(id);
    document.getElementById(`${base}-tab-${id}`)?.focus();
  }
  return <TabsContext.Provider value={{ selected, select }}>
    <header className="page-header">{heading}<div className="page-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((tab) => <button key={tab.id} id={`${base}-tab-${tab.id}`} type="button" role="tab" className="page-tab"
        aria-selected={selected === tab.id} aria-controls={`${base}-panel-${tab.id}`} tabIndex={selected === tab.id ? 0 : -1}
        onClick={() => setSelected(tab.id)}>{tab.label}</button>)}
    </div></header>
    {shared}
    {tabs.map((tab) => <div key={tab.id} id={`${base}-panel-${tab.id}`} role="tabpanel" aria-labelledby={`${base}-tab-${tab.id}`}
      className="page-tab-panel" hidden={selected !== tab.id}>{tab.panel}</div>)}
  </TabsContext.Provider>;
}

/** A button elsewhere on the page that switches to a tab (e.g. a KPI's "Lihat rincian"). */
export function PageTabLink({ tab, children, className = "text-link" }: { tab: string; children: ReactNode; className?: string }) {
  const { select } = useContext(TabsContext);
  return <button type="button" className={className} onClick={() => select(tab)}>{children}</button>;
}
