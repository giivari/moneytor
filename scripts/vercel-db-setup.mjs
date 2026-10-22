import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const ifConfigured = args.includes("--if-configured");
const resetEmpty = args.includes("--reset-empty");
const confirmEmpty = args.includes("--confirm-empty");

if (resetEmpty && !confirmEmpty) {
  throw new Error("To wipe all financial records back to an empty database, pass: --reset-empty --confirm-empty");
}

const connectionString = (
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  ""
).trim();
if (!connectionString) {
  if (ifConfigured) {
    console.log("[Vercel DB Setup] No DATABASE_URL/POSTGRES_URL configured during build; skipping migration step.");
    process.exit(0);
  }
  throw new Error("DATABASE_URL (or POSTGRES_URL) is required.");
}

const target = new URL(connectionString);
if (!/^(postgres:|postgresql:)$/.test(target.protocol)) {
  throw new Error("DATABASE_URL must use postgres:// or postgresql://");
}
const databaseName = decodeURIComponent(target.pathname.slice(1));
if (!databaseName || ["postgres", "template0", "template1"].includes(databaseName)) {
  throw new Error("Specify a named application database, not a maintenance database.");
}

const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
if (!files.length) throw new Error("No migration files found");

const migrations = await Promise.all(
  files.map(async (name) => {
    const sql = await readFile(join(directory, name), "utf8");
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }),
);

const useSsl =
  process.env.MONETA_DB_SSL === "require" ||
  process.env.MONETA_DB_SSL === "true" ||
  target.searchParams.get("sslmode") === "require";

const client = new pg.Client({
  connectionString,
  ...(useSsl ? { ssl: { rejectUnauthorized: process.env.MONETA_DB_SSL_REJECT_UNAUTHORIZED !== "false" } } : {}),
});

await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('moneta_schema_migrations'))");
  await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const installed = (await client.query("SELECT name, checksum FROM public.schema_migrations ORDER BY name")).rows;
  const applied = new Map(installed.map((row) => [row.name, row.checksum]));

  for (const migration of migrations) {
    const recorded = applied.get(migration.name);
    if (recorded) {
      if (recorded !== migration.checksum) {
        throw new Error(`Checksum drift on ${migration.name}`);
      }
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      await client.query("INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)", [
        migration.name,
        migration.checksum,
      ]);
      await client.query("COMMIT");
      console.log(`[Vercel DB Setup] Applied ${migration.name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  // Remove fictional placeholder catalog items ('Bank Contoh', 'Dompet Contoh', 'Platform Contoh', 'Jaringan Kartu Contoh')
  await client.query(`
    DELETE FROM public.financial_providers fp
    WHERE fp.system_key IN ('demo_bank', 'demo_wallet', 'demo_investment')
      AND NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.provider_id = fp.id)
      AND NOT EXISTS (SELECT 1 FROM public.investment_portfolios ip WHERE ip.provider_id = fp.id);
    UPDATE public.financial_providers
    SET is_builtin = false, system_key = NULL
    WHERE system_key IN ('demo_bank', 'demo_wallet', 'demo_investment');
    DELETE FROM public.payment_networks pn
    WHERE pn.system_key = 'demo_network'
      AND NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.payment_network_id = pn.id);
    UPDATE public.payment_networks
    SET is_builtin = false, system_key = NULL
    WHERE system_key = 'demo_network';
  `);

  if (resetEmpty && confirmEmpty) {
    const tablesToTruncate = [
      "import_staged_rows",
      "import_batches",
      "allocation_adjustment_audit_events",
      "allocation_adjustment_proposals",
      "allocation_assessments",
      "automation_occurrence_executions",
      "automation_occurrences",
      "automation_rule_actions",
      "automation_rule_conditions",
      "automation_rule_triggers",
      "automation_rule_versions",
      "automation_rules",
      "income_event_executions",
      "income_event_instances",
      "income_event_rules",
      "recurring_transaction_executions",
      "recurring_transaction_occurrences",
      "recurring_transaction_rules",
      "planning_reserves",
      "planning_obligations",
      "planning_goals",
      "planning_budgets",
      "investment_price_corrections",
      "investment_prices",
      "investment_trades",
      "investment_opening_corrections",
      "investment_opening_positions",
      "investment_instruments",
      "investment_portfolios",
      "ledger_movements",
      "activity_charges",
      "financial_activities",
      "asset_opening_corrections",
      "asset_opening_balances",
      "assets",
      "idempotency_keys",
      "home_layout_preferences",
    ];
    const existingTables = [];
    for (const tbl of tablesToTruncate) {
      const reg = await client.query("SELECT to_regclass($1) AS t", [`public.${tbl}`]);
      if (reg.rows[0]?.t) existingTables.push(`public.${tbl}`);
    }
    if (existingTables.length > 0) {
      await client.query(`TRUNCATE TABLE ${existingTables.join(", ")} CASCADE`);
      console.log(`[Vercel DB Setup] Emptied ${existingTables.length} financial/data tables (0 assets, 0 transactions).`);
    }
  }

  const summary = await client.query(`
    SELECT
      (SELECT count(*)::int FROM public.assets) AS assets,
      (SELECT count(*)::int FROM public.financial_activities) AS activities,
      (SELECT count(*)::int FROM public.investment_portfolios) AS portfolios,
      (SELECT count(*)::int FROM public.planning_budgets) AS budgets
  `);
  const counts = summary.rows[0];
  console.log(
    `[Vercel DB Setup] Ready (${migrations.length} migrations active). Current records: assets=${counts.assets}, activities=${counts.activities}, portfolios=${counts.portfolios}, budgets=${counts.budgets}.`,
  );
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('moneta_schema_migrations'))");
  await client.end();
}

