import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";

// Every write uses a fresh, named disposable database. Owner connections are read-only.
loadEnvFile(".env.local");
const ownerUrl = new URL(process.env.DATABASE_URL);
if (ownerUrl.hostname !== "127.0.0.1" || ownerUrl.port !== "55433" || ownerUrl.pathname !== "/moneta_p2_verify") throw Error("Unexpected owner target; stop before any writes");
const owner = new pg.Client({ connectionString: ownerUrl.toString() });
await owner.connect();
await owner.query("SET default_transaction_read_only=on");
async function fingerprint() {
  const tables = (await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const result = {};
  for (const { tablename } of tables) {
    const identifier = '"' + tablename.replaceAll('"', '""') + '"';
    result[tablename] = (await owner.query(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS hash FROM public.${identifier} t`)).rows[0];
  }
  return result;
}
const before = await fingerprint();
const ownerMigrations = (await owner.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
if (ownerMigrations.length !== 9 || ownerMigrations.at(-1).name !== "009_income_event_automation.sql") throw Error("Owner must remain on migration 009");
for (const item of ownerMigrations) if (createHash("sha256").update(await readFile(`db/migrations/${item.name}`, "utf8")).digest("hex") !== item.checksum) throw Error("Owner migration checksum mismatch");
const stamp = new Date().toISOString().replace(/\D/g, "");
const name = `moneytor_composable_verify_${stamp}`;
const maintenance = new URL(ownerUrl); maintenance.pathname = "/postgres";
const admin = new pg.Client({ connectionString: maintenance.toString() });
await admin.connect();
await admin.query(`CREATE DATABASE "${name}"`);
await admin.end();
const target = new URL(ownerUrl); target.pathname = `/${name}`;
const env = { ...process.env, DATABASE_URL: target.toString(), MONEYTOR_COMPOSABLE_DB_TEST: name,
  MONEYTOR_P3_DB_TEST: name, MONEYTOR_P4_DB_TEST: name, MONEYTOR_P5_DB_TEST: name, MONEYTOR_AUTOMATION_DB_TEST: name, MONEYTOR_EVENT_DB_TEST: name };
const run = (args) => {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error || result.status !== 0) throw Error(`Verification command failed: ${args.join(" ")}`);
};
let passed = false;
let migrationReplayNoOp = false;
try {
  console.log(`Disposable target: 127.0.0.1:55433/${name}`);
  run(["scripts/migrate.mjs", "--apply", `--confirm-db=${name}`]);
  const disposable = new pg.Client({connectionString:target.toString()}); await disposable.connect();
  const installedBefore = (await disposable.query("SELECT * FROM schema_migrations ORDER BY name")).rows;
  run(["scripts/migrate.mjs", "--apply", `--confirm-db=${name}`]);
  const installedAfter = (await disposable.query("SELECT * FROM schema_migrations ORDER BY name")).rows;
  migrationReplayNoOp = installedAfter.length === 10 && JSON.stringify(installedBefore) === JSON.stringify(installedAfter);
  await disposable.end();
  if (!migrationReplayNoOp) throw Error("Migration replay changed bookkeeping");
  run(["--test", "tests/composable-domain.test.mjs", "tests/automation-domain.test.mjs", "tests/income-event-domain.test.mjs", "tests/domain.test.mjs", "tests/investment-domain.test.mjs", "tests/planning-domain.test.mjs"]);
  run(["--conditions=react-server", "--test", "tests/composable-db.test.mjs", "tests/finance-db.test.mjs", "tests/investment-db.test.mjs", "tests/planning-db.test.mjs", "tests/automation-db.test.mjs", "tests/income-event-db.test.mjs"]);
  passed = true;
} finally {
  const after = await fingerprint();
  const preserved = JSON.stringify(before) === JSON.stringify(after);
  await owner.end();
  await mkdir(".env.local-backups", { recursive: true });
  const report = { database: name, verifiedAt: new Date().toISOString(), passed, migrationReplayNoOp, ownerTarget: "127.0.0.1:55433/moneta_p2_verify",
    ownerMigrationCount: ownerMigrations.length, ownerPreserved: preserved, ownerBefore: before, ownerAfter: after };
  await writeFile(`.env.local-backups/composable-verification-${stamp}.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ database: name, passed, migrationReplayNoOp, ownerPreserved: preserved, ownerMigrations: 9 }));
  if (!preserved) throw Error("Owner fingerprint changed during verification; investigate before acceptance");
}
