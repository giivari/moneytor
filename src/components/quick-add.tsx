"use client";

import { useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { TransactionEditor } from "@/components/transaction-editor";
import { ICON_MD } from "./icon-size";

export function QuickAdd({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className={compact ? "dock-add" : "button-primary"} type="button" onClick={() => setOpen(true)} aria-label="Catat transaksi">
      {compact ? <><span className="dock-add-glyph"><Plus size={ICON_MD} weight="bold" aria-hidden="true" /></span><span>Catat</span></> : <><Plus size={ICON_MD} weight="bold" aria-hidden="true" /><span>Catat</span></>}
    </button>
    {open && <TransactionEditor onClose={() => setOpen(false)} />}
  </>;
}
