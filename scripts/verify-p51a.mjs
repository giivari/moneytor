import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import pg from "pg";

const contents = await readFile(new URL("../.env.local",import.meta.url),"utf8");
const line = contents.split(/\r?\n/).find((entry)=>/^DATABASE_URL=/.test(entry));
if (!line) throw new Error("Local DATABASE_URL is unavailable");
const value = line.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g,"");
const target = new URL(value);
if (target.hostname !== "127.0.0.1" || target.port !== "55433" || target.pathname !== "/moneta_p2_verify") {
  throw new Error("Unexpected local database target; verification stopped");
}
const application = new pg.Client({connectionString:target.toString()});
await application.connect();
try {
  const pending = await application.query("SELECT 1 FROM schema_migrations WHERE name='008_recurring_transactions.sql'");
  if (pending.rowCount) throw new Error("Migration 008 is already present in the application database; stop and inspect separately");
  console.log("Application database migration 008: pending");
} finally { await application.end(); }
const disposableName = "moneytor_p51a_verify";
target.pathname = "/postgres";
const maintenance = new pg.Client({connectionString:target.toString()});
await maintenance.connect();
try {
  if (process.argv.includes("--reset-disposable")) {
    const existing = await maintenance.query("SELECT 1 FROM pg_database WHERE datname=$1",[disposableName]);
    if (existing.rowCount) await maintenance.query(`DROP DATABASE ${disposableName} WITH (FORCE)`);
  }
  const exists = await maintenance.query("SELECT 1 FROM pg_database WHERE datname=$1",[disposableName]);
  if (!exists.rowCount) await maintenance.query(`CREATE DATABASE ${disposableName}`);
} finally { await maintenance.end(); }
target.pathname = `/${disposableName}`;
const env = { ...process.env,DATABASE_URL:target.toString(),MONEYTOR_AUTOMATION_DB_TEST:disposableName,
  MONEYTOR_P3_DB_TEST:disposableName,MONEYTOR_P5_DB_TEST:disposableName,MONEYTOR_P4_DB_TEST:disposableName };
for (let pass=0;pass<2;pass++) {
  const migration = spawnSync(process.execPath,["scripts/migrate.mjs","--apply",`--confirm-db=${disposableName}`],{env,stdio:"inherit"});
  if (migration.status !== 0) process.exit(migration.status ?? 1);
}
for (const file of ["tests/automation-domain.test.mjs","tests/automation-db.test.mjs","tests/finance-db.test.mjs","tests/planning-db.test.mjs","tests/investment-db.test.mjs"]) {
  const result = spawnSync(process.execPath,["--conditions=react-server","--test",file],{env,stdio:"inherit"});
  if (result.status !== 0) process.exit(result.status ?? 1);
}
