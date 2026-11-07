"use client";

import { useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { TransactionEditor } from "@/components/transaction-editor";
import type { ActivityKind } from "@/lib/finance/types";
import { ICON_MD } from "./icon-size";

/** The Catat button. With `kind` the editor opens on "Akun & nominal" with that type chosen; without it, on "Jenis". */
export function QuickAdd({ compact = false, kind, label = "Catat" }: { compact?: boolean; kind?: ActivityKind; label?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className={compact ? "dock-add" : "button-primary"} type="button" onClick={() => setOpen(true)} aria-label={kind ? label : "Catat transaksi"}>
      {compact ? <><span className="dock-add-glyph"><Plus size={ICON_MD} weight="bold" aria-hidden="true" /></span><span>{label}</span></> : <><Plus size={ICON_MD} weight="bold" aria-hidden="true" /><span>{label}</span></>}
    </button>
    {open && <TransactionEditor onClose={() => setOpen(false)} preset={kind ? { kind } : undefined} />}
  </>;
}
