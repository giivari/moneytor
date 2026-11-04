import type { PoolClient } from "pg";

/**
 * Historical rows committed through CSV/XLSX import are receipts of the past, not new events. The P3
 * receipt triggers still record them with eligible_at = clock_timestamp(), so discovery must skip any
 * source whose root activity was created by an import batch.
 */
export const importedSourceExclusion =
  "AND NOT EXISTS(SELECT 1 FROM import_batch_rows imported WHERE imported.activity_id=s.root_activity_id)";

/** SQL predicate for discovery queries aliasing the receipt table as `s`; empty before migration 014. */
export async function importDiscoveryFilter(client: Pick<PoolClient, "query">): Promise<string> {
  const result = await client.query<{ ready: boolean }>("SELECT to_regclass('import_batch_rows') IS NOT NULL AS ready");
  return result.rows[0]?.ready ? importedSourceExclusion : "";
}
