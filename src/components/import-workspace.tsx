"use client";

import { useRef, useState } from "react";
import { ArrowLeft, CheckCircle, FileArrowUp, WarningCircle } from "@phosphor-icons/react";
import { AppLink as Link } from "@/components/app-link";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { FinancialDataTable } from "./financial-data-table";
import { ListToolbar } from "./list-toolbar";
import { LoadingIndicator } from "./loading-indicator";
import { SectionHeading } from "./section-heading";
import { formatMinor } from "@/lib/finance/format";
import { requestJson } from "@/lib/finance/client";
import type { FinanceAsset } from "@/lib/finance/types";
import type { CatalogRecord } from "@/lib/repositories/catalogs";
import type {
  ImportBatchSummary,
  ImportColumnMapping,
  ImportPreviewResult,
  StagedPreviewRow,
} from "@/lib/imports/types";

type Props = {
  assets: FinanceAsset[];
  categories: CatalogRecord[];
  initialBatches: ImportBatchSummary[];
};

const PAGE_SIZE = 25;

const kindLabels = {
  income: "Pemasukan",
  expense: "Pengeluaran",
  transfer: "Transfer",
} as const;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function ImportWorkspace({ assets, categories, initialBatches }: Props) {
  const { notify, refresh, refreshing } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const [error, setError] = useState("");
  const [fileState, setFileState] = useState<{ fileName: string; contentBase64: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [columnMapping, setColumnMapping] = useState<Partial<ImportColumnMapping>>({});
  const [accountMap, setAccountMap] = useState<Record<string, string>>({});
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [autoCreateCategories, setAutoCreateCategories] = useState(true);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "duplicate" | "invalid">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [batches, setBatches] = useState<ImportBatchSummary[]>(initialBatches);
  const commitReplay = useRef<{ payload: string; key: string } | null>(null);

  function applyPreviewSelection(
    nextPreview: ImportPreviewResult,
    currentAccMap: Record<string, string>,
    currentCatMap: Record<string, string>,
    autoCreate: boolean,
  ) {
    setPreview(nextPreview);
    setSheetName(nextPreview.selectedSheet ?? "");
    setColumnMapping(nextPreview.columnMapping);
    const nextAccMap: Record<string, string> = {};
    for (const acc of nextPreview.uniqueAccounts) {
      nextAccMap[acc.rawName] = currentAccMap[acc.rawName] ?? acc.suggestedAssetId ?? "";
    }
    setAccountMap(nextAccMap);
    const nextCatMap: Record<string, string> = {};
    for (const cat of nextPreview.uniqueCategories) {
      const key = `${cat.kind}:${cat.rawName}`;
      nextCatMap[key] = currentCatMap[key] ?? cat.suggestedCategoryId ?? (autoCreate ? "__create__" : "");
    }
    setCategoryMap(nextCatMap);
    const defaults = new Set<number>();
    for (const row of nextPreview.rows) {
      if (row.defaultSelected) defaults.add(row.rowNumber);
    }
    setSelectedRows(defaults);
  }

  async function runPreview(
    targetFile: { fileName: string; contentBase64: string },
    overrides?: {
      sheetName?: string;
      columnMapping?: Partial<ImportColumnMapping>;
      accountMap?: Record<string, string>;
      categoryMap?: Record<string, string>;
      autoCreateCategories?: boolean;
    },
  ) {
    if (!begin()) return;
    setError("");
    const effectiveAccMap = overrides?.accountMap ?? accountMap;
    const effectiveCatMap = overrides?.categoryMap ?? categoryMap;
    const effectiveAutoCreate = overrides?.autoCreateCategories ?? autoCreateCategories;
    try {
      const response = await requestJson<{ preview: ImportPreviewResult }>("/api/imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: targetFile.fileName,
          contentBase64: targetFile.contentBase64,
          sheetName: overrides?.sheetName !== undefined ? overrides.sheetName : (sheetName || undefined),
          columnMapping: overrides?.columnMapping ?? columnMapping,
          accountMap: effectiveAccMap,
          categoryMap: effectiveCatMap,
          autoCreateCategories: effectiveAutoCreate,
        }),
        cache: "no-store",
      });
      applyPreviewSelection(response.preview, effectiveAccMap, effectiveCatMap, effectiveAutoCreate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal memuat pratinjau file impor.");
    } finally {
      finish();
    }
  }

  async function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const buffer = await file.arrayBuffer();
      const contentBase64 = arrayBufferToBase64(buffer);
      const nextFile = { fileName: file.name, contentBase64 };
      setFileState(nextFile);
      setSheetName("");
      setColumnMapping({});
      setAccountMap({});
      setCategoryMap({});
      setPage(1);
      await runPreview(nextFile, {
        sheetName: "",
        columnMapping: {},
        accountMap: {},
        categoryMap: {},
        autoCreateCategories,
      });
    } catch {
      setError("File tidak dapat dibaca.");
    }
  }

  function updateAccountMapping(rawName: string, assetId: string) {
    const nextAccMap = { ...accountMap, [rawName]: assetId };
    setAccountMap(nextAccMap);
    if (fileState) {
      void runPreview(fileState, { accountMap: nextAccMap });
    }
  }

  function mapAllUnmappedAccounts(assetId: string) {
    if (!preview || !assetId) return;
    const nextAccMap = { ...accountMap };
    for (const acc of preview.uniqueAccounts) {
      if (!nextAccMap[acc.rawName]) {
        nextAccMap[acc.rawName] = assetId;
      }
    }
    setAccountMap(nextAccMap);
    if (fileState) {
      void runPreview(fileState, { accountMap: nextAccMap });
    }
  }

  function updateCategoryMapping(key: string, value: string) {
    const nextCatMap = { ...categoryMap, [key]: value };
    setCategoryMap(nextCatMap);
    if (fileState) {
      void runPreview(fileState, { categoryMap: nextCatMap });
    }
  }

  function updateAutoCreateCategories(checked: boolean) {
    setAutoCreateCategories(checked);
    if (fileState) {
      void runPreview(fileState, { autoCreateCategories: checked });
    }
  }

  function toggleRow(row: StagedPreviewRow, checked: boolean) {
    if (row.status === "invalid" || row.status === "skipped_status") return;
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (checked) next.add(row.rowNumber);
      else next.delete(row.rowNumber);
      return next;
    });
  }

  const visibleRows = (preview?.rows ?? []).filter((row) => {
    if (statusFilter === "ready" && row.status !== "ready") return false;
    if (statusFilter === "duplicate" && row.status !== "duplicate") return false;
    if (statusFilter === "invalid" && row.status !== "invalid" && row.status !== "skipped_status") return false;
    if (startDate && row.occurredDay && row.occurredDay < startDate) return false;
    if (endDate && row.occurredDay && row.occurredDay > endDate) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = visibleRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function selectAllVisibleReady() {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      for (const row of visibleRows) {
        if (row.status === "ready") next.add(row.rowNumber);
      }
      return next;
    });
  }

  function clearVisibleSelection() {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      for (const row of visibleRows) {
        next.delete(row.rowNumber);
      }
      return next;
    });
  }

  async function commitSelected() {
    if (!fileState || !preview || !begin()) return;
    setError("");
    try {
      const selectedRowNumbers = [...selectedRows].filter((num) => {
        const row = preview.rows.find((r) => r.rowNumber === num);
        if (!row) return false;
        if (startDate && row.occurredDay && row.occurredDay < startDate) return false;
        if (endDate && row.occurredDay && row.occurredDay > endDate) return false;
        return row.status === "ready" || row.status === "duplicate";
      });
      if (selectedRowNumbers.length === 0) {
        throw new Error("Pilih setidaknya satu baris transaksi yang valid untuk diimpor.");
      }
      const bodyPayload = {
        fileName: fileState.fileName,
        contentBase64: fileState.contentBase64,
        sheetName: sheetName || undefined,
        columnMapping,
        accountMap,
        categoryMap,
        autoCreateCategories,
        selectedRowNumbers,
      };
      const serialized = JSON.stringify(bodyPayload);
      if (commitReplay.current?.payload !== serialized) {
        commitReplay.current = { payload: serialized, key: crypto.randomUUID() };
      }
      const response = await requestJson<{
        result: { batchId: string; importedCount: number; skippedCount: number; createdCategoriesCount: number };
      }>("/api/imports/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...bodyPayload, idempotencyKey: commitReplay.current.key }),
        cache: "no-store",
      });
      const historyRes = await requestJson<{ batches: ImportBatchSummary[] }>("/api/imports/history", { cache: "no-store" });
      setBatches(historyRes.batches);
      refresh();
      notify(`${response.result.importedCount} transaksi berhasil diimpor (${response.result.skippedCount} dilewati).`);
      setPreview(null);
      setFileState(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impor gagal disimpan.");
    } finally {
      finish();
    }
  }

  const defaultCurrency = assets[0]?.currency ?? "IDR";
  const defaultExponent = assets[0]?.exponent ?? 0;
  const activeSelectedCount = preview
    ? preview.rows.filter((r) => {
        if (!selectedRows.has(r.rowNumber)) return false;
        if (startDate && r.occurredDay && r.occurredDay < startDate) return false;
        if (endDate && r.occurredDay && r.occurredDay > endDate) return false;
        return r.status === "ready" || r.status === "duplicate";
      }).length
    : 0;

  const unmappedAccountsCount = preview
    ? preview.uniqueAccounts.filter((acc) => !accountMap[acc.rawName]).length
    : 0;

  function renderRowStatusBadge(row: StagedPreviewRow, checked: boolean) {
    if (row.status === "ready") {
      return (
        <span className="automation-status posted">
          <CheckCircle size={14} aria-hidden="true" /> Siap diimpor
        </span>
      );
    }
    if (row.status === "duplicate") {
      return (
        <span className="automation-status pending_confirmation">
          <WarningCircle size={14} aria-hidden="true" /> {checked ? "Diimpor (Override)" : "Lewati (Duplikat)"}
        </span>
      );
    }
    return <span className="automation-status" data-financial-state="source_voided">Perlu pemetaan</span>;
  }

  return (
    <div className="page import-page">
      <div>
        <Link className="settings-back" href="/transactions">
          <ArrowLeft size={17} /> Transactions
        </Link>
        <div className="page-heading finance-heading">
          <div>
            <span className="eyebrow">IMPOR TERKONTROL &amp; JEJAK AUDIT</span>
            <h1>Impor Transaksi (CSV / Excel)</h1>
            <p>Pratinjau baris, petakan akun dan kategori, tinjau kandidat duplikat, lalu konfirmasi sebelum masuk ke ledger.</p>
          </div>
        </div>
      </div>

      {error && (
        <p className="finance-error" role="alert">
          {error}
        </p>
      )}

      <section className="surface import-section">
        <SectionHeading title="1. Pilih file CSV atau Excel (.xlsx)" eyebrow="SUMBER DATA" />
        <div className={preview && preview.sheets.length > 1 ? "import-file-grid import-file-grid--split" : "import-file-grid"}>
          <label className="field import-file-field">
            <span>File sumber (.xlsx atau .csv)</span>
            <input
              type="file"
              className="import-file-input"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={pending || refreshing}
              onChange={(e) => void onFileSelected(e)}
            />
          </label>
          {preview && preview.sheets.length > 1 && (
            <label className="field">
              <span>Sheet Excel</span>
              <select
                value={sheetName}
                disabled={pending || refreshing}
                onChange={(e) => {
                  const nextSheet = e.target.value;
                  setSheetName(nextSheet);
                  setPage(1);
                  if (fileState) void runPreview(fileState, { sheetName: nextSheet, columnMapping: {} });
                }}
              >
                {preview.sheets.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="finance-hint import-section-hint">
          Format buku kerja referensi (sheet <code>Transactions</code>) dikenali secara otomatis. Tidak ada perubahan ke database sebelum Anda menekan tombol <strong>Simpan &amp; Impor Transaksi</strong>.
        </p>
      </section>

      {preview && fileState && (
        <>
          <section className="surface import-section">
            <SectionHeading title="2. Pemetaan Akun, Kategori & Kolom" eyebrow="KONFIGURASI PEMETAAN" />

            <div className="import-mapping-block">
              <div className="import-mapping-header">
                <div>
                  <strong>Pemetaan Akun ke Aset Aktif</strong>
                  <p className="finance-hint">
                    Setiap nama akun di file harus dipetakan ke aset aktif agar transaksi dapat masuk ke ledger.{" "}
                    <Link href="/settings/data" className="text-link">
                      Migrasi akun dari sheet Accounts →
                    </Link>
                  </p>
                </div>
                {unmappedAccountsCount > 0 && assets.length > 0 && (
                  <div className="import-quick-map">
                    <label className="field">
                      <span>Isi cepat {unmappedAccountsCount} akun yang belum dipetakan:</span>
                      <select
                        value=""
                        disabled={pending || refreshing}
                        onChange={(e) => {
                          if (e.target.value) mapAllUnmappedAccounts(e.target.value);
                        }}
                      >
                        <option value="">-- Pilih aset untuk mengisi semua --</option>
                        {assets.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            Samakan ke {asset.displayName} ({asset.currency})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>

              {preview.uniqueAccounts.length === 0 ? (
                <p className="finance-hint">Tidak ada nama akun yang terdeteksi.</p>
              ) : (
                <div className="import-mapping-grid">
                  {preview.uniqueAccounts.map((acc) => {
                    const mappedId = accountMap[acc.rawName] ?? "";
                    return (
                      <label className="field import-mapping-card" key={acc.rawName} data-mapped={Boolean(mappedId)}>
                        <span className="import-mapping-label">
                          <strong>{acc.rawName}</strong>
                          <small className={mappedId ? "pnl-positive" : "investment-warning"}>
                            {mappedId ? "Terpetakan" : "Wajib dipilih"}
                          </small>
                        </span>
                        <select
                          value={mappedId}
                          disabled={pending || refreshing}
                          onChange={(e) => updateAccountMapping(acc.rawName, e.target.value)}
                        >
                          <option value="">-- Pilih aset aktif --</option>
                          {assets.map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              {asset.displayName} ({asset.currency})
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="import-mapping-block">
              <div className="import-mapping-header">
                <div>
                  <strong>Pemetaan Kategori Transaksi ({preview.uniqueCategories.length} kategori)</strong>
                  <p className="finance-hint">
                    Kategori yang belum ada di katalog akan otomatis dibuat saat impor jika opsi di bawah ini aktif.
                  </p>
                </div>
                <label className="finance-history-toggle">
                  <input
                    type="checkbox"
                    checked={autoCreateCategories}
                    disabled={pending || refreshing}
                    onChange={(e) => updateAutoCreateCategories(e.target.checked)}
                  />{" "}
                  Buat kategori baru otomatis bila belum ada
                </label>
              </div>

              {preview.uniqueCategories.length > 0 && (
                <details className="investment-optional">
                  <summary>
                    Atur pemetaan rincian per kategori ({preview.uniqueCategories.length} kategori){" "}
                    <span>opsional</span>
                  </summary>
                  <div className="import-mapping-grid">
                    {preview.uniqueCategories.map((cat) => {
                      const key = `${cat.kind}:${cat.rawName}`;
                      const matchingCats = categories.filter((c) => c.isActive && c.appliesTo === cat.kind);
                      return (
                        <label className="field import-mapping-card" key={key}>
                          <span className="import-mapping-label">
                            <strong>{cat.rawName}</strong>
                            <small>{kindLabels[cat.kind]}</small>
                          </span>
                          <select
                            value={categoryMap[key] ?? (autoCreateCategories ? "__create__" : "")}
                            disabled={pending || refreshing}
                            onChange={(e) => updateCategoryMapping(key, e.target.value)}
                          >
                            <option value="__create__">+ Buat kategori baru &apos;{cat.rawName}&apos;</option>
                            <option value="__none__">Tanpa kategori</option>
                            {matchingCats.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.displayName}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>

            <details className="investment-optional">
              <summary>
                Pemetaan kolom tabel (Baris header #{preview.headerRowNumber}) <span>opsional</span>
              </summary>
              <div className="import-mapping-grid">
                {(
                  [
                    ["date", "Kolom Tanggal"],
                    ["kind", "Kolom Jenis (Income/Expense/Transfer)"],
                    ["account", "Kolom Akun"],
                    ["toAccount", "Kolom Akun Tujuan (Transfer)"],
                    ["category", "Kolom Kategori"],
                    ["note", "Kolom Deskripsi / Catatan"],
                    ["amount", "Kolom Nominal"],
                    ["status", "Kolom Status"],
                  ] as const
                ).map(([fieldKey, label]) => (
                  <label className="field" key={fieldKey}>
                    <span>{label}</span>
                    <select
                      value={columnMapping[fieldKey] ?? ""}
                      disabled={pending || refreshing}
                      onChange={(e) => {
                        const nextColMap = { ...columnMapping, [fieldKey]: e.target.value };
                        setColumnMapping(nextColMap);
                        if (fileState) void runPreview(fileState, { columnMapping: nextColMap });
                      }}
                    >
                      <option value="">(Tidak digunakan)</option>
                      {preview.availableColumns.map((col) => (
                        <option key={col.key} value={col.key}>
                          {col.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </details>
          </section>

          <section className="surface import-section">
            <SectionHeading title="3. Pratinjau Baris & Deteksi Duplikat" eyebrow="TINJAUAN SEBELUM COMMIT" />
            <div className="summary-strip import-summary-strip">
              <div>
                <span>Total baris terbaca</span>
                <strong>{preview.summary.totalRows}</strong>
              </div>
              <div>
                <span>Siap diimpor (Baru)</span>
                <strong className="pnl-positive">{preview.summary.readyCount}</strong>
              </div>
              <div>
                <span>Terdeteksi duplikat (Default: Lewati)</span>
                <strong className="investment-warning">{preview.summary.duplicateCount}</strong>
              </div>
              <div>
                <span>Perlu pemetaan / tidak valid</span>
                <strong className={preview.summary.invalidCount > 0 ? "pnl-negative" : undefined}>
                  {preview.summary.invalidCount + preview.summary.skippedStatusCount}
                </strong>
              </div>
            </div>

            <div className="import-filter-grid">
              <label className="field">
                <span>Filter status baris</span>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as typeof statusFilter);
                    setPage(1);
                  }}
                >
                  <option value="all">Semua baris ({preview.rows.length})</option>
                  <option value="ready">Siap diimpor ({preview.summary.readyCount})</option>
                  <option value="duplicate">Terdeteksi duplikat ({preview.summary.duplicateCount})</option>
                  <option value="invalid">
                    Belum valid / dilewati ({preview.summary.invalidCount + preview.summary.skippedStatusCount})
                  </option>
                </select>
              </label>
              <label className="field">
                <span>Dari tanggal (opsional)</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label className="field">
                <span>Sampai tanggal (opsional)</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
            </div>

            <div className="import-action-bar">
              <div className="investment-row-actions">
                <button type="button" className="row-action" onClick={selectAllVisibleReady}>
                  Pilih semua yang siap ({visibleRows.filter((r) => r.status === "ready").length})
                </button>
                <button type="button" className="row-action" onClick={clearVisibleSelection}>
                  Kosongkan pilihan
                </button>
                <span className="record-muted">· {activeSelectedCount} baris dipilih</span>
              </div>
              <button
                type="button"
                className="button-primary"
                disabled={pending || refreshing || activeSelectedCount === 0}
                aria-busy={pending}
                onClick={() => void commitSelected()}
              >
                {pending ? (
                  <LoadingIndicator>Menyimpan {activeSelectedCount} transaksi...</LoadingIndicator>
                ) : (
                  <>
                    <FileArrowUp size={17} /> Simpan &amp; Impor {activeSelectedCount} Transaksi
                  </>
                )}
              </button>
            </div>

            {pagedRows.length === 0 ? (
              <p className="finance-empty-inline">Tidak ada baris yang cocok dengan filter ini.</p>
            ) : (
              <FinancialDataTable
                label="Pratinjau baris impor transaksi"
                records={pagedRows}
                identity={(row) => String(row.rowNumber)}
                rowAction={{
                  onActivate: (row) => toggleRow(row, !selectedRows.has(row.rowNumber)),
                  disabled: pending || refreshing,
                }}
                columns={[
                  {
                    key: "select",
                    heading: "Pilih",
                    render: (row) => {
                      const checked = selectedRows.has(row.rowNumber);
                      const disabled = row.status === "invalid" || row.status === "skipped_status" || pending || refreshing;
                      return (
                        <input
                          type="checkbox"
                          className="import-row-checkbox"
                          checked={checked}
                          disabled={disabled}
                          aria-label={`Impor baris ${row.rowNumber}`}
                          onChange={(e) => toggleRow(row, e.target.checked)}
                        />
                      );
                    },
                  },
                  {
                    key: "row",
                    heading: "Baris",
                    render: (row) => <span className="record-muted">#{row.rowNumber}</span>,
                  },
                  {
                    key: "date",
                    heading: "Tanggal",
                    render: (row) => <time dateTime={row.occurredAt ?? undefined}>{row.occurredDay ?? row.rawDate}</time>,
                  },
                  {
                    key: "activity",
                    heading: "Catatan & Jenis",
                    render: (row) => (
                      <>
                        <strong>{row.note || (row.kind ? kindLabels[row.kind] : row.rawKind)}</strong>
                        <small data-kind={row.kind ?? undefined}>{row.kind ? kindLabels[row.kind] : row.rawKind}</small>
                      </>
                    ),
                  },
                  {
                    key: "account",
                    heading: "Akun & Kategori",
                    render: (row) => (
                      <>
                        <strong>
                          {row.kind === "transfer"
                            ? `${row.sourceAccountName} → ${row.destinationAccountName}`
                            : row.sourceAccountName || row.destinationAccountName || "—"}
                        </strong>
                        {row.categoryName && (
                          <small>
                            {row.categoryName}
                            {row.willCreateCategory ? " (+ Kategori baru)" : ""}
                          </small>
                        )}
                      </>
                    ),
                  },
                  {
                    key: "amount",
                    heading: "Nominal",
                    numeric: true,
                    render: (row) => (
                      <strong className="financial-value financial-value--row" data-kind={row.kind ?? undefined}>
                        {row.kind === "expense" ? "−" : row.kind === "income" ? "+" : ""}
                        {row.amountMinor ? formatMinor(row.amountMinor, defaultCurrency, defaultExponent) : row.rawAmount}
                      </strong>
                    ),
                  },
                  {
                    key: "status",
                    heading: "Status & Deteksi",
                    render: (row) => {
                      const checked = selectedRows.has(row.rowNumber);
                      return (
                        <div className="import-status-cell">
                          {renderRowStatusBadge(row, checked)}
                          {row.status === "duplicate" && row.duplicateReason && <small>{row.duplicateReason}</small>}
                          {(row.status === "invalid" || row.status === "skipped_status") && (
                            <small className="pnl-negative">
                              {row.validationErrors.join(" ") || row.duplicateReason}
                            </small>
                          )}
                        </div>
                      );
                    },
                  },
                ]}
                compact={(row) => {
                  const checked = selectedRows.has(row.rowNumber);
                  const disabled = row.status === "invalid" || row.status === "skipped_status" || pending || refreshing;
                  return (
                    <div
                      className="import-compact-row"
                      data-selected={checked}
                      onClick={(e) => {
                        if (!disabled && !(e.target as HTMLElement).closest("input")) {
                          toggleRow(row, !checked);
                        }
                      }}
                    >
                      <input
                        type="checkbox"
                        className="import-row-checkbox"
                        checked={checked}
                        disabled={disabled}
                        aria-label={`Impor baris ${row.rowNumber}`}
                        onChange={(e) => toggleRow(row, e.target.checked)}
                      />
                      <div className="import-compact-body">
                        <div className="import-compact-top">
                          <strong>{row.note || (row.kind ? kindLabels[row.kind] : row.rawKind)}</strong>
                          <strong className="financial-value" data-kind={row.kind ?? undefined}>
                            {row.kind === "expense" ? "−" : row.kind === "income" ? "+" : ""}
                            {row.amountMinor ? formatMinor(row.amountMinor, defaultCurrency, defaultExponent) : row.rawAmount}
                          </strong>
                        </div>
                        <div className="import-compact-meta">
                          <span>
                            #{row.rowNumber} · {row.occurredDay ?? row.rawDate} ·{" "}
                            {row.kind === "transfer"
                              ? `${row.sourceAccountName} → ${row.destinationAccountName}`
                              : row.sourceAccountName || row.destinationAccountName}
                            {row.categoryName ? ` · ${row.categoryName}` : ""}
                          </span>
                        </div>
                        <div className="import-compact-status">
                          {renderRowStatusBadge(row, checked)}
                          {row.status === "duplicate" && row.duplicateReason && <small>{row.duplicateReason}</small>}
                          {(row.status === "invalid" || row.status === "skipped_status") && (
                            <small className="pnl-negative">
                              {row.validationErrors.join(" ") || row.duplicateReason}
                            </small>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
            )}

            {visibleRows.length > PAGE_SIZE && (
              <ListToolbar label="Halaman pratinjau impor">
                <button
                  type="button"
                  className="row-action"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Sebelumnya
                </button>
                <span className="record-muted">
                  Halaman {safePage} dari {totalPages} ({visibleRows.length} baris)
                </span>
                <button
                  type="button"
                  className="row-action"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Berikutnya
                </button>
              </ListToolbar>
            )}
          </section>
        </>
      )}

      <section className="surface import-section">
        <SectionHeading title="Riwayat & Jejak Impor (Traceability)" eyebrow="AUDIT BATCH IMPOR" />
        {batches.length === 0 ? (
          <p className="finance-hint">Belum ada riwayat batch impor yang disimpan.</p>
        ) : (
          <FinancialDataTable
            label="Riwayat batch impor"
            records={batches}
            identity={(b) => b.id}
            columns={[
              {
                key: "createdAt",
                heading: "Waktu Impor",
                render: (b) => (
                  <time dateTime={b.createdAt}>
                    {new Date(b.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB
                  </time>
                ),
              },
              {
                key: "file",
                heading: "File & Sheet",
                render: (b) => (
                  <>
                    <strong>{b.fileName}</strong>
                    <small>
                      {b.sourceFormat.toUpperCase()}
                      {b.sheetName ? ` · Sheet: ${b.sheetName}` : ""}
                    </small>
                  </>
                ),
              },
              {
                key: "imported",
                heading: "Diimpor",
                numeric: true,
                render: (b) => <strong className="pnl-positive">{b.importedCount} baris</strong>,
              },
              {
                key: "skipped",
                heading: "Dilewati",
                numeric: true,
                render: (b) => <span className="record-muted">{b.skippedCount} baris</span>,
              },
              {
                key: "categories",
                heading: "Kategori Baru",
                numeric: true,
                render: (b) => <span>{b.createdCategoriesCount}</span>,
              },
            ]}
            compact={(b) => (
              <div className="import-compact-row">
                <div className="import-compact-body">
                  <div className="import-compact-top">
                    <strong>{b.fileName}</strong>
                    <strong className="pnl-positive">{b.importedCount} diimpor</strong>
                  </div>
                  <div className="import-compact-meta">
                    <span>
                      {new Date(b.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB ·{" "}
                      {b.sourceFormat.toUpperCase()}
                      {b.sheetName ? ` (${b.sheetName})` : ""} · {b.skippedCount} dilewati
                    </span>
                  </div>
                </div>
              </div>
            )}
          />
        )}
      </section>
    </div>
  );
}
