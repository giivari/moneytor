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

/** Opens the Repay editor with the liability account as destination and the remaining debt filled in. */
export function RepayDebtButton({ assetId, name, exponent, amountMinor }: {
  assetId: string; name: string; exponent: number; amountMinor: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="finance-secondary" onClick={() => setOpen(true)} aria-label={`Lunasi utang ${name}`}>Lunasi utang</button>
    {open && <TransactionEditor onClose={() => setOpen(false)}
      preset={{ kind: "repay", destinationId: assetId, amount: minorToInput(amountMinor, exponent), note: `Pelunasan utang ${name}` }} />}
  </>;
}

/** Opens the Transfer editor with the receivable account as source to record receivable settlement. */
export function SettleReceivableButton({ assetId, name, exponent, amountMinor }: {
  assetId: string; name: string; exponent: number; amountMinor: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="finance-secondary" onClick={() => setOpen(true)} aria-label={`Terima pelunasan ${name}`}>Terima pelunasan</button>
    {open && <TransactionEditor onClose={() => setOpen(false)}
      preset={{ kind: "transfer", accountId: assetId, amount: minorToInput(amountMinor, exponent), note: `Pelunasan piutang ${name}` }} />}
  </>;
}

/** Opens the Refund editor pre-filled with the original expense activity and remaining refundable amount. */
export function RefundExpenseButton({ activityId, sourceAssetId, exponent, refundableMinor, note }: {
  activityId: string; sourceAssetId?: string | null; exponent: number; refundableMinor: string; note?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="finance-secondary" onClick={() => setOpen(true)} aria-label={note ? `Catat refund ${note}` : "Catat refund pengeluaran"}>Catat refund</button>
    {open && <TransactionEditor onClose={() => setOpen(false)}
      preset={{ kind: "refund", refundOfActivityId: activityId, accountId: sourceAssetId ?? undefined, amount: minorToInput(refundableMinor, exponent), note: note ? `Refund ${note}` : "Refund pengeluaran" }} />}
  </>;
}
