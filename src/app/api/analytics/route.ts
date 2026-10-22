import { NextRequest, NextResponse } from "next/server";
import { currentOwnerSession } from "@/lib/auth/session";
import { analyticsFilters } from "@/lib/analytics/filters";
import { AnalyticsInputError, readAnalytics, validateAnalyticsInput } from "@/lib/analytics/service";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  if (!await currentOwnerSession()) return reply({ error: "Sesi berakhir" }, 401);
  let input;
  try { input = analyticsFilters(request.nextUrl.searchParams); validateAnalyticsInput(input); }
  catch { return reply({ error: "Filter laporan tidak valid" }, 400); }
  try { return reply(await readAnalytics(input)); }
  catch (error) {
    return reply({ error: error instanceof AnalyticsInputError ? error.message : "Analytics belum dapat dimuat" }, error instanceof AnalyticsInputError ? 400 : 500);
  }
}
