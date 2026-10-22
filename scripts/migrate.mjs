import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const listOnly = args.length === 1 && args[0] === "--list";
const statusOnly = args.length === 1 && args[0] === "--status";
const apply = args.includes("--apply");
const confirmation = args.find((arg) => arg.startsWith("--confirm-db="))?.slice("--confirm-db=".length);
if (!listOnly && !statusOnly && (!apply || !confirmation || args.length !== 2)) {
  throw new Error("Use --list, --status, or --apply --confirm-db=<database name>");
}

const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const files = await readdir(directory);
const names = files.filter((name) => name.endsWith(".sql")).sort();
if (!names.length) throw new Error("No migration files found");
for (const [index, name] of names.entries()) {
  if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(name) || Number(name.slice(0, 3)) !== index + 1) {
    throw new Error("Migrations must use consecutive 001_name.sql filenames");
  }
}
const migrations = await Promise.all(names.map(async (name) => {
  const sql = await readFile(join(directory, name), "utf8");
  return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
}));
if (listOnly) {
  for (const migration of migrations) console.log(`${migration.name} ${migration.checksum}`);
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const target = new URL(connectionString);
if (!/^(postgres:|postgresql:)$/.test(target.protocol)) throw new Error("DATABASE_URL must be PostgreSQL");
const databaseName = decodeURIComponent(target.pathname.slice(1));
if (!databaseName || ["postgres", "template0", "template1"].includes(databaseName)) {
  throw new Error("Specify a named application database, not a maintenance database");
}
if (apply && confirmation !== databaseName) throw new Error("Confirmed database name does not match DATABASE_URL");

const client = new pg.Client({ connectionString });
await client.connect();
try {
  if (apply) {
    await client.query("SELECT pg_advisory_lock(hashtext('moneta_schema_migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  }
  const exists = await client.query("SELECT to_regclass('public.schema_migrations') AS table_name");
  const installed = exists.rows[0].table_name
    ? (await client.query("SELECT name, checksum FROM public.schema_migrations ORDER BY name")).rows
    : [];
  const applied = new Map(installed.map((row) => [row.name, row.checksum]));
  for (const row of installed) {
    if (!migrations.some((migration) => migration.name === row.name)) throw new Error(`Unknown applied migration: ${row.name}`);
  }
  for (const migration of migrations) {
    const recorded = applied.get(migration.name);
    if (recorded && recorded !== migration.checksum) throw new Error(`Checksum drift: ${migration.name}`);
    if (!recorded && installed.some((row) => row.name > migration.name)) {
      throw new Error(`Migration gap before ${migration.name}`);
    }
  }
  for (const migration of migrations) {
    const recorded = applied.get(migration.name);
    if (recorded) {
      console.log(`applied ${migration.name}`);
      continue;
    }
    if (statusOnly) {
      console.log(`pending ${migration.name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      await client.query("INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)", [migration.name, migration.checksum]);
      await client.query("COMMIT");
      console.log(`applied ${migration.name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  if (apply) console.log("migration sequence complete");
} finally {
  if (apply) await client.query("SELECT pg_advisory_unlock(hashtext('moneta_schema_migrations'))");
  await client.end();
}
