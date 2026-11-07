import { ArrowCounterClockwise, ArrowDownLeft, ArrowUpRight, ArrowsLeftRight, Scales } from "@phosphor-icons/react/dist/ssr";
import type { AnyActivityKind } from "@/lib/finance/types";
import { CompactFinancialRow } from "./compact-financial-row";
import { ResponsiveLabel } from "./responsive-label";
import { FinancialAmount } from "./financial-amount";

export function MoneyMovementRow({ kind, title, context, compactContext, provenance, amount, date, fee, status }: {
  kind: AnyActivityKind;
  title: string;
  context?: string | null;
  compactContext?: string | null;
  provenance?: string | null;
  amount: string;
  date: string;
  fee?: string;
  status?: string;
}) {
  const Icon = kind === "income" ? ArrowDownLeft : kind === "expense" ? ArrowUpRight : kind === "refund" ? ArrowCounterClockwise : kind === "adjustment" ? Scales : ArrowsLeftRight;
  const tone = kind === "income" || kind === "expense" ? kind : "transfer";
  return <span className="transaction-row money-movement-row" data-kind={kind}>
    <span className={`transaction-icon ${tone} ${kind}`}><Icon size={19} aria-hidden="true" /></span>
    <CompactFinancialRow as="span" presentation="record" wideValue={amount.length > 18} identity={title}
      context={<ResponsiveLabel compact={[compactContext ?? context, provenance ? "Otomatisasi" : null, date].filter(Boolean).join(" · ")}>
        {context}{context && provenance ? " · " : ""}{provenance && <>Otomatis: {provenance}</>}{(context || provenance) && " · "}{date}
      </ResponsiveLabel>}
      value={<FinancialAmount value={amount} level="row" className={`${tone} ${kind}`} />}
      footer={(status || fee) ? <>{status && <span>{status}</span>}{fee && <span>{fee}</span>}</> : undefined} />
  </span>;
}
