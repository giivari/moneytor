import { financeSnapshot } from "@/lib/finance/summary";
import { isReserveSourceAsset } from "@/lib/domain/credit";
import { creditDebtThrough } from "@/lib/domain/net-worth";
import { horizonDay, planningToday } from "@/lib/domain/planning";
import { listPlanning } from "@/lib/planning/repository";
import { PlanningManager } from "@/components/planning-manager";

export const dynamic = "force-dynamic";
export default async function PlanningPage() {
  const planning = await listPlanning();
  if (!planning.ready) return <div className="page planning-page"><div className="page-heading"><div><span className="eyebrow">RENCANA KEUANGAN</span><h1>Rencana</h1></div></div>
    <section className="surface finance-empty"><h2>Rencana belum diaktifkan di database lokal</h2>
      <p>Migrasi 007_planning.sql perlu diterapkan sebelum Anda dapat mencatat rencana. Data keuangan yang ada tetap utuh.</p></section></div>;
  const snapshot = await financeSnapshot({ includeRecent: false, includeExpenses: false });
  const positions = snapshot.currencies.map(({ currency, exponent, liquidMinor, eligibleMinor }) => ({ currency, exponent, liquidMinor, eligibleMinor }));
  for (const plan of [...planning.budgets,...planning.goals,...planning.reserves,...planning.obligations]) {
    if (!positions.some((row) => row.currency === plan.currency)) positions.push({ currency: plan.currency,exponent: plan.exponent,liquidMinor: "0",eligibleMinor: "0" });
  }
  const sources = snapshot.assets.filter(isReserveSourceAsset)
    .map((asset) => ({ id: asset.id,name: asset.displayName,currency: asset.currency,balanceMinor: asset.balanceMinor }));
  // Credit bills due inside each horizon, from the same function financeSnapshot uses for Beranda.
  const today = planningToday(snapshot.throughDay);
  const creditDebt: Record<string, Record<number, string>> = {};
  for (const { currency } of positions) {
    creditDebt[currency] = Object.fromEntries([7, 30, 90].map((days) =>
      [days, creditDebtThrough(snapshot.assets, currency, horizonDay(today, days)).toString()]));
  }
  return <PlanningManager data={planning} positions={positions} sources={sources} throughDay={snapshot.throughDay} creditDebt={creditDebt} />;
}
