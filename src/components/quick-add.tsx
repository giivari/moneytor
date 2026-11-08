"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown, Plus } from "@phosphor-icons/react";
import { TransactionEditor } from "@/components/transaction-editor";
import type { AnyActivityKind } from "@/lib/finance/types";
import type { TransactionPreset } from "@/lib/domain/transaction-preset";
import { ICON_MD } from "./icon-size";

/** The Catat button for mobile dock and compact buttons. */
export function QuickAdd({ compact = false, kind, label = "Catat" }: { compact?: boolean; kind?: AnyActivityKind; label?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className={compact ? "dock-add" : "button-primary"} type="button" onClick={() => setOpen(true)} aria-label={kind ? label : "Catat transaksi"}>
      {compact ? <><span className="dock-add-glyph"><Plus size={ICON_MD} weight="bold" aria-hidden="true" /></span><span>{label}</span></> : <><Plus size={ICON_MD} weight="bold" aria-hidden="true" /><span>{label}</span></>}
    </button>
    {open && <TransactionEditor onClose={() => setOpen(false)} preset={kind ? { kind } : undefined} />}
  </>;
}

/** Outlook New-Mail style split button: [+ Transaksi baru | ▾] with 5-scenario dropdown. */
export function OutlookSplitAdd() {
  const [openPreset, setOpenPreset] = useState<TransactionPreset | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [menuOpen]);

  return (
    <div className="outlook-split-add" ref={containerRef}>
      <button
        type="button"
        className="split-btn-main"
        onClick={() => setOpenPreset({ kind: "expense", scenarioTab: "pengeluaran" })}
        aria-label="Catat transaksi baru (Pengeluaran)"
      >
        <Plus size={ICON_MD} weight="bold" aria-hidden="true" />
        <span>Transaksi baru</span>
      </button>
      <button
        type="button"
        className="split-btn-arrow"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Pilih skenario transaksi"
      >
        <CaretDown size={12} weight="bold" aria-hidden="true" />
      </button>

      {menuOpen && (
        <div className="split-dropdown-menu" role="menu" aria-label="Pilih skenario transaksi">
          <div className="split-dropdown-header">Pilih Skenario (5 Tab)</div>
          <button
            type="button"
            role="menuitem"
            className="split-dropdown-item"
            onClick={() => {
              setMenuOpen(false);
              setOpenPreset({ kind: "expense", scenarioTab: "pengeluaran" });
            }}
          >
            <span className="split-item-title">1. Pengeluaran &amp; Kredit</span>
            <span className="split-item-badge">Tab 1</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="split-dropdown-item"
            onClick={() => {
              setMenuOpen(false);
              setOpenPreset({ kind: "transfer", scenarioTab: "transfer" });
            }}
          >
            <span className="split-item-title">2. Top-Up &amp; Transfer</span>
            <span className="split-item-badge">Tab 2</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="split-dropdown-item"
            onClick={() => {
              setMenuOpen(false);
              setOpenPreset({ kind: "expense", scenarioTab: "splitbill" });
            }}
          >
            <span className="split-item-title">3. Split Bill / Talangan</span>
            <span className="split-item-badge">Tab 3</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="split-dropdown-item"
            onClick={() => {
              setMenuOpen(false);
              setOpenPreset({ kind: "income", scenarioTab: "pemasukan" });
            }}
          >
            <span className="split-item-title">4. Pemasukan &amp; Refund</span>
            <span className="split-item-badge">Tab 4</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="split-dropdown-item"
            onClick={() => {
              setMenuOpen(false);
              setOpenPreset({ kind: "repay", scenarioTab: "pelunasan" });
            }}
          >
            <span className="split-item-title">5. Bayar Tagihan / Ganti</span>
            <span className="split-item-badge">Tab 5</span>
          </button>
        </div>
      )}

      {openPreset && (
        <TransactionEditor
          onClose={() => setOpenPreset(null)}
          preset={openPreset}
        />
      )}
    </div>
  );
}
