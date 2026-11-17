import "server-only";
import type { Pool, PoolClient } from "pg";

const globalReadiness = globalThis as unknown as { __moneytorReadyTables?: Set<string> };
function known(): Set<string> {
  return (globalReadiness.__moneytorReadyTables ??= new Set<string>());
}
const identifier = /^[a-z_][a-z0-9_]*$/;

/**
 * Cek keberadaan tabel (migrasi terpasang) tanpa round-trip berulang. Hanya hasil "ada" yang di-cache per proses:
 * migrasi tidak pernah menghapus tabel, sedangkan "belum ada" bisa berubah setelah migrasi diterapkan, jadi selalu dicek ulang.
 * Nama tabel adalah konstanta kode (bukan input pengguna) dan divalidasi sebelum masuk ke SQL.
 */
export async function tableFlags<K extends string>(
  connection: Pool | PoolClient,
  tables: Record<K, string>,
): Promise<Record<K, boolean>> {
  const entries = Object.entries(tables) as [K, string][];
  const flags = {} as Record<K, boolean>;
  const pending: [K, string][] = [];
  for (const [key, table] of entries) {
    if (!identifier.test(table)) throw new Error(`Invalid table name: ${table}`);
    if (known().has(table)) flags[key] = true;
    else pending.push([key, table]);
  }
  if (pending.length) {
    const select = pending.map(([key, table]) => `to_regclass('${table}') IS NOT NULL AS ${key}`).join(", ");
    const result = await (connection as Pool).query<Record<string, boolean>>(`SELECT ${select}`);
    const row = result.rows[0] ?? {};
    for (const [key, table] of pending) {
      const ready = Boolean(row[key]);
      flags[key] = ready;
      if (ready) known().add(table);
    }
  }
  return flags;
}

/** True bila semua tabel ada. Satu round-trip pada panggilan pertama, nol sesudahnya. */
export async function tablesReady(connection: Pool | PoolClient, ...tables: string[]): Promise<boolean> {
  if (tables.every((table) => known().has(table))) return true;
  const keyed: Record<string, string> = {};
  tables.forEach((table, index) => { keyed[`t${index}`] = table; });
  const flags = await tableFlags(connection, keyed);
  return Object.values(flags).every(Boolean);
}

/** Hanya untuk tes: lupakan hasil cache agar probe berikutnya kembali ke database. */
export function resetReadinessCache(): void {
  known().clear();
}
