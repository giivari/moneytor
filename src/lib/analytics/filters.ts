import { PERIOD_PRESET_KINDS, type AnalyticsGranularity, type PeriodInput, type PeriodPresetKind } from "./periods.ts";
const GRANULARITIES = new Set<AnalyticsGranularity>(["auto", "day", "week", "month", "year"]);
const PRESET_SET = new Set<string>(PERIOD_PRESET_KINDS);

export function analyticsFilters(params: URLSearchParams) {
  const allowed = new Set(["period", "start", "end", "months", "currency", "context", "granularity"]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) throw Error("Filter laporan tidak valid");
  const kind = params.get("period") ?? "current_month";
  let period: PeriodInput;
  if (kind === "custom") {
    if (!params.has("start") || !params.has("end") || params.has("months")) throw Error("Rentang khusus tidak lengkap");
    period = { kind, startDay: params.get("start")!, endDay: params.get("end")! };
  } else {
    if (params.has("start") || params.has("end")) throw Error("Tanggal hanya untuk rentang khusus");
    if (kind === "monthly_trend") {
      const raw = params.get("months") ?? "6";
      if (!/^[1-9]\d?$/.test(raw)) throw Error("Jumlah bulan tidak valid");
      period = { kind, months: Number(raw) };
    } else {
      if (!PRESET_SET.has(kind) || params.has("months")) throw Error("Periode laporan tidak valid");
      period = { kind: kind as PeriodPresetKind };
    }
  }
  const context = params.get("context");
  if (context !== null && context !== "true" && context !== "false") throw Error("Filter konteks tidak valid");
  const currency = params.get("currency") ?? undefined;
  if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) throw Error("Mata uang tidak valid");
  const rawGranularity = params.get("granularity");
  if (rawGranularity !== null && !GRANULARITIES.has(rawGranularity as AnalyticsGranularity)) {
    throw Error("Granularitas laporan tidak valid");
  }
  return {
    period,
    currency,
    includeContext: context !== "false",
    ...(rawGranularity ? { granularity: rawGranularity as AnalyticsGranularity } : {}),
  };
}
