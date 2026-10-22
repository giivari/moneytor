import "server-only";
import { randomUUID } from "node:crypto";
import { requireOwnerSession } from "@/lib/auth/session";
import { database, inDatabaseTransaction } from "@/lib/db/pool";
import { validateCatalogName } from "@/lib/domain/catalog";
import { assertStoredMinor, parseMinor } from "@/lib/domain/money";
import { formatMinor } from "@/lib/finance/format";
import { listActivities } from "@/lib/finance/service";
import { listImportBatches } from "@/lib/imports/service";
import { investmentSnapshot } from "@/lib/investments/read";
import { listPlanning } from "@/lib/planning/repository";
import { listAssets } from "@/lib/repositories/assets";
import { listCatalog } from "@/lib/repositories/catalogs";
import {
  parseWorkbookAccountsSheet,
  toCsvDocument,
  toStatementPdfBuffer,
  toXlsxBuffer,
  type WorkbookAccountMigrationPreview,
} from "./format";

export type ExportDatasetKind = "transactions" | "assets" | "investments" | "planning";
export type ExportFileFormat = "csv" | "xlsx" | "pdf";

type PreparedDataset = {
  baseFileName: string;
  sheetName: string;
  title: string;
  subtitle: string;
  summaryItems: { label: string; value: string }[];
  csvHeaders: string[];
  csvRows: (string | number | boolean | null)[][];
  pdfHeaders: string[];
  pdfRows: (string | number | boolean | null)[][];
  rightAlignCols: number[];
};

async function prepareDataset(kind: ExportDatasetKind): Promise<PreparedDataset> {
  const stamp = new Date().toISOString().slice(0, 10);

  if (kind === "transactions") {
    const activities = await listActivities(true);
    let postedIncome = 0n;
    let postedExpense = 0n;
    let postedTransfer = 0n;

    for (const act of activities) {
      if (act.status !== "posted" || act.currency !== "IDR") continue;
      const chargesSum = act.charges.reduce((acc, c) => acc + BigInt(c.amountMinor), 0n);
      if (act.kind === "income") postedIncome += BigInt(act.baseAmountMinor);
      else if (act.kind === "expense") postedExpense += BigInt(act.baseAmountMinor) + chargesSum;
      else if (act.kind === "transfer") postedTransfer += BigInt(act.baseAmountMinor);
    }

    const csvHeaders = [
      "Tanggal (WIB)",
      "Jenis",
      "Status",
      "Akun / Sumber",
      "Akun Tujuan",
      "Kategori",
      "Nominal Pokok",
      "Biaya Tambahan",
      "Total Pergerakan",
      "Mata Uang",
      "Otomatisasi",
      "Catatan",
    ];
    const pdfHeaders = [
      "Tanggal",
      "Jenis",
      "Akun / Mutasi",
      "Kategori",
      "Catatan",
      "Status",
      "Total Nominal",
    ];

    const csvRows: (string | number | boolean | null)[][] = [];
    const pdfRows: (string | number | boolean | null)[][] = [];

    for (const act of activities) {
      const chargesSum = act.charges.reduce((acc, c) => acc + BigInt(c.amountMinor), 0n);
      const total = BigInt(act.baseAmountMinor) + chargesSum;
      const typeLabel = act.kind === "income" ? "Pemasukan" : act.kind === "expense" ? "Pengeluaran" : "Transfer";
      const statusLabel = act.status === "posted" ? "Aktif" : act.status === "voided" ? "Dibatalkan" : "Dikoreksi";
      const accountCol = act.kind === "income" ? (act.destinationName ?? "") : (act.sourceName ?? "");
      const toAccountCol = act.kind === "transfer" ? (act.destinationName ?? "") : "";
      const dateStr = new Date(act.occurredAt).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const sign = act.kind === "expense" ? "-" : act.kind === "income" ? "+" : "";
      const formattedTotal = `${sign}${formatMinor(total.toString(), act.currency, act.exponent)}`;
      const accountFlow = act.kind === "transfer" ? `${act.sourceName ?? ""} -> ${act.destinationName ?? ""}` : accountCol;

      csvRows.push([
        dateStr,
        typeLabel,
        statusLabel,
        accountCol,
        toAccountCol,
        act.categoryName ?? "",
        Number(act.baseAmountMinor),
        Number(chargesSum),
        Number(total),
        act.currency,
        act.recurringRuleName ?? "",
        act.note ?? "",
      ]);

      pdfRows.push([
        dateStr,
        typeLabel,
        accountFlow,
        act.categoryName ?? "-",
        act.note || "-",
        statusLabel,
        formattedTotal,
      ]);
    }

    return {
      baseFileName: `moneytor-mutasi-transaksi-${stamp}`,
      sheetName: "Mutasi Transaksi",
      title: "Mutasi & Riwayat Transaksi",
      subtitle: `Total ${activities.length} aktivitas tercatat (termasuk riwayat koreksi/pembatalan)`,
      summaryItems: [
        { label: "Total Pemasukan Aktif (IDR)", value: formatMinor(postedIncome.toString(), "IDR", 0) },
        { label: "Total Pengeluaran Aktif (IDR)", value: formatMinor(postedExpense.toString(), "IDR", 0) },
        { label: "Total Pokok Transfer (IDR)", value: formatMinor(postedTransfer.toString(), "IDR", 0) },
        { label: "Jumlah Aktivitas Tercatat", value: `${activities.length} transaksi` },
      ],
      csvHeaders,
      csvRows,
      pdfHeaders,
      pdfRows,
      rightAlignCols: [6],
    };
  }

  if (kind === "assets") {
    const assets = await listAssets(true);
    const activeCount = assets.filter((a) => a.isActive).length;
    const totalIdr = assets
      .filter((a) => a.isActive && a.currency === "IDR")
      .reduce((acc, a) => acc + BigInt(a.balanceMinor), 0n);
    const liquidIdr = assets
      .filter((a) => a.isActive && a.currency === "IDR" && a.normallyLiquid)
      .reduce((acc, a) => acc + BigInt(a.balanceMinor), 0n);

    const csvHeaders = [
      "Nama Aset / Rekening",
      "Penyedia",
      "Jenis Aset",
      "Grup Aset",
      "Mata Uang",
      "Saldo Efektif",
      "Saldo Terformat",
      "Likuid",
      "Dapat Digunakan",
      "Akhiran Rekening",
      "Status",
      "Catatan",
    ];
    const pdfHeaders = [
      "Nama Aset / Rekening",
      "Penyedia",
      "Jenis Aset",
      "Grup Aset",
      "Sifat Dana",
      "Status",
      "Saldo Efektif",
    ];

    const csvRows = assets.map((a) => [
      a.displayName,
      a.providerName ?? "-",
      a.assetTypeName,
      a.assetGroupName ?? "-",
      a.currency,
      Number(a.balanceMinor),
      formatMinor(a.balanceMinor, a.currency, a.exponent),
      a.normallyLiquid ? "Ya" : "Tidak",
      a.normallySpendable ? "Ya" : "Tidak",
      a.safeSuffix ?? "",
      a.isActive ? "Aktif" : "Diarsipkan",
      a.note ?? "",
    ]);

    const pdfRows = assets.map((a) => [
      a.displayName + (a.safeSuffix ? ` (*${a.safeSuffix})` : ""),
      a.providerName ?? "-",
      a.assetTypeName,
      a.assetGroupName ?? "-",
      a.normallySpendable ? "Dapat digunakan" : a.normallyLiquid ? "Likuid (Cadangan)" : "Non-likuid",
      a.isActive ? "Aktif" : "Diarsipkan",
      formatMinor(a.balanceMinor, a.currency, a.exponent),
    ]);

    return {
      baseFileName: `moneytor-posisi-aset-${stamp}`,
      sheetName: "Posisi Aset",
      title: "Laporan Posisi Aset & Rekening",
      subtitle: `${activeCount} aset aktif dan ${assets.length - activeCount} aset diarsipkan`,
      summaryItems: [
        { label: "Total Saldo Aset Aktif (IDR)", value: formatMinor(totalIdr.toString(), "IDR", 0) },
        { label: "Total Dana Likuid (IDR)", value: formatMinor(liquidIdr.toString(), "IDR", 0) },
        { label: "Aset Aktif", value: `${activeCount} akun` },
        { label: "Aset Diarsipkan", value: `${assets.length - activeCount} akun` },
      ],
      csvHeaders,
      csvRows,
      pdfHeaders,
      pdfRows,
      rightAlignCols: [6],
    };
  }

  if (kind === "investments") {
    const inv = await investmentSnapshot();
    const portfolioById = new Map(inv.portfolios.map((p) => [p.id, p]));
    const instrumentById = new Map(inv.instruments.map((i) => [i.id, i]));
    const idrTotal = inv.totals.find((t) => t.currency === "IDR");

    const csvHeaders = [
      "Kategori Catatan",
      "Portofolio",
      "Instrumen",
      "Simbol",
      "Mata Uang",
      "Kuantitas Unit",
      "Harga Unit / Pasar",
      "Nilai Perolehan / Pokok",
      "Biaya Transaksi",
      "Nilai Pasar Saat Ini",
      "Laba/Rugi (P/L)",
      "Status",
      "Waktu Pencatatan",
    ];
    const pdfHeaders = [
      "Jenis",
      "Portofolio",
      "Instrumen",
      "Unit",
      "Harga / Unit",
      "Nilai Pokok",
      "Nilai Pasar / P&L",
    ];

    const csvRows: (string | number | boolean | null)[][] = [];
    const pdfRows: (string | number | boolean | null)[][] = [];

    for (const h of inv.holdings) {
      const portfolio = portfolioById.get(h.portfolioId);
      const instrument = instrumentById.get(h.instrumentId);
      const cur = instrument?.currency ?? portfolio?.currency ?? "IDR";
      const exp = instrument?.exponent ?? portfolio?.exponent ?? 0;

      csvRows.push([
        "Kepemilikan (Holding)",
        portfolio?.displayName ?? h.portfolioId,
        instrument?.displayName ?? h.instrumentId,
        instrument?.symbol ?? "",
        cur,
        h.quantity,
        h.price?.price ?? "",
        Number(h.costBasisMinor),
        0,
        h.marketMinor !== null ? Number(h.marketMinor) : "",
        h.unrealizedMinor !== null ? Number(h.unrealizedMinor) : "",
        "Aktif",
        h.price?.asOf ?? "",
      ]);

      pdfRows.push([
        "Holding",
        portfolio?.displayName ?? "-",
        instrument?.displayName ?? "-",
        h.quantity,
        h.price?.price ?? "Belum ada",
        formatMinor(h.costBasisMinor, cur, exp),
        h.marketMinor !== null ? formatMinor(h.marketMinor, cur, exp) : "Belum berharga",
      ]);
    }

    for (const t of inv.trades) {
      const portfolio = portfolioById.get(t.portfolioId);
      const instrument = instrumentById.get(t.instrumentId);
      const exp = instrument?.exponent ?? portfolio?.exponent ?? 0;

      csvRows.push([
        t.kind === "buy" ? "Transaksi Beli" : "Transaksi Jual",
        portfolio?.displayName ?? t.portfolioId,
        instrument?.displayName ?? t.instrumentId,
        instrument?.symbol ?? "",
        t.currency,
        t.quantity,
        t.unitPrice,
        Number(t.grossMinor),
        Number(t.feeMinor),
        "",
        t.realizedMinor !== null ? Number(t.realizedMinor) : "",
        t.status === "posted" ? "Aktif" : t.status === "voided" ? "Dibatalkan" : "Dikoreksi",
        t.occurredAt,
      ]);

      pdfRows.push([
        t.kind === "buy" ? "Beli" : "Jual",
        portfolio?.displayName ?? "-",
        instrument?.displayName ?? "-",
        t.quantity,
        t.unitPrice,
        formatMinor(t.grossMinor, t.currency, exp),
        t.realizedMinor !== null ? formatMinor(t.realizedMinor, t.currency, exp) : t.status,
      ]);
    }

    return {
      baseFileName: `moneytor-investasi-${stamp}`,
      sheetName: "Portofolio Investasi",
      title: "Laporan Portofolio & Riwayat Investasi",
      subtitle: `${inv.holdings.length} kepemilikan instrumen dan ${inv.trades.length} riwayat transaksi`,
      summaryItems: [
        {
          label: "Nilai Pasar Portofolio (IDR)",
          value: idrTotal ? formatMinor(idrTotal.marketMinor, "IDR", idrTotal.exponent) : "Rp 0",
        },
        {
          label: "Biaya Perolehan Tersisa (IDR)",
          value: idrTotal ? formatMinor(idrTotal.costBasisMinor, "IDR", idrTotal.exponent) : "Rp 0",
        },
        {
          label: "Unrealized P/L (IDR)",
          value: idrTotal ? formatMinor(idrTotal.unrealizedMinor, "IDR", idrTotal.exponent) : "Rp 0",
        },
        {
          label: "Jumlah Posisi & Transaksi",
          value: `${inv.holdings.length} posisi / ${inv.trades.length} trade`,
        },
      ],
      csvHeaders,
      csvRows,
      pdfHeaders,
      pdfRows,
      rightAlignCols: [3, 4, 5, 6],
    };
  }

  const planning = await listPlanning();
  const csvHeaders = [
    "Kelompok Rencana",
    "Nama Rencana",
    "Mata Uang",
    "Target / Batas / Nominal",
    "Realisasi / Tercakup / Sisa",
    "Mulai / Jatuh Tempo",
    "Berakhir",
    "Status",
    "Aktif",
    "Catatan",
  ];
  const pdfHeaders = [
    "Kelompok",
    "Nama Rencana",
    "Periode / Target Waktu",
    "Status",
    "Realisasi / Progres",
    "Target / Batas Nominal",
  ];

  const csvRows: (string | number | boolean | null)[][] = [];
  const pdfRows: (string | number | boolean | null)[][] = [];

  if (planning.ready) {
    for (const b of planning.budgets) {
      csvRows.push([
        "Anggaran (Budget)",
        b.title,
        b.currency,
        Number(b.limitMinor),
        Number(b.spentMinor),
        b.periodStart,
        b.periodEnd,
        b.isActive ? "Aktif" : "Diarsipkan",
        b.isActive ? "Ya" : "Tidak",
        b.note ?? "",
      ]);
      pdfRows.push([
        "Anggaran",
        b.title,
        `${b.periodStart} s.d. ${b.periodEnd}`,
        b.isActive ? "Aktif" : "Diarsipkan",
        formatMinor(b.spentMinor, b.currency, b.exponent),
        formatMinor(b.limitMinor, b.currency, b.exponent),
      ]);
    }
    for (const g of planning.goals) {
      csvRows.push([
        "Target Tabungan (Goal)",
        g.title,
        g.currency,
        Number(g.targetMinor),
        Number(g.progressMinor),
        g.targetOn ?? "",
        "",
        g.isActive ? "Aktif" : "Diarsipkan",
        g.isActive ? "Ya" : "Tidak",
        g.note ?? "",
      ]);
      pdfRows.push([
        "Target",
        g.title,
        g.targetOn ?? "Tanpa tenggat",
        g.isActive ? "Aktif" : "Diarsipkan",
        formatMinor(g.progressMinor, g.currency, g.exponent),
        formatMinor(g.targetMinor, g.currency, g.exponent),
      ]);
    }
    for (const r of planning.reserves) {
      csvRows.push([
        "Dana Cadangan (Reserve)",
        r.title,
        r.currency,
        Number(r.amountMinor),
        "",
        "",
        "",
        r.isActive ? "Aktif" : "Dilepaskan",
        r.isActive ? "Ya" : "Tidak",
        r.note ?? "",
      ]);
      pdfRows.push([
        "Cadangan",
        r.title,
        r.sourceAssetName ?? `Pool ${r.currency}`,
        r.isActive ? "Disisihkan" : "Dilepaskan",
        "-",
        formatMinor(r.amountMinor, r.currency, r.exponent),
      ]);
    }
    for (const o of planning.obligations) {
      csvRows.push([
        "Kewajiban (Obligation)",
        o.title,
        o.currency,
        Number(o.amountMinor),
        Number(o.uncoveredMinor),
        o.dueOn,
        "",
        o.status === "open" ? "Terbuka" : o.status === "settled" ? "Selesai" : "Dibatalkan",
        o.status === "open" ? "Ya" : "Tidak",
        o.note ?? "",
      ]);
      pdfRows.push([
        "Kewajiban",
        o.title,
        `Jatuh tempo ${o.dueOn}`,
        o.status === "open" ? "Terbuka" : o.status === "settled" ? "Selesai" : "Dibatalkan",
        `Belum tercakup: ${formatMinor(o.uncoveredMinor, o.currency, o.exponent)}`,
        formatMinor(o.amountMinor, o.currency, o.exponent),
      ]);
    }
  }

  return {
    baseFileName: `moneytor-planning-${stamp}`,
    sheetName: "Perencanaan",
    title: "Laporan Perencanaan, Cadangan & Kewajiban",
    subtitle: "Ringkasan anggaran pengeluaran, target tabungan, dana cadangan, dan kewajiban",
    summaryItems: [
      { label: "Batas Anggaran", value: `${planning.ready ? planning.budgets.length : 0} item` },
      { label: "Target Tabungan", value: `${planning.ready ? planning.goals.length : 0} item` },
      { label: "Dana Cadangan", value: `${planning.ready ? planning.reserves.length : 0} item` },
      { label: "Kewajiban Terbuka", value: `${planning.ready ? planning.obligations.filter((o) => o.status === "open").length : 0} item` },
    ],
    csvHeaders,
    csvRows,
    pdfHeaders,
    pdfRows,
    rightAlignCols: [4, 5],
  };
}

export async function exportDatasetFile(
  kind: ExportDatasetKind,
  format: ExportFileFormat = "csv",
): Promise<{ fileName: string; contentType: string; body: Buffer | string }> {
  await requireOwnerSession();
  const prepared = await prepareDataset(kind);

  if (format === "xlsx") {
    const buffer = toXlsxBuffer(prepared.sheetName, prepared.csvHeaders, prepared.csvRows);
    return {
      fileName: `${prepared.baseFileName}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: buffer,
    };
  }

  if (format === "pdf") {
    const buffer = toStatementPdfBuffer({
      title: prepared.title,
      subtitle: prepared.subtitle,
      summaryItems: prepared.summaryItems,
      headers: prepared.pdfHeaders,
      rows: prepared.pdfRows,
      rightAlignCols: prepared.rightAlignCols,
    });
    return {
      fileName: `${prepared.baseFileName}.pdf`,
      contentType: "application/pdf",
      body: buffer,
    };
  }

  return {
    fileName: `${prepared.baseFileName}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: toCsvDocument(prepared.csvHeaders, prepared.csvRows),
  };
}

export async function exportCsvDataset(kind: ExportDatasetKind): Promise<{ fileName: string; content: string }> {
  const res = await exportDatasetFile(kind, "csv");
  return { fileName: res.fileName, content: String(res.body) };
}

export async function exportFullSnapshotJson(): Promise<{ fileName: string; payload: Record<string, unknown> }> {
  await requireOwnerSession();
  const stamp = new Date().toISOString().slice(0, 10);
  const [
    currenciesRes,
    providers,
    paymentNetworks,
    assetTypes,
    assetGroups,
    transactionCategories,
    chargeTypes,
    instrumentTypes,
    assets,
    activities,
    investments,
    planning,
    importBatches,
  ] = await Promise.all([
    database().query<{ code: string; display_name: string; minor_unit_exponent: number; is_active: boolean }>(
      "SELECT code, display_name, minor_unit_exponent, is_active FROM currencies ORDER BY code",
    ),
    listCatalog("providers", true),
    listCatalog("paymentNetworks", true),
    listCatalog("assetTypes", true),
    listCatalog("assetGroups", true),
    listCatalog("transactionCategories", true),
    listCatalog("chargeTypes", true),
    listCatalog("instrumentTypes", true),
    listAssets(true),
    listActivities(true),
    investmentSnapshot(),
    listPlanning(),
    listImportBatches().catch(() => []),
  ]);

  return {
    fileName: `moneytor-snapshot-${stamp}.json`,
    payload: {
      schemaVersion: "moneytor.export.v1",
      exportedAt: new Date().toISOString(),
      currencies: currenciesRes.rows.map((r) => ({
        code: r.code,
        displayName: r.display_name,
        exponent: r.minor_unit_exponent,
        isActive: r.is_active,
      })),
      catalogs: {
        providers,
        paymentNetworks,
        assetTypes,
        assetGroups,
        transactionCategories,
        chargeTypes,
        instrumentTypes,
      },
      assets,
      activities,
      investments: {
        totals: investments.totals,
        portfolios: investments.portfolios,
        instruments: investments.instruments,
        holdings: investments.holdings,
        trades: investments.trades,
        prices: investments.prices,
      },
      planning: planning.ready
        ? {
            budgets: planning.budgets,
            goals: planning.goals,
            reserves: planning.reserves,
            obligations: planning.obligations,
          }
        : null,
      importBatches,
    },
  };
}

export async function previewWorkbookAccountMigration(input: {
  fileName: string;
  contentBase64: string;
  sheetName?: string;
}): Promise<WorkbookAccountMigrationPreview & { availableSheets: string[] }> {
  await requireOwnerSession();
  const buffer = Buffer.from(input.contentBase64, "base64");
  const existingAssets = await listAssets(true);
  const parsed = parseWorkbookAccountsSheet(
    buffer,
    existingAssets.map((a) => ({ id: a.id, displayName: a.displayName, currency: a.currency })),
    input.sheetName,
  );
  return {
    ...parsed,
    fileName: input.fileName.trim() || "workbook.xlsx",
  };
}

export async function commitWorkbookAccountMigration(input: {
  fileName: string;
  contentBase64: string;
  sheetName?: string;
  selectedRowNumbers: number[];
  openingEffectiveAt?: string;
}): Promise<{ createdAssetsCount: number; createdProvidersCount: number; assetIds: string[] }> {
  await requireOwnerSession();
  const preview = await previewWorkbookAccountMigration({
    fileName: input.fileName,
    contentBase64: input.contentBase64,
    sheetName: input.sheetName,
  });
  const selectedSet = new Set(input.selectedRowNumbers);
  const toCreate = preview.accounts.filter((a) => selectedSet.has(a.rowNumber) && !a.alreadyExists);
  if (toCreate.length === 0) {
    throw new Error("Pilih setidaknya satu akun baru yang belum ada di daftar aset.");
  }

  const effectiveAt = input.openingEffectiveAt ? new Date(input.openingEffectiveAt) : new Date("2026-09-20T00:00:00.000Z");
  if (Number.isNaN(effectiveAt.getTime())) {
    throw new Error("Tanggal saldo awal tidak valid.");
  }

  return inDatabaseTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('moneytor_workbook_account_migration'))");

    const typesRes = await client.query<{ id: string; system_key: string }>(
      "SELECT id, system_key FROM asset_types WHERE system_key IS NOT NULL AND is_active",
    );
    const typeByKey = new Map(typesRes.rows.map((r) => [r.system_key, r.id]));

    const groupsRes = await client.query<{ id: string; system_key: string }>(
      "SELECT id, system_key FROM asset_groups WHERE system_key IS NOT NULL AND is_active",
    );
    const groupByKey = new Map(groupsRes.rows.map((r) => [r.system_key, r.id]));

    const providersRes = await client.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM financial_providers WHERE is_active",
    );
    const providerByNorm = new Map(
      providersRes.rows.map((r) => [r.display_name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), r.id]),
    );

    const existingAssetsRes = await client.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM assets",
    );
    const existingNames = new Set(
      existingAssetsRes.rows.map((r) => r.display_name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()),
    );

    let createdProvidersCount = 0;
    const assetIds: string[] = [];

    for (const acc of toCreate) {
      const normName = acc.displayName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (existingNames.has(normName)) continue;

      let providerId: string | null = null;
      if (acc.inferredProviderName) {
        const normProv = acc.inferredProviderName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        providerId = providerByNorm.get(normProv) ?? null;
        if (!providerId) {
          const newProvId = randomUUID();
          await client.query(
            "INSERT INTO financial_providers (id, display_name, is_builtin, system_key) VALUES ($1, $2, false, NULL)",
            [newProvId, validateCatalogName(acc.inferredProviderName)],
          );
          providerByNorm.set(normProv, newProvId);
          providerId = newProvId;
          createdProvidersCount += 1;
        }
      }

      const assetTypeId = typeByKey.get(acc.assetTypeSystemKey) ?? typesRes.rows[0]?.id;
      if (!assetTypeId) throw new Error("Jenis aset bawaan tidak ditemukan.");
      const assetGroupId = groupByKey.get(acc.assetGroupSystemKey) ?? null;
      const openingMinor = assertStoredMinor(parseMinor(acc.openingAmountMinor));

      const assetId = randomUUID();
      await client.query(
        `INSERT INTO assets (id, display_name, provider_id, asset_type_id, asset_group_id,
          payment_network_id, currency_code, normally_liquid, normally_spendable, safe_suffix, note)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,NULL,$9)`,
        [
          assetId,
          validateCatalogName(acc.displayName),
          providerId,
          assetTypeId,
          assetGroupId,
          acc.currency,
          acc.normallyLiquid,
          acc.normallySpendable,
          acc.note || null,
        ],
      );
      await client.query(
        "INSERT INTO asset_opening_states (asset_id, amount_minor, effective_at) VALUES ($1,$2,$3)",
        [assetId, openingMinor.toString(), effectiveAt],
      );
      existingNames.add(normName);
      assetIds.push(assetId);
    }

    return {
      createdAssetsCount: assetIds.length,
      createdProvidersCount,
      assetIds,
    };
  });
}
