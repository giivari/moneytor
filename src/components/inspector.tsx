"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { X } from "@phosphor-icons/react";
import { offerFocusReturn } from "@/lib/finance/focus-return";
import { ICON_MD } from "./icon-size";

/**
 * One inspector for every entity. Server components pass the detail as already-rendered JSX, so no
 * financial logic runs here. >= 1280px it is a column beside the page; narrower it overlays as a
 * drawer (tablet) or bottom sheet (phone) with a scrim, focus kept inside, Escape to close.
 */
export type InspectorEntry = { id: string; title: string; subtitle?: string; body: ReactNode };

type InspectorState = {
  entry: InspectorEntry | null;
  open: (entry: InspectorEntry, trigger?: HTMLElement | null) => void;
  /** Replaces the content of the open entry with the same id (fresh data after refresh) without moving focus or the trigger. */
  update: (entry: InspectorEntry) => void;
  /** Closes the entry only when it still shows `id` (its row went away). */
  release: (id: string) => void;
  close: () => void;
};
const InspectorContext = createContext<InspectorState>({ entry: null, open: () => {}, update: () => {}, release: () => {}, close: () => {} });

export function useInspector() { return useContext(InspectorContext); }

export function InspectorProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<InspectorEntry | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  const open = useCallback((next: InspectorEntry, trigger?: HTMLElement | null) => { triggerRef.current = trigger ?? null; setEntry(next); }, []);
  const close = useCallback(() => {
    setEntry(null);
    const trigger = triggerRef.current;
    offerFocusReturn(trigger);
    if (trigger?.isConnected) requestAnimationFrame(() => trigger.focus());
  }, []);
  const update = useCallback((next: InspectorEntry) => { setEntry((previous) => (previous && previous.id === next.id ? next : previous)); }, []);
  const release = useCallback((id: string) => { setEntry((previous) => (previous && previous.id === id ? null : previous)); }, []);
  useEffect(() => { setEntry(null); }, [pathname]);
  const value = useMemo(() => ({ entry, open, update, release, close }), [entry, open, update, release, close]);
  return <InspectorContext.Provider value={value}>{children}</InspectorContext.Provider>;
}

/**
 * Keeps an open inspector in step with fresh page data. When `source` changes (props after router.refresh()), an entry whose id starts
 * with `prefix` is rebuilt through `apply`; if `find` no longer returns its record (void, archive, deleted) the inspector closes
 * unless `keepWhenMissing` is set (paged lists that may not contain every record).
 */
export function useInspectorSync<T>(prefix: string, source: unknown, find: (entryId: string) => T | undefined,
  apply: (item: T, update: (entry: InspectorEntry) => void) => void, keepWhenMissing = false) {
  const { entry, update, close } = useInspector();
  const latest = useRef({ entry, find, apply, update, close });
  useEffect(() => { latest.current = { entry, find, apply, update, close }; });
  useEffect(() => {
    const current = latest.current;
    if (!current.entry?.id.startsWith(prefix)) return;
    const item = current.find(current.entry.id);
    if (item !== undefined) current.apply(item, current.update);
    else if (!keepWhenMissing) current.close();
  }, [source, prefix, keepWhenMissing]);
}

const overlayQuery = "(max-width: 1279px)";

export function InspectorPanel() {
  const { entry, close } = useInspector();
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!entry) return;
    headingRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // A dialog opened from the inspector (editor, confirmation) owns Escape; closing the panel would unmount it and drop its input.
      if (event.key === "Escape") { if (event.defaultPrevented || document.querySelector("dialog[open]")) return; event.preventDefault(); close(); return; }
      if (event.key !== "Tab" || !window.matchMedia(overlayQuery).matches || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0]!, last = focusable[focusable.length - 1]!;
      if (!panelRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [entry, close]);
  if (!entry) return null;
  return <>
    <div className="inspector-scrim" onClick={close} aria-hidden="true" />
    <aside ref={panelRef} className="inspector" role="dialog" aria-labelledby="inspector-title">
      <header className="inspector-header">
        <div className="inspector-heading">
          <h2 id="inspector-title" ref={headingRef} tabIndex={-1}>{entry.title}</h2>
          {entry.subtitle && <p>{entry.subtitle}</p>}
        </div>
        <button type="button" className="icon-button" onClick={close} aria-label="Tutup rincian"><X size={ICON_MD} aria-hidden="true" /></button>
      </header>
      <div className="inspector-body">{entry.body}</div>
    </aside>
  </>;
}

type RowState = { show: (trigger: HTMLElement | null) => void; selected: boolean };
const RowContext = createContext<RowState>({ show: () => {}, selected: false });

/**
 * A row that opens the inspector. The row's title is a real button (keyboard, screen readers); a
 * pointer click anywhere else on the row also opens it unless the owner was selecting text to copy.
 */
export function InspectorRow({ id, title, subtitle, detail, className = "", as = "li", children }: {
  id: string; title: string; subtitle?: string; detail: ReactNode; className?: string; as?: "li" | "div"; children: ReactNode;
}) {
  const { entry, open, update, release } = useInspector();
  const selected = entry?.id === id;
  const show = useCallback((trigger: HTMLElement | null) => open({ id, title, subtitle, body: detail }, trigger), [open, id, title, subtitle, detail]);
  // The open panel follows this row's fresh detail after router.refresh(), and closes when the row disappears.
  useEffect(() => { if (selected) update({ id, title, subtitle, body: detail }); }, [selected, update, id, title, subtitle, detail]);
  useEffect(() => () => release(id), [release, id]);
  const Element = as;
  return <Element className={`inspector-row ${className}`} data-selected={selected} onClick={(event) => {
    const target = event.target as HTMLElement;
    if (target.closest("a,button,input,select,textarea,summary")) return;
    if (window.getSelection()?.toString()) return;
    show(event.currentTarget.querySelector<HTMLElement>("[data-inspector-trigger]"));
  }}>
    <RowContext.Provider value={{ show, selected }}>{children}</RowContext.Provider>
  </Element>;
}

export function InspectorRowButton({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { show, selected } = useContext(RowContext);
  return <button type="button" data-inspector-trigger className={`inspector-row-trigger ${className}`} aria-haspopup="dialog" aria-expanded={selected}
    onClick={(event) => show(event.currentTarget)}>{children}</button>;
}

