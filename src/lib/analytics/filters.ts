import type { PeriodInput } from "./periods";
export function analyticsFilters(params: URLSearchParams) {
  const allowed = new Set(["period", "start", "end", "months", "currency", "context"]);
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
      if (!["current_month", "previous_month", "current_year"].includes(kind) || params.has("months")) throw Error("Periode laporan tidak valid");
      period = { kind: kind as "current_month" | "previous_month" | "current_year" };
    }
  }
  const context = params.get("context");
  if (context !== null && context !== "true" && context !== "false") throw Error("Filter konteks tidak valid");
  const currency = params.get("currency") ?? undefined;
  if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) throw Error("Mata uang tidak valid");
  return { period, currency, includeContext: context !== "false" };
}
