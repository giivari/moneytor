"use client";
import { sortNamed } from "@/lib/list-order";
import { SectionHeading } from "./section-heading";
import { ResponsiveLabel } from "./responsive-label";
import { AppLink as Link } from "@/components/app-link";
import { ArrowRight, ChartLineUp } from "@phosphor-icons/react";
import { formatMinor } from "@/lib/finance/format";
import type { InvestmentTotal } from "@/lib/investments/types";
export function InvestmentSummary({ totals }: { totals: InvestmentTotal[] }) {
  return <section className="surface investment-summary"><SectionHeading title="Investasi" eyebrow="POSISI INSTRUMEN" icon={<ChartLineUp size={19} />} action={<Link href="/assets/investments" className="text-link">Kelola <ArrowRight size={16} /></Link>} />
    {!totals.length ? <p>Catat portofolio, posisi awal, atau transaksi investasi.</p> : sortNamed(totals, total => total.currency, total => total.currency).map((total) => <div className="investment-summary-currency" key={total.currency}><div><span><ResponsiveLabel compact="Nilai pasar">Nilai pasar berharga · {total.currency}</ResponsiveLabel></span><strong className="financial-value financial-value--summary">{formatMinor(total.marketMinor, total.currency, total.exponent)}</strong></div>
      <div><span><ResponsiveLabel compact="Unrealized">Laba/rugi belum terealisasi{total.unpricedCount ? " · posisi berharga" : ""}</ResponsiveLabel></span><strong className={`financial-value financial-value--summary ${BigInt(total.unrealizedMinor) < 0n ? "pnl-negative" : BigInt(total.unrealizedMinor) > 0n ? "pnl-positive" : ""}`}>{formatMinor(total.unrealizedMinor, total.currency, total.exponent)}</strong></div>
      {total.unpricedCount > 0 && <p className="investment-warning">{total.unpricedCount} posisi belum memiliki harga.</p>}</div>)}
  </section>;
}
