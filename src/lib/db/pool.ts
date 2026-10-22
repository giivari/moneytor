import "server-only";
import { Pool, type PoolClient, type PoolConfig } from "pg";

const globalPool = globalThis as unknown as {
  __moneytorDbPool?: { pool: Pool; connectionString: string };
};

function resolvePoolMax(): number {
  const raw = process.env.MONETA_DB_POOL_MAX?.trim();
  if (!raw) return 5;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 25) {
    return parsed;
  }
  return 5;
}

export function database(): Pool {
  const connectionString = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!globalPool.__moneytorDbPool || globalPool.__moneytorDbPool.connectionString !== connectionString) {
    const config: PoolConfig = {
      connectionString,
      max: resolvePoolMax(),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    };
    if (process.env.MONETA_DB_SSL === "require" || process.env.MONETA_DB_SSL === "true") {
      config.ssl = { rejectUnauthorized: process.env.MONETA_DB_SSL_REJECT_UNAUTHORIZED !== "false" };
    }
    globalPool.__moneytorDbPool = {
      pool: new Pool(config),
      connectionString,
    };
  }
  return globalPool.__moneytorDbPool.pool;
}

export async function inDatabaseTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}
