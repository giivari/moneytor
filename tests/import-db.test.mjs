import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const confirmedDatabase = process.env.MONEYTOR_P4_DB_TEST;
const enabled = ["moneytor_p4_verify", "moneytor_p5_verify", "moneytor_p51a_verify", "moneytor_p51b_verify"].includes(confirmedDatabase) || /^moneytor_composable_verify_\d+$/.test(confirmedDatabase ?? "");

test("P7 isolated disposable PostgreSQL import preview, duplicate detection, commit, and traceability", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  const admin = new pg.Client({ connectionString: target.toString() });
  await admin.connect();
  const schema = `p7_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema}`);
  let pool, hooks;
  try {
    for (const file of (await readdir(new URL("../db/migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort()) {
      await admin.query(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
    }
    target.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = target.toString();
    globalThis.__importTestAuthorized = true;
    hooks = registerHooks({
      resolve(specifier, context, next) {
        if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
        if (specifier === "@/lib/auth/session") {
          return {
            url: "data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__importTestAuthorized)throw new Error('Unauthorized');return {credentialId:'synthetic-test'}}",
            shortCircuit: true,
          };
        }
        if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
        if (specifier.startsWith("./") && context.parentURL?.endsWith(".ts") && !specifier.endsWith(".ts")) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
        return next(specifier, context);
      },
    });

    const { database } = await import("../src/lib/db/pool.ts");
    pool = database();
    const { insertAssetWithOpening, listAssets } = await import("../src/lib/repositories/assets.ts");
    const { postActivity, listActivities } = await import("../src/lib/finance/service.ts");
    const { previewImportFile, commitImportBatch, listImportBatches } = await import("../src/lib/imports/service.ts");

    const assetType = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const bniId = await insertAssetWithOpening({
      displayName: "BNI Taplus Muda",
      currency: "IDR",
      assetTypeId: assetType,
      normallyLiquid: true,
      normallySpendable: true,
      openingAmountMinor: 1000000n,
      openingEffectiveAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    const cashId = await insertAssetWithOpening({
      displayName: "Cash Wallet",
      currency: "IDR",
      assetTypeId: assetType,
      normallyLiquid: true,
      normallySpendable: true,
      openingAmountMinor: 100000n,
      openingEffectiveAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    // Pre-post one transaction that overlaps with the CSV
    await postActivity({
      kind: "expense",
      amountMinor: "5000",
      sourceAssetId: bniId,
      occurredAt: "2026-09-20T00:00:00.000Z",
      note: "yourtea",
    }, randomUUID());

    const csv = [
      "Date,Type,Account,To Account,Category,Description,Amount (Rp),Status",
      "2026-09-20,Expense,BNI Taplus Muda,,Makan,yourtea,5000,Posted",
      "2026-09-20,Transfer,BNI Taplus Muda,Cash Wallet,Transfer,tarik tunai,50000,Posted",
      "2026-09-21,Expense,Cash Wallet,,Kategori Baru Impor, nasi padang ,25000,Posted",
    ].join("\n");
    const contentBase64 = Buffer.from(csv, "utf8").toString("base64");

    await t.test("preview detects existing ledger duplicate and suggests mappings", async () => {
      const preview = await previewImportFile({ fileName: "sample.csv", contentBase64 });
      assert.equal(preview.summary.totalRows, 3);
      assert.equal(preview.summary.duplicateCount, 1);
      assert.equal(preview.summary.readyCount, 2);
      assert.equal(preview.rows[0].status, "duplicate");
      assert.equal(preview.rows[0].defaultSelected, false);
      assert.equal(preview.rows[1].status, "ready");
      assert.equal(preview.rows[2].status, "ready");
      assert.equal(preview.rows[2].willCreateCategory, true);
    });

    await t.test("commit posts selected rows, creates missing category, and records immutable traceability batch", async () => {
      const key = randomUUID();
      const committed = await commitImportBatch({
        fileName: "sample.csv",
        contentBase64,
        selectedRowNumbers: [3, 4],
        idempotencyKey: key,
      });
      assert.equal(committed.importedCount, 2);
      assert.equal(committed.skippedCount, 1);
      assert.equal(committed.createdCategoriesCount, 1);

      // Idempotent retry returns identical batch result
      const retry = await commitImportBatch({
        fileName: "sample.csv",
        contentBase64,
        selectedRowNumbers: [3, 4],
        idempotencyKey: key,
      });
      assert.deepEqual(retry, committed);

      const assets = await listAssets();
      assert.equal(assets.find((a) => a.id === bniId).balanceMinor, "945000");
      assert.equal(assets.find((a) => a.id === cashId).balanceMinor, "125000");
      assert.equal((await listActivities()).length, 3);

      const batches = await listImportBatches();
      assert.equal(batches.length, 1);
      assert.equal(batches[0].id, committed.batchId);

      // Subsequent preview flags all 3 rows as duplicates (1 ledger + 2 fingerprint)
      const secondPreview = await previewImportFile({ fileName: "sample.csv", contentBase64 });
      assert.equal(secondPreview.summary.duplicateCount, 3);
      assert.equal(secondPreview.summary.readyCount, 0);

      // Append-only triggers protect import_batches and import_batch_rows
      await assert.rejects(admin.query("DELETE FROM import_batch_rows WHERE batch_id=$1", [committed.batchId]), /append-only/);
      await assert.rejects(admin.query("DELETE FROM import_batches WHERE id=$1", [committed.batchId]), /append-only/);
    });
  } finally {
    hooks?.deregister();
    if (pool) await pool.end();
    await admin.query("RESET search_path");
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

