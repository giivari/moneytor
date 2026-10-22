import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { requireOwnerSession } from "@/lib/auth/session";
import { database, inDatabaseTransaction } from "@/lib/db/pool";
import { assertUuid, validateCatalogName } from "@/lib/domain/catalog";
import { postActivityInTransaction } from "@/lib/finance/service";
import type { ActivityDraft } from "@/lib/finance/types";
import { ImportValidationError, parseImportPayload } from "./parser";
import type { ImportBatchSummary, ImportColumnMapping, ImportPreviewResult, StagedPreviewRow } from "./types";

type ActiveAssetRow = { id: string; display_name: string; currency_code: string; minor_unit_exponent: number };
type ActiveCategoryRow = { id: string; display_name: string; applies_to: "income" | "expense" };

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function suggestAssetId(rawName: string, assets: ActiveAssetRow[]): string | null {
  const target = normalizeLabel(rawName);
  if (!target) return null;
  const exact = assets.find((a) => normalizeLabel(a.display_name) === target);
  if (exact) return exact.id;
  const partial = assets.find((a) => {
    const candidate = normalizeLabel(a.display_name);
    return candidate.includes(target) || target.includes(candidate);
  });
  return partial?.id ?? null;
}

function suggestCategoryId(rawName: string, kind: "income" | "expense", categories: ActiveCategoryRow[]): string | null {
  const target = normalizeLabel(rawName);
  if (!target) return null;
  const exact = categories.find((c) => c.applies_to === kind && normalizeLabel(c.display_name) === target);
  return exact?.id ?? null;
}

function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function hasImportsSchema(client: Pick<PoolClient, "query">): Promise<boolean> {
  const row = (await client.query<{ ready: boolean }>("SELECT to_regclass('import_batches') IS NOT NULL AS ready")).rows[0];
  return Boolean(row?.ready);
}

async function buildStagedPreview(
  client: Pick<PoolClient, "query">,
  input: {
    fileName: string;
    contentBase64: string;
    sheetName?: string;
    columnMapping?: Partial<ImportColumnMapping>;
    accountMap?: Record<string, string>;
    categoryMap?: Record<string, string>;
    autoCreateCategories?: boolean;
  },
): Promise<ImportPreviewResult> {
  const cleanFileName = input.fileName.trim().slice(0, 240);
  if (!cleanFileName) throw new ImportValidationError("Nama file tidak valid.");

  const assetRows = (await client.query<ActiveAssetRow>(
    `SELECT a.id, a.display_name, a.currency_code, c.minor_unit_exponent
     FROM assets a JOIN currencies c ON c.code = a.currency_code
     WHERE a.is_active ORDER BY a.created_at, a.id`,
  )).rows;

  const categoryRows = (await client.query<ActiveCategoryRow>(
    `SELECT id, display_name, applies_to
     FROM transaction_categories
     WHERE is_active ORDER BY created_at, id`,
  )).rows;

  const defaultExponent = assetRows[0]?.minor_unit_exponent ?? 0;
  const parsed = parseImportPayload({
    fileName: cleanFileName,
    contentBase64: input.contentBase64,
    sheetName: input.sheetName,
    columnMapping: input.columnMapping,
    exponent: defaultExponent,
  });

  const uniqueAccountNames = new Set<string>();
  const uniqueCategoryPairs = new Map<string, { rawName: string; kind: "income" | "expense" }>();

  for (const row of parsed.rows) {
    if (row.sourceAccountName) uniqueAccountNames.add(row.sourceAccountName);
    if (row.destinationAccountName) uniqueAccountNames.add(row.destinationAccountName);
    if (row.categoryName && (row.kind === "income" || row.kind === "expense")) {
      const key = `${row.kind}:${normalizeLabel(row.categoryName)}`;
      if (!uniqueCategoryPairs.has(key)) {
        uniqueCategoryPairs.set(key, { rawName: row.categoryName, kind: row.kind });
      }
    }
  }

  const uniqueAccounts = [...uniqueAccountNames].map((rawName) => ({
    rawName,
    suggestedAssetId: suggestAssetId(rawName, assetRows),
  }));

  const uniqueCategories = [...uniqueCategoryPairs.values()].map((item) => ({
    rawName: item.rawName,
    kind: item.kind,
    suggestedCategoryId: suggestCategoryId(item.rawName, item.kind, categoryRows),
  }));

  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const categoryById = new Map(categoryRows.map((c) => [c.id, c]));

  // Load previously imported fingerprints if migration 014 is active
  const importedFingerprints = new Set<string>();
  if (await hasImportsSchema(client)) {
    const fingerprints = parsed.rows.map((r) => r.rowFingerprint);
    if (fingerprints.length > 0) {
      const priorRows = await client.query<{ row_fingerprint: string }>(
        "SELECT DISTINCT row_fingerprint FROM import_batch_rows WHERE outcome='imported' AND row_fingerprint = ANY($1::char(64)[])",
        [fingerprints],
      );
      for (const r of priorRows.rows) importedFingerprints.add(r.row_fingerprint);
    }
  }

  // Load existing posted activities within the date span of the file for duplicate candidate matching
  const validDays = parsed.rows.map((r) => r.occurredDay).filter((d): d is string => Boolean(d)).sort();
  const existingSignatures = new Map<string, number>();
  if (validDays.length > 0) {
    const minDay = `${validDays[0]}T00:00:00.000Z`;
    const maxDay = `${validDays[validDays.length - 1]}T23:59:59.999Z`;
    const existingRows = await client.query<{
      day_utc: string;
      day_jkt: string;
      kind: "income" | "expense" | "transfer";
      base_amount_minor: string;
      source_asset_id: string | null;
      destination_asset_id: string | null;
    }>(
      `SELECT
         to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day_utc,
         to_char(occurred_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day_jkt,
         kind,
         base_amount_minor::text,
         source_asset_id,
         destination_asset_id
       FROM financial_activities
       WHERE status = 'posted'
         AND occurred_at >= ($1::timestamptz - interval '1 day')
         AND occurred_at <= ($2::timestamptz + interval '1 day')`,
      [minDay, maxDay],
    );
    for (const act of existingRows.rows) {
      const sigUtc = `${act.day_utc}|${act.kind}|${act.base_amount_minor}|${act.source_asset_id ?? ""}|${act.destination_asset_id ?? ""}`;
      existingSignatures.set(sigUtc, (existingSignatures.get(sigUtc) ?? 0) + 1);
      if (act.day_jkt !== act.day_utc) {
        const sigJkt = `${act.day_jkt}|${act.kind}|${act.base_amount_minor}|${act.source_asset_id ?? ""}|${act.destination_asset_id ?? ""}`;
        existingSignatures.set(sigJkt, (existingSignatures.get(sigJkt) ?? 0) + 1);
      }
    }
  }

  const remainingExisting = new Map(existingSignatures);
  const autoCreate = input.autoCreateCategories ?? true;
  const stagedRows: StagedPreviewRow[] = [];

  let readyCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;
  let skippedStatusCount = 0;

  for (const row of parsed.rows) {
    const validationErrors = [...row.parseErrors];

    const resolveAccount = (rawName: string): string | null => {
      if (!rawName) return null;
      const explicit = input.accountMap?.[rawName];
      if (explicit !== undefined) return explicit || null;
      return suggestAssetId(rawName, assetRows);
    };

    const resolvedSourceAssetId = resolveAccount(row.sourceAccountName);
    const resolvedDestinationAssetId = resolveAccount(row.destinationAccountName);

    if (row.kind === "expense" && !resolvedSourceAssetId) {
      validationErrors.push(`Petakan akun pembayar '${row.sourceAccountName}' ke aset aktif.`);
    } else if (row.kind === "income" && !resolvedDestinationAssetId) {
      validationErrors.push(`Petakan akun penerima '${row.destinationAccountName}' ke aset aktif.`);
    } else if (row.kind === "transfer") {
      if (!resolvedSourceAssetId) validationErrors.push(`Petakan akun asal '${row.sourceAccountName}' ke aset aktif.`);
      if (!resolvedDestinationAssetId) validationErrors.push(`Petakan akun tujuan '${row.destinationAccountName}' ke aset aktif.`);
      if (resolvedSourceAssetId && resolvedDestinationAssetId) {
        if (resolvedSourceAssetId === resolvedDestinationAssetId) {
          validationErrors.push("Aset asal dan tujuan Transfer tidak boleh sama.");
        } else {
          const srcAsset = assetById.get(resolvedSourceAssetId);
          const dstAsset = assetById.get(resolvedDestinationAssetId);
          if (srcAsset && dstAsset && srcAsset.currency_code !== dstAsset.currency_code) {
            validationErrors.push("Mata uang aset asal dan tujuan Transfer harus sama.");
          }
        }
      }
    }

    let resolvedCategoryId: string | null = null;
    let willCreateCategory = false;
    if (row.categoryName && (row.kind === "income" || row.kind === "expense")) {
      const catKey = `${row.kind}:${row.categoryName}`;
      const explicit = input.categoryMap?.[catKey] ?? input.categoryMap?.[row.categoryName];
      if (explicit === "__none__") {
        resolvedCategoryId = null;
      } else if (explicit === "__create__") {
        willCreateCategory = true;
      } else if (explicit && categoryById.get(explicit)?.applies_to === row.kind) {
        resolvedCategoryId = explicit;
      } else {
        const suggested = suggestCategoryId(row.categoryName, row.kind, categoryRows);
        if (suggested) {
          resolvedCategoryId = suggested;
        } else if (autoCreate) {
          willCreateCategory = true;
        } else {
          validationErrors.push(`Kategori '${row.categoryName}' belum dipetakan.`);
        }
      }
    }

    if (row.nonPostedStatus) {
      skippedStatusCount += 1;
      stagedRows.push({
        ...row,
        resolvedSourceAssetId,
        resolvedDestinationAssetId,
        resolvedCategoryId,
        willCreateCategory,
        status: "skipped_status",
        duplicateReason: `Status baris adalah '${row.rawStatus}' (bukan Posted).`,
        validationErrors,
        defaultSelected: false,
      });
      continue;
    }

    if (validationErrors.length > 0 || !row.kind || !row.amountMinor || !row.occurredAt || !row.occurredDay) {
      invalidCount += 1;
      stagedRows.push({
        ...row,
        resolvedSourceAssetId,
        resolvedDestinationAssetId,
        resolvedCategoryId,
        willCreateCategory,
        status: "invalid",
        duplicateReason: null,
        validationErrors,
        defaultSelected: false,
      });
      continue;
    }

    let duplicateReason: string | null = null;
    if (importedFingerprints.has(row.rowFingerprint)) {
      duplicateReason = "Baris ini sudah pernah diimpor pada batch sebelumnya.";
    } else {
      const sig = `${row.occurredDay}|${row.kind}|${row.amountMinor}|${resolvedSourceAssetId ?? ""}|${resolvedDestinationAssetId ?? ""}`;
      const count = remainingExisting.get(sig) ?? 0;
      if (count > 0) {
        remainingExisting.set(sig, count - 1);
        duplicateReason = "Transaksi dengan tanggal, jenis, akun, dan nominal yang sama sudah ada di ledger.";
      }
    }

    if (duplicateReason) {
      duplicateCount += 1;
      stagedRows.push({
        ...row,
        resolvedSourceAssetId,
        resolvedDestinationAssetId,
        resolvedCategoryId,
        willCreateCategory,
        status: "duplicate",
        duplicateReason,
        validationErrors: [],
        defaultSelected: false,
      });
    } else {
      readyCount += 1;
      stagedRows.push({
        ...row,
        resolvedSourceAssetId,
        resolvedDestinationAssetId,
        resolvedCategoryId,
        willCreateCategory,
        status: "ready",
        duplicateReason: null,
        validationErrors: [],
        defaultSelected: true,
      });
    }
  }

  return {
    fileName: cleanFileName,
    sourceFormat: parsed.sourceFormat,
    fileSha256: parsed.fileSha256,
    sheets: parsed.sheets,
    selectedSheet: parsed.selectedSheet,
    headerRowNumber: parsed.headerRowNumber,
    availableColumns: parsed.availableColumns,
    columnMapping: parsed.columnMapping,
    uniqueAccounts,
    uniqueCategories,
    rows: stagedRows,
    summary: {
      totalRows: stagedRows.length,
      readyCount,
      duplicateCount,
      invalidCount,
      skippedStatusCount,
    },
  };
}

export async function previewImportFile(input: {
  fileName: string;
  contentBase64: string;
  sheetName?: string;
  columnMapping?: Partial<ImportColumnMapping>;
  accountMap?: Record<string, string>;
  categoryMap?: Record<string, string>;
  autoCreateCategories?: boolean;
}): Promise<ImportPreviewResult> {
  await requireOwnerSession();
  return buildStagedPreview(database(), input);
}

export async function commitImportBatch(input: {
  fileName: string;
  contentBase64: string;
  sheetName?: string;
  columnMapping?: Partial<ImportColumnMapping>;
  accountMap?: Record<string, string>;
  categoryMap?: Record<string, string>;
  autoCreateCategories?: boolean;
  selectedRowNumbers: number[];
  idempotencyKey: string;
}): Promise<{
  batchId: string;
  importedCount: number;
  skippedCount: number;
  createdCategoriesCount: number;
}> {
  await requireOwnerSession();
  const idempotencyKey = assertUuid(input.idempotencyKey);
  if (!Array.isArray(input.selectedRowNumbers)) {
    throw new ImportValidationError("Daftar baris yang dipilih tidak valid.");
  }
  const selectedSet = new Set(input.selectedRowNumbers.map((n) => Number(n)));

  return inDatabaseTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('moneytor_import_commit'))");
    if (!(await hasImportsSchema(client))) {
      throw new ImportValidationError("Tabel impor (migrasi 014) belum diaktifkan di database lokal.");
    }

    const prior = (await client.query<{
      id: string;
      imported_count: number;
      skipped_count: number;
      created_categories_count: number;
    }>("SELECT id, imported_count, skipped_count, created_categories_count FROM import_batches WHERE idempotency_key = $1", [idempotencyKey])).rows[0];
    if (prior) {
      return {
        batchId: prior.id,
        importedCount: prior.imported_count,
        skippedCount: prior.skipped_count,
        createdCategoriesCount: prior.created_categories_count,
      };
    }

    const preview = await buildStagedPreview(client, input);
    const rowsToImport = preview.rows.filter((r) => selectedSet.has(r.rowNumber));
    if (rowsToImport.length === 0) {
      throw new ImportValidationError("Pilih setidaknya satu baris transaksi untuk diimpor.");
    }

    for (const row of rowsToImport) {
      if (row.validationErrors.length > 0 || row.status === "invalid" || row.status === "skipped_status") {
        throw new ImportValidationError(`Baris #${row.rowNumber} belum valid: ${row.validationErrors[0] ?? "Status tidak dapat diimpor."}`);
      }
    }

    // Create any missing categories needed by selected rows
    const createdCategoryIds = new Map<string, string>();
    let createdCategoriesCount = 0;
    for (const row of rowsToImport) {
      if (row.willCreateCategory && row.categoryName && (row.kind === "income" || row.kind === "expense")) {
        const key = `${row.kind}:${normalizeLabel(row.categoryName)}`;
        if (!createdCategoryIds.has(key)) {
          const displayName = validateCatalogName(row.categoryName);
          // Check if an active category with the same name and kind already exists
          const existingCat = (await client.query<{ id: string }>(
            "SELECT id FROM transaction_categories WHERE applies_to = $1 AND lower(display_name) = lower($2) AND is_active LIMIT 1",
            [row.kind, displayName],
          )).rows[0];
          if (existingCat) {
            createdCategoryIds.set(key, existingCat.id);
          } else {
            const newCatId = randomUUID();
            await client.query(
              "INSERT INTO transaction_categories (id, display_name, applies_to, is_builtin, is_active) VALUES ($1, $2, $3, false, true)",
              [newCatId, displayName, row.kind],
            );
            createdCategoryIds.set(key, newCatId);
            createdCategoriesCount += 1;
          }
        }
      }
    }

    const batchId = randomUUID();
    let importedCount = 0;
    let skippedCount = 0;
    const rowOutcomes: {
      row: StagedPreviewRow;
      outcome: "imported" | "skipped_duplicate" | "skipped_user";
      activityId: string | null;
    }[] = [];

    for (const row of preview.rows) {
      if (!selectedSet.has(row.rowNumber)) {
        skippedCount += 1;
        rowOutcomes.push({
          row,
          outcome: row.status === "duplicate" ? "skipped_duplicate" : "skipped_user",
          activityId: null,
        });
        continue;
      }

      const categoryId = row.willCreateCategory && row.categoryName && (row.kind === "income" || row.kind === "expense")
        ? createdCategoryIds.get(`${row.kind}:${normalizeLabel(row.categoryName)}`)
        : (row.resolvedCategoryId ?? undefined);

      let draft: ActivityDraft;
      if (row.kind === "income") {
        draft = {
          kind: "income",
          amountMinor: row.amountMinor!,
          destinationAssetId: row.resolvedDestinationAssetId!,
          categoryId,
          occurredAt: row.occurredAt!,
          note: row.note || undefined,
        };
      } else if (row.kind === "expense") {
        draft = {
          kind: "expense",
          amountMinor: row.amountMinor!,
          sourceAssetId: row.resolvedSourceAssetId!,
          categoryId,
          occurredAt: row.occurredAt!,
          note: row.note || undefined,
        };
      } else {
        draft = {
          kind: "transfer",
          amountMinor: row.amountMinor!,
          sourceAssetId: row.resolvedSourceAssetId!,
          destinationAssetId: row.resolvedDestinationAssetId!,
          transferFeeMinor: row.feeMinor ?? undefined,
          occurredAt: row.occurredAt!,
          note: row.note || undefined,
        };
      }

      const rowOpKey = deterministicUuid(`${idempotencyKey}:row:${row.rowNumber}`);
      const activityId = await postActivityInTransaction(client, draft, rowOpKey);
      importedCount += 1;
      rowOutcomes.push({ row, outcome: "imported", activityId });
    }

    await client.query(
      `INSERT INTO import_batches
        (id, file_name, source_format, sheet_name, file_sha256, idempotency_key, total_rows, imported_count, skipped_count, created_categories_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        batchId,
        preview.fileName,
        preview.sourceFormat,
        preview.selectedSheet,
        preview.fileSha256,
        idempotencyKey,
        preview.rows.length,
        importedCount,
        skippedCount,
        createdCategoriesCount,
      ],
    );

    for (const item of rowOutcomes) {
      const summary = {
        occurredAt: item.row.occurredAt,
        kind: item.row.kind,
        amountMinor: item.row.amountMinor,
        sourceAccountName: item.row.sourceAccountName,
        destinationAccountName: item.row.destinationAccountName,
        categoryName: item.row.categoryName,
        note: item.row.note,
      };
      await client.query(
        `INSERT INTO import_batch_rows
          (id, batch_id, row_number, row_fingerprint, outcome, activity_id, summary_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          randomUUID(),
          batchId,
          item.row.rowNumber,
          item.row.rowFingerprint,
          item.outcome,
          item.activityId,
          JSON.stringify(summary),
        ],
      );
    }

    return {
      batchId,
      importedCount,
      skippedCount,
      createdCategoriesCount,
    };
  });
}

export async function listImportBatches(): Promise<ImportBatchSummary[]> {
  await requireOwnerSession();
  const db = database();
  if (!(await hasImportsSchema(db))) return [];
  const result = await db.query<{
    id: string;
    file_name: string;
    source_format: "csv" | "xlsx";
    sheet_name: string | null;
    total_rows: number;
    imported_count: number;
    skipped_count: number;
    created_categories_count: number;
    created_at: Date;
  }>(
    `SELECT id, file_name, source_format, sheet_name, total_rows, imported_count, skipped_count, created_categories_count, created_at
     FROM import_batches
     ORDER BY created_at DESC, id DESC
     LIMIT 50`,
  );
  return result.rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    sourceFormat: r.source_format,
    sheetName: r.sheet_name,
    totalRows: r.total_rows,
    importedCount: r.imported_count,
    skippedCount: r.skipped_count,
    createdCategoriesCount: r.created_categories_count,
    createdAt: r.created_at.toISOString(),
  }));
}
