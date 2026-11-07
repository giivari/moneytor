"use client";

import { useState } from "react";
import { TransactionEditor } from "./transaction-editor";
import { minorToInput } from "@/lib/finance/format";
import { shortDate } from "./ui";

/** Opens the Transfer editor with the credit account as destination and the bill amount filled in. */
export function PayBillButton({ assetId, name, exponent, amountMinor, dueIso }: {
  assetId: string; name: string; exponent: number; amountMinor: string; dueIso: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="finance-secondary" onClick={() => setOpen(true)} aria-label={`Bayar tagihan ${name}`}>Bayar tagihan</button>
    {open && <TransactionEditor onClose={() => setOpen(false)}
      preset={{ kind: "transfer", destinationId: assetId, amount: minorToInput(amountMinor, exponent), note: `Bayar tagihan ${name} jatuh tempo ${shortDate(dueIso)}` }} />}
  </>;
}
