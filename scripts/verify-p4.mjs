// Verification only: never reads .env.local or connects to the application database.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const container = JSON.parse(execFileSync("docker", ["inspect", "moneytor-p4-verify"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0];
assert.equal(container.State.Running, true);
assert.equal(container.Config.Image, "postgres:16-alpine");
assert.equal(container.Config.Labels["moneytor.verification"], "P4");
assert.equal(container.HostConfig.AutoRemove, true);
assert.deepEqual(container.HostConfig.PortBindings["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: "55434" }]);
const configuration = Object.fromEntries(container.Config.Env.map((item) => { const index = item.indexOf("="); return [item.slice(0, index), item.slice(index + 1)]; }));
assert.equal(configuration.POSTGRES_DB, "moneytor_p4_verify");
assert.equal(configuration.POSTGRES_USER, "moneytor_p4_verify");
assert.ok(configuration.POSTGRES_PASSWORD);
const target = new URL("postgresql://127.0.0.1:55434/moneytor_p4_verify");
target.username = configuration.POSTGRES_USER; target.password = configuration.POSTGRES_PASSWORD;
const environment = { ...process.env, DATABASE_URL: target.toString(), MONEYTOR_P4_DB_TEST: "moneytor_p4_verify", MONEYTOR_P3_DB_TEST: "moneytor_p4_verify" };
function run(args) {
  const result = spawnSync(process.execPath, args, { env: environment, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Verification command failed: ${args.join(" ")}`);
}
console.log("Disposable P4 container confirmed: loopback-only, dedicated database, random local credentials.");
run(["scripts/migrate.mjs", "--apply", "--confirm-db=moneytor_p4_verify"]);
run(["scripts/migrate.mjs", "--apply", "--confirm-db=moneytor_p4_verify"]);
const client = new pg.Client({ connectionString: target.toString() }); await client.connect();
try {
  const rows = (await client.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
  assert.equal(rows.length, 6);
  for (const row of rows) assert.equal(row.checksum, createHash("sha256").update(await readFile(new URL(`../db/migrations/${row.name}`, import.meta.url))).digest("hex"));
  console.log("Migrations 001-006 and recorded checksums verified; reapplication is safe.");
  run(["--conditions=react-server", "--test", "tests/investment-db.test.mjs"]);
  run(["--conditions=react-server", "--test", "tests/finance-db.test.mjs"]);
  const state = (await client.query(`SELECT (SELECT count(*)::int FROM assets) AS assets,
    (SELECT count(*)::int FROM financial_activities) AS activities,
    (SELECT count(*)::int FROM investment_transactions) AS trades,
    (SELECT count(*)::int FROM investment_opening_positions) AS openings,
    (SELECT count(*)::int FROM investment_portfolios) AS portfolios,
    (SELECT count(*)::int FROM investment_instruments) AS instruments,
    (SELECT count(*)::int FROM investment_price_points) AS prices,
    (SELECT count(*)::int FROM ledger_movements) AS movements,
    (SELECT count(*)::int FROM webauthn_credentials) AS credentials,
    (SELECT count(*)::int FROM information_schema.schemata WHERE schema_name LIKE 'p4_test_%' OR schema_name LIKE 'p3_test_%') AS test_schemas`)).rows[0];
  for (const count of Object.values(state)) assert.equal(count, 0);
  console.log("Public schema has no synthetic finance/auth records; temporary schemas removed. Container retained.");
} finally { await client.end(); }
