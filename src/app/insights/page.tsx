import { requireOwnerSession } from "@/lib/auth/session";
import { analyticsCurrencyOptions, readAnalytics, validateAnalyticsInput } from "@/lib/analytics/service";
import { analyticsFilters } from "@/lib/analytics/filters";
import type { AnalyticsReport } from "@/lib/analytics/types";
import { InsightsWorkspace } from "@/components/insights-workspace";
import "./insights.css";

export const dynamic = "force-dynamic";

export default async function InsightsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwnerSession();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.append(key, value);
  }
  let currencies: { currency: string; exponent: number }[] = [];
  let initial: AnalyticsReport | null = null, error = "";
  try { currencies = await analyticsCurrencyOptions(); }
  catch { error = "Daftar mata uang belum dapat dimuat. Coba muat ulang halaman."; }
  if (!params.has("period")) params.set("period", "current_month");
  if (!params.has("currency") && currencies.length) {
    params.set("currency", currencies.find((row) => row.currency === "IDR")?.currency ?? currencies[0].currency);
  }
  let filters: ReturnType<typeof analyticsFilters> | undefined;
  try { filters = analyticsFilters(params); validateAnalyticsInput(filters); }
  catch (cause) { filters = undefined; error = cause instanceof Error ? cause.message : "Filter laporan tidak valid."; }
  if (filters) {
    try { initial = await readAnalytics(filters); }
    catch { error = "Laporan belum dapat dimuat. Periksa filter atau coba lagi."; }
  }
  return <div className="page insights-page">
    <div className="page-heading"><div><span className="eyebrow">PAHAMI POLANYA</span><h1>Insights</h1>
      <p>Pemasukan, belanja, dan konteks keuangan dari transaksi yang tercatat.</p></div></div>
    <InsightsWorkspace key={params.toString()} initial={initial} initialQuery={params.toString()} initialError={error} currencies={currencies} />
  </div>;
}
