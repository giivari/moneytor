import { AppLink as Link } from "./app-link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { FinanceActivity, FinanceAsset } from "@/lib/finance/types";
import { formatMinor } from "@/lib/finance/format";
import { computeCreditBills, isReceivableAsset } from "@/lib/domain/credit";
import { installmentContracts, type CreditStatus } from "@/lib/domain/credit-overview";
import { InspectorFacts } from "./inspector-facts";
import { RefundExpenseButton, RepayDebtButton, SettleReceivableButton } from "./pay-bill-button";
import { Amount, Chip, monthLabel, shortDate, toneOf } from "./ui";
import { ICON_SM } from "./icon-size";

/** Inspector bodies for each entity, rendered on the server and handed to InspectorRow. */

const activityKindLabels: Record<FinanceActivity["kind"], string> = {
  income: "Pemasukan",
  expense: "Pengeluaran",
  transfer: "Transfer",
  borrow: "Pinjam",
  repay: "Lunas",
  refund: "Refund",
  adjustment: "Koreksi",
};

export function activityParts(item: FinanceActivity) {
  const isFlow = item.kind === "transfer" || item.kind === "borrow" || item.kind === "repay";
  const charges = item.charges.reduce((sum, charge) => sum + BigInt(charge.amountMinor), 0n);
  const total = isFlow ? BigInt(item.baseAmountMinor) : BigInt(item.baseAmountMinor) + charges;
  const sign = item.kind === "expense" ? "−" : item.kind === "income" ? "+" : "";
  const kind = activityKindLabels[item.kind];
  const accounts = item.sourceName && item.destinationName ? `${item.sourceName} → ${item.destinationName}` : (item.sourceName || item.destinationName || "");
  return { total, sign, kind, accounts };
}

export function ActivityDetail({ item }: { item: FinanceActivity }) {
  const money = (value: string | bigint) => formatMinor(value, item.currency, item.exponent);
  const { total, sign, kind, accounts } = activityParts(item);
  const isFlow = item.kind === "transfer" || item.kind === "borrow" || item.kind === "repay";
  const occurred = new Date(item.occurredAt).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });
  const refundableMinor = item.netMinor ?? item.baseAmountMinor;
  const canRefund = item.kind === "expense" && (item.status ?? "posted") === "posted" && BigInt(refundableMinor) > 0n;
  return <>
    <InspectorFacts items={[
      { label: "Jenis", value: kind },
      { label: "Waktu", value: occurred },
      { label: isFlow ? "Alur rekening" : "Rekening", value: accounts || "—" },
      ...(item.categoryName ? [{ label: "Kategori", value: item.categoryName }] : []),
      ...(item.recurringRuleName ? [{ label: "Otomatisasi", value: item.recurringRuleName }] : []),
      { label: "Jumlah dasar", value: <Amount value={money(item.baseAmountMinor)} /> },
      ...item.charges.map((charge) => ({ label: charge.typeName, value: <Amount value={money(charge.amountMinor)} /> })),
      { label: isFlow ? "Dipindahkan" : "Total mutasi", value: <Amount value={`${sign}${money(total)}`} tone={item.kind === "expense" ? "negative" : item.kind === "income" ? "positive" : ""} /> },
      ...(item.refundedMinor && BigInt(item.refundedMinor) > 0n ? [
        { label: "Di-refund", value: <Amount value={money(item.refundedMinor)} tone="positive" /> },
        { label: "Pengeluaran bersih", value: <Amount value={money(refundableMinor)} /> },
      ] : []),
    ]} />
    {item.note && <p className="inspector-note">{item.note}</p>}
    {canRefund && <div className="finance-actions"><RefundExpenseButton activityId={item.id} sourceAssetId={item.sourceAssetId} exponent={item.exponent} refundableMinor={refundableMinor} note={item.note} /></div>}
    <Link href="/transactions" className="text-link">Buka di Mutasi <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>
  </>;
}

export const creditStatusLabel: Record<CreditStatus, { label: string; tone: "negative" | "warning" | "positive" | "neutral" }> = {
  tagihan: { label: "Tagihan berjalan", tone: "negative" },
  cicilan: { label: "Cicilan berjalan", tone: "warning" },
  lunas: { label: "Lunas", tone: "positive" },
  "lebih-bayar": { label: "Lebih bayar", tone: "positive" },
};

export function CreditDetail({ asset, link = true }: { asset: FinanceAsset; link?: boolean }) {
  const bills = computeCreditBills(asset);
  const money = (value: bigint) => formatMinor(value, asset.currency, asset.exponent);
  const contracts = installmentContracts(asset);
  const currentPeriod = bills.currentDueIso.slice(0, 7);
  return <>
    <InspectorFacts items={[
      { label: "Klasifikasi", value: "Kewajiban" },
      { label: "Saldo tercatat", value: <Amount value={formatMinor(asset.balanceMinor, asset.currency, asset.exponent)} tone={toneOf(BigInt(asset.balanceMinor))} /> },
      { label: `Tagihan jatuh tempo ${shortDate(bills.currentDueIso)}`, value: <Amount value={money(bills.currentBillMinor)} /> },
      { label: `Tagihan ${shortDate(bills.nextDueIso)}`, value: <Amount value={money(bills.nextBillMinor)} /> },
      { label: "Cicilan bulan berikutnya", value: <Amount value={money(bills.laterBillMinor)} /> },
      { label: "Sisa seluruh utang", value: <Amount value={money(bills.totalUnpaidMinor)} tone={bills.totalUnpaidMinor > 0n ? "negative" : ""} /> },
      ...(bills.overpaidMinor > 0n ? [{ label: "Lebih bayar", value: <Amount value={money(bills.overpaidMinor)} tone="positive" /> }] : []),
      ...(bills.limitMinor > 0n ? [{ label: "Limit", value: <Amount value={money(bills.limitMinor)} /> }] : []),
      ...(bills.availableLimitMinor !== null ? [{ label: "Sisa limit", value: <Amount value={money(bills.availableLimitMinor)} /> }] : []),
      { label: "Tanggal cetak / jatuh tempo", value: `${bills.cutoffDay} / ${bills.dueDay} tiap bulan` },
      { label: "Status", value: asset.isActive ? "Aktif" : "Diarsipkan" },
    ]} />
    {contracts.map((contract) => <section key={contract.activityId} className="inspector-section">
      <h3>Cicilan {contract.count} bulan · {monthLabel(contract.firstPeriod)} – {monthLabel(contract.lastPeriod)}</h3>
      <ol className="inspector-schedule">{contract.rows.map((row) => <li key={row.seq}>
        <span>
          {row.seq}. {monthLabel(row.period)}
          {BigInt(row.interestMinor) > 0n
            ? ` (Pokok ${money(BigInt(row.principalMinor))} + Bunga ${money(BigInt(row.interestMinor))})`
            : ""}
        </span>
        {row.period < currentPeriod ? <Chip tone="neutral">Lewat</Chip> : <Chip tone="info">Akan ditagih</Chip>}
        <Amount value={money(BigInt(row.principalMinor) + BigInt(row.interestMinor))} />
      </li>)}</ol>
    </section>)}
    {contracts.length > 0 && <p className="ui-muted inspector-note">Status bayar tiap bulan dihitung dari saldo akun, bukan dari jadwal.</p>}
    {asset.isActive && bills.totalUnpaidMinor > 0n && <div className="finance-actions"><RepayDebtButton assetId={asset.id} name={asset.displayName} exponent={asset.exponent} amountMinor={bills.totalUnpaidMinor.toString()} /></div>}
    {link && <Link href="/credit" className="text-link">Buka Kredit &amp; Talangan <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>}
  </>;
}

export function AssetDetail({ asset, link = "/assets" }: { asset: FinanceAsset; link?: string | null }) {
  const money = (value: string) => formatMinor(value, asset.currency, asset.exponent);
  const classLabel = asset.assetClass === "liability" ? "Kewajiban" : isReceivableAsset(asset) ? "Piutang" : "Aset";
  return <>
    <InspectorFacts items={[
      { label: "Jenis", value: [asset.assetTypeName, asset.providerName].filter(Boolean).join(" · ") },
      { label: "Klasifikasi", value: classLabel },
      { label: "Likuid", value: asset.normallyLiquid ? "Ya" : "Tidak" },
      { label: "Dapat dipakai belanja", value: asset.normallySpendable ? "Ya" : "Tidak" },
      { label: "Status", value: asset.isActive ? "Aktif" : "Diarsipkan" },
      { label: "Saldo awal", value: <Amount value={money(asset.openingMinor)} /> },
      { label: "Saldo saat ini", value: <Amount value={money(asset.balanceMinor)} tone={toneOf(BigInt(asset.balanceMinor))} /> },
    ]} />
    {asset.isActive && isReceivableAsset(asset) && BigInt(asset.balanceMinor) > 0n && <div className="finance-actions"><SettleReceivableButton assetId={asset.id} name={asset.displayName} exponent={asset.exponent} amountMinor={asset.balanceMinor} /></div>}
    {link && <Link href={link} className="text-link">Buka Aset <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>}
  </>;
}
