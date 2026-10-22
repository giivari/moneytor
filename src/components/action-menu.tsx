"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";

/** Compact action menu with the same keyboard/outside-dismiss behavior as the shell menu. */
export function ActionMenu({ label, items, disabled = false }: {
  label: string;
  items: { label: string; onSelect: () => void; disabled?: boolean }[];
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const initialFocus = useRef<"first" | "last">("first");
  useEffect(() => {
    if (!open) return;
    const available = options.current.filter((item) => item && !item.disabled);
    (initialFocus.current === "last" ? available.at(-1) : available[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <div className="action-menu" ref={anchor} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button type="button" ref={trigger} className="button-primary" disabled={disabled}
      aria-haspopup="menu" aria-expanded={open} aria-controls={id}
      onClick={() => { initialFocus.current = "first"; setOpen((value) => !value); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); initialFocus.current = event.key === "ArrowUp" ? "last" : "first"; setOpen(true);
        }
      }}>{label}<CaretDown size={16} aria-hidden="true" /></button>
    {open && <div id={id} className="action-menu-options" role="menu" aria-label={label}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const available = options.current.filter((item) => item && !item.disabled);
        const index = available.findIndex((item) => item === document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : available.length - 1)) % available.length;
        available[next]?.focus();
      }}>
      {items.map((item, index) => <button type="button" role="menuitem" tabIndex={-1} key={item.label}
        ref={(node) => { options.current[index] = node; }} disabled={item.disabled}
        onClick={() => { setOpen(false); trigger.current?.focus(); item.onSelect(); }}>{item.label}</button>)}
    </div>}
  </div>;
}
