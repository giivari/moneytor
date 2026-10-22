import "server-only";
import type { Pool, PoolClient } from "pg";

/** Migration 006 is activated separately on the owner's application database. */
export async function hasOpeningCorrections(connection: Pool | PoolClient): Promise<boolean> {
  const result = await connection.query<{ ready: boolean }>(`SELECT
    to_regclass('asset_opening_corrections') IS NOT NULL
    AND to_regclass('investment_opening_corrections') IS NOT NULL AS ready`);
  return result.rows[0].ready;
}
