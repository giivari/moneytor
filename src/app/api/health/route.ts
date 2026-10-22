import { NextResponse } from "next/server";
import { database } from "@/lib/db/pool";
import { validateProductionEnvironment } from "@/lib/ops/production-readiness";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  const envReport = validateProductionEnvironment(process.env as Record<string, string | undefined>);
  const url = new URL(request.url);
  const checkDb = url.searchParams.get("probe") !== "liveness";

  let dbReachable = true;
  let migrationsReady = true;

  if (checkDb && envReport.ready) {
    try {
      const pool = database();
      const result = await pool.query<{ mig_count: string }>(
        `SELECT CASE
           WHEN to_regclass('public.schema_migrations') IS NULL THEN '0'
           ELSE (SELECT count(*)::text FROM public.schema_migrations)
         END AS mig_count`,
      );
      const appliedCount = Number(result.rows[0]?.mig_count ?? "0");
      migrationsReady = appliedCount >= 14;
    } catch {
      dbReachable = false;
      migrationsReady = false;
    }
  }

  const healthy = envReport.ready && dbReachable && migrationsReady;
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt));

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks: {
        environment: envReport.ready ? "ok" : "invalid",
        database: checkDb ? (dbReachable ? "ok" : "unreachable") : "skipped",
        migrations: checkDb ? (migrationsReady ? "ok" : "incomplete") : "skipped",
      },
      durationMs,
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

