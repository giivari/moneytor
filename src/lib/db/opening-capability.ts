import "server-only";
import type { Pool, PoolClient } from "pg";

const globalCapability = globalThis as unknown as {
  __moneytorOpeningCorrectionsReady?: boolean;
};

/** Migration 006 is activated separately on the owner's application database. */
export async function hasOpeningCorrections(connection: Pool | PoolClient): Promise<boolean> {
  if (globalCapability.__moneytorOpeningCorrectionsReady === true) {
    return true;
  }
  const result = await connection.query<{ ready: boolean }>(`SELECT
    to_regclass('asset_opening_corrections') IS NOT NULL
    AND to_regclass('investment_opening_corrections') IS NOT NULL AS ready`);
  const ready = Boolean(result.rows[0]?.ready);
  if (ready) {
    globalCapability.__moneytorOpeningCorrectionsReady = true;
  }
  return ready;
}
