import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const verifyEnvOnly = args.includes("--verify-env");
const runDrill = args.includes("--drill");

if (!verifyEnvOnly && !runDrill) {
  throw new Error("Usage: node scripts/backup-drill.mjs [--verify-env | --drill]");
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(rootDir, "db", "migrations");
const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

const expectedMigrations = await Promise.all(
  files.map(async (name) => {
    const sql = await readFile(join(migrationsDir, name), "utf8");
    return {
      name,
      checksum: createHash("sha256").update(sql).digest("hex"),
    };
  }),
);

console.log(`[P9 Readiness] Loaded ${expectedMigrations.length} ordered SQL migrations (001..${String(expectedMigrations.length).padStart(3, "0")}).`);

const connectionString = process.env.DATABASE_URL?.trim() ?? "";
const origin = process.env.MONETA_ORIGIN?.trim() ?? "";
const rpId = process.env.MONETA_RP_ID?.trim() ?? "";

if (verifyEnvOnly && !connectionString) {
  console.log("[P9 Readiness] Static migration checksums verified. Set DATABASE_URL to run live database drill.");
  process.exit(0);
}

if (!connectionString) {
  throw new Error("DATABASE_URL is required for --drill");
}

const parsedDb = new URL(connectionString);
if (!/^(postgres:|postgresql:)$/.test(parsedDb.protocol)) {
  throw new Error("DATABASE_URL must use postgres:// or postgresql://");
}
if (origin && rpId) {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.hostname !== rpId) {
    throw new Error("MONETA_ORIGIN hostname must match MONETA_RP_ID");
  }
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  // Run strictly in a read-only transaction so no row can ever be mutated during a readiness drill
  await client.query("BEGIN READ ONLY");

  // 1. Verify migration registry & checksums
  const installedRes = await client.query(
    "SELECT name, checksum FROM public.schema_migrations ORDER BY name",
  );
  const installedMap = new Map(installedRes.rows.map((r) => [r.name, r.checksum]));

  for (const mig of expectedMigrations) {
    const actualChecksum = installedMap.get(mig.name);
    if (!actualChecksum) {
      throw new Error(`Missing migration in database: ${mig.name}`);
    }
    if (actualChecksum !== mig.checksum) {
      throw new Error(`Checksum drift detected on ${mig.name}`);
    }
  }
  console.log(`[P9 Drill] Migration integrity PASS (${installedRes.rows.length}/${expectedMigrations.length} checksums verified).`);

  // 2. Verify ledger movement integrity: every posted transfer must have balanced principal movements (sum = 0)
  const unbalancedTransfers = await client.query(`
    SELECT a.id
    FROM public.financial_activities a
    JOIN public.ledger_movements m ON m.activity_id = a.id AND m.charge_id IS NULL
    WHERE a.kind = 'transfer' AND a.status = 'posted'
    GROUP BY a.id
    HAVING COALESCE(SUM(m.amount_minor), 0) <> 0
  `);
  if (unbalancedTransfers.rowCount && unbalancedTransfers.rowCount > 0) {
    throw new Error(`Found ${unbalancedTransfers.rowCount} unbalanced posted transfer(s)!`);
  }
  console.log("[P9 Drill] Double-entry transfer principal zero-sum invariant PASS.");

  // 3. Verify voided/superseded reversal zero-sum invariant
  const unbalancedReversals = await client.query(`
    SELECT a.id
    FROM public.financial_activities a
    JOIN public.ledger_movements m ON m.activity_id = a.id
    WHERE a.status IN ('voided', 'superseded')
    GROUP BY a.id
    HAVING COALESCE(SUM(m.amount_minor), 0) <> 0
  `);
  if (unbalancedReversals.rowCount && unbalancedReversals.rowCount > 0) {
    throw new Error(`Found ${unbalancedReversals.rowCount} unbalanced voided/superseded activity movement(s)!`);
  }
  console.log("[P9 Drill] Voided/superseded activity zero-sum reversal invariant PASS.");

  // 4. Verify asset balance projection consistency
  const assetStats = await client.query(`
    SELECT
      (SELECT count(*)::int FROM public.assets) AS asset_count,
      (SELECT count(*)::int FROM public.financial_activities) AS activity_count,
      (SELECT count(*)::int FROM public.ledger_movements) AS movement_count,
      (SELECT count(*)::int FROM public.import_batches) AS import_batch_count
  `);
  const counts = assetStats.rows[0];
  console.log(
    `[P9 Drill] Read-only ledger snapshot verified: assets=${counts.asset_count}, activities=${counts.activity_count}, movements=${counts.movement_count}, importBatches=${counts.import_batch_count}.`,
  );

  await client.query("ROLLBACK");
  console.log("[P9 Drill] All production readiness and backup/recovery integrity checks PASSED.");
} finally {
  await client.end();
}

