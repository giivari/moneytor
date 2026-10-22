"use client";

import { useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { TransactionEditor } from "@/components/transaction-editor";

export function QuickAdd({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className={compact ? "bottom-add" : "button-primary"} type="button" onClick={() => setOpen(true)} aria-label="Tambah transaksi">
      {compact ? <><span className="add-glyph"><Plus size={23} weight="bold" /></span><span>Add</span></> : <><Plus size={18} weight="bold" /><span>Tambah transaksi</span></>}
    </button>
    {open && <TransactionEditor onClose={() => setOpen(false)} />}
  </>;
}
