"use client";

import { useActivityPage } from "./activity-page";
import { useListSort } from "./use-list-sort";
import { useMemo, useRef, useState } from "react";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import {
  ArrowRight,
  ArrowsDownUp,
  CheckCircle,
  DownloadSimple,
  FileArrowUp,
  Funnel,
} from "@phosphor-icons/react";
import { financeRequest } from "@/lib/finance/client";
import { formatMinor, minorToInput } from "@/lib/finance/format";
import type { TransactionPreset } from "@/lib/domain/transaction-preset";
import type { FinanceActivity } from "@/lib/finance/types";
import { PageTabs } from "./page-tabs";
import { TransactionEditor } from "./transaction-editor";
import { AppLink } from "./app-link";
import { useInspector } from "./inspector";
import { PageHeading } from "./ui";
import { ExcelStatusBar } from "./excel-status-bar";
import { ICON_SM } from "./icon-size";

const labels: Record<FinanceActivity["kind"], string> = {
  income: "Pemasukan",
  expense: "Pengeluaran",
  transfer: "Transfer / Top-Up",
  borrow: "Pinjam",
  repay: "Bayar Kredit",
  refund: "Refund",
  adjustment: "Koreksi",
};

const isFlowKind = (kind: FinanceActivity["kind"]) =>
  kind === "transfer" || kind === "borrow" || kind === "repay";

function totalMinor(item: FinanceActivity) {
  return (
    BigInt(item.baseAmountMinor) +
    item.charges.reduce((sum, charge) => sum + BigInt(charge.amountMinor), 0n)
  ).toString();
}

function feeMinor(item: FinanceActivity) {
  return item.charges.reduce((sum, charge) => sum + BigInt(charge.amountMinor), 0n).toString();
}

/**
 * Inspector body for one activity. Correction opens the editor (a replacement); cancellation posts a void
 * (reversal movements). Both keep the original record, as the ledger is append-only.
 */
function ActivityInspector({
  item,
  onEdit,
  onRefund,
}: {
  item: FinanceActivity;
  onEdit: (item: FinanceActivity) => void;
  onRefund: (item: FinanceActivity) => void;
}) {
  const { refresh, notify } = useFinanceFeedback();
  const { close } = useInspector();
  const { pending, begin, finish } = useMutationPending();
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState("");
  const replay = useRef<string | null>(null);

  async function remove() {
    if (!begin()) return;
    setError("");
    try {
      replay.current ??= crypto.randomUUID();
      await financeRequest("void", { id: item.id, idempotencyKey: replay.current });
      close();
      refresh();
      notify("Transaksi berhasil dibatalkan.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pembatalan gagal.");
    } finally {
      finish();
    }
  }

  const money = (value: string) => formatMinor(value, item.currency, item.exponent);
  const canRefund =
    item.kind === "expense" &&
    item.status === "posted" &&
    BigInt(item.netMinor ?? item.baseAmountMinor) > 0n;

  return (
    <div aria-busy={pending}>
      <dl className="inspector-facts">
        <div>
          <dt>Status</dt>
          <dd>
            {item.status === "posted"
              ? "Aktif"
              : item.status === "voided"
              ? "Dibatalkan"
              : "Diganti oleh koreksi"}
          </dd>
        </div>
        <div>
          <dt>Jenis</dt>
          <dd>{labels[item.kind]}</dd>
        </div>
        {item.adjustmentReason && (
          <div>
            <dt>Alasan koreksi</dt>
            <dd>
              {item.adjustmentReason === "opening_debt"
                ? "Saldo awal utang"
                : "Rekonsiliasi saldo"}
            </dd>
          </div>
        )}
        {item.refundOfActivityId && (
          <div>
            <dt>Refund atas</dt>
            <dd>{item.refundOfActivityId}</dd>
          </div>
        )}
        {item.recurringRuleName && (
          <div>
            <dt>Asal</dt>
            <dd>Otomatisasi: {item.recurringRuleName}</dd>
          </div>
        )}
        {(item.eventSourceIncomeId || item.automationSourceActivityId) && (
          <div>
            <dt>Dipicu oleh</dt>
            <dd>
              {labels[item.automationSourceKind ?? "income"]}{" "}
              {item.eventSourceAmountMinor
                ? formatMinor(
                    item.eventSourceAmountMinor,
                    item.eventSourceCurrency ?? item.currency,
                    item.eventSourceExponent ?? item.exponent
                  )
                : ""}{" "}
              ·{" "}
              {item.eventSourceOccurredAt
                ? new Date(item.eventSourceOccurredAt).toLocaleString("id-ID")
                : ""}
            </dd>
          </div>
        )}
        {item.sourceName && (
          <div>
            <dt>Dari</dt>
            <dd>{item.sourceName}</dd>
          </div>
        )}
        {item.destinationName && (
          <div>
            <dt>Ke</dt>
            <dd>{item.destinationName}</dd>
          </div>
        )}
        {item.categoryName && (
          <div>
            <dt>Kategori</dt>
            <dd>{item.categoryName}</dd>
          </div>
        )}
        <div>
          <dt>Waktu</dt>
          <dd>
            {new Date(item.occurredAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
          </dd>
        </div>
        <div>
          <dt>Jumlah dasar</dt>
          <dd>{money(item.baseAmountMinor)}</dd>
        </div>
        {item.charges.map((charge) => (
          <div key={charge.id}>
            <dt>{charge.typeName}</dt>
            <dd>{money(charge.amountMinor)}</dd>
          </div>
        ))}
        <div className="detail-total">
          <dt>{isFlowKind(item.kind) ? "Pokok + biaya" : "Total"}</dt>
          <dd>{money(totalMinor(item))}</dd>
        </div>
        {item.refundedMinor && BigInt(item.refundedMinor) > 0n && (
          <>
            <div>
              <dt>Di-refund</dt>
              <dd>{money(item.refundedMinor)}</dd>
            </div>
            <div>
              <dt>Pengeluaran bersih</dt>
              <dd>{money(item.netMinor ?? item.baseAmountMinor)}</dd>
            </div>
          </>
        )}
      </dl>
      {item.allocationAdjustmentId && (
        <p className="inspector-note">
          Penyesuaian alokasi: transaksi tambahan dari peninjauan pemasukan. Transaksi awal tetap
          tersimpan; hasil ini mengikuti alur koreksi dan pembatalan biasa.
        </p>
      )}
      {item.note && <p className="inspector-note">{item.note}</p>}
      {isFlowKind(item.kind) && (
        <p className="inspector-note ui-muted">
          Pokok berpindah antar akun tanpa mengubah total. Hanya biayanya mengurangi total.
        </p>
      )}
      {item.status === "posted" && !confirmVoid && (
        <div className="finance-actions">
          <button
            type="button"
            className="finance-secondary"
            disabled={pending}
            onClick={() => {
              close();
              onEdit(item);
            }}
          >
            Koreksi
          </button>
          {canRefund && (
            <button
              type="button"
              className="finance-secondary"
              disabled={pending}
              onClick={() => {
                close();
                onRefund(item);
              }}
            >
              Catat refund
            </button>
          )}
          <button
            type="button"
            className="finance-danger"
            disabled={pending}
            onClick={() => setConfirmVoid(true)}
          >
            Batalkan transaksi
          </button>
        </div>
      )}
      {confirmVoid && (
        <div className="finance-confirm">
          <p>
            Batalkan transaksi ini? Semua pergerakannya akan dibalik. Catatan asli tetap ada dalam
            riwayat.
          </p>
          <button
            type="button"
            className="finance-danger"
            onClick={remove}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? <LoadingIndicator>Membatalkan…</LoadingIndicator> : "Ya, batalkan"}
          </button>
          <button
            type="button"
            className="finance-secondary"
            onClick={() => setConfirmVoid(false)}
            disabled={pending}
          >
            Kembali
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="finance-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function TransactionsView({
  activities,
  monthly,
}: {
  activities: FinanceActivity[];
  monthly: { currency: string; exponent: number; expenseMinor: string }[];
}) {
  const { refreshing } = useFinanceFeedback();
  const { open } = useInspector();
  const [kindFilter, setKindFilter] = useState<"all" | FinanceActivity["kind"]>("all");
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [editing, setEditing] = useState<FinanceActivity | null>(null);
  const [refundPreset, setRefundPreset] = useState<TransactionPreset | null>(null);
  const sort = useListSort("transactions");

  // Server paginated feed
  const activityPage = useActivityPage(activities, kindFilter, true, sort.direction);
  const rawItems = activityPage.items;

  // Account names from activities
  const accountNames = useMemo(() => {
    const set = new Set<string>();
    activities.forEach((a) => {
      if (a.sourceName) set.add(a.sourceName);
      if (a.destinationName) set.add(a.destinationName);
    });
    return Array.from(set).sort();
  }, [activities]);

  // Client filtering on top of server feed
  const filteredItems = useMemo(() => {
    let list = rawItems;
    if (accountFilter !== "ALL") {
      const q = accountFilter.toLowerCase();
      list = list.filter(
        (t) =>
          t.sourceName?.toLowerCase().includes(q) || t.destinationName?.toLowerCase().includes(q)
      );
    }
    if (sortBy === "amount") {
      list = [...list].sort((a, b) => {
        const amtA = BigInt(totalMinor(a));
        const amtB = BigInt(totalMinor(b));
        return amtB > amtA ? 1 : amtB < amtA ? -1 : 0;
      });
    }
    return list;
  }, [rawItems, accountFilter, sortBy]);

  // Voided / corrected activities for Tab 4
  const auditItems = useMemo(() => {
    return activities.filter(
      (a) => a.status === "voided" || a.status === "superseded" || Boolean(a.adjustmentReason)
    );
  }, [activities]);

  function triggerToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }

  function downloadCsv() {
    const headers =
      "Tanggal,Waktu,Jenis,Akun Sumber,Akun Tujuan,Kategori,Keterangan,Nominal Pokok,Biaya,Total\n";
    const rows = filteredItems
      .map((t) => {
        const d = new Date(t.occurredAt);
        const date = d.toISOString().slice(0, 10);
        const time = d.toTimeString().slice(0, 8);
        const fee = feeMinor(t);
        const tot = totalMinor(t);
        const noteEscaped = (t.note || "").replace(/"/g, '""');
        return `${date},${time},${t.kind},"${t.sourceName || ""}","${t.destinationName || ""}","${
          t.categoryName || ""
        }","${noteEscaped}",${t.baseAmountMinor},${fee},${tot}`;
      })
      .join("\n");

    const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moneytor_buku_mutasi_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    triggerToast("Berkas CSV Buku Mutasi berhasil diunduh.");
  }

  function openRefund(item: FinanceActivity) {
    setRefundPreset({
      kind: "refund",
      refundOfActivityId: item.id,
      accountId: item.sourceAssetId ?? undefined,
      amount: minorToInput(item.netMinor ?? item.baseAmountMinor, item.exponent),
      note: item.note ? `Refund ${item.note}` : "Refund pengeluaran",
    });
  }

  function openDetails(item: FinanceActivity, trigger?: HTMLElement | null) {
    if (refreshing) return;
    const when = new Date(item.occurredAt).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    });
    open(
      {
        id: `activity:${item.id}`,
        title: item.note || labels[item.kind],
        subtitle: `${labels[item.kind]} · ${when} · ${
          item.status === "posted" ? "Aktif" : item.status === "voided" ? "Dibatalkan" : "Dikoreksi"
        }`,
        body: (
          <ActivityInspector
            key={item.id}
            item={item}
            onEdit={setEditing}
            onRefund={openRefund}
          />
        ),
      },
      trigger ?? (document.activeElement as HTMLElement | null)
    );
  }

  // Totals for ExcelStatusBar
  const totalInMinor = filteredItems
    .filter((t) => t.kind === "income" && t.status === "posted")
    .reduce((sum, t) => sum + BigInt(t.baseAmountMinor), 0n);

  const totalOutMinor = filteredItems
    .filter((t) => (t.kind === "expense" || isFlowKind(t.kind)) && t.status === "posted")
    .reduce((sum, t) => {
      if (t.kind === "expense") return sum + BigInt(totalMinor(t));
      // Flow kinds only count fee
      return sum + BigInt(feeMinor(t));
    }, 0n);

  const totalFeeMinor = filteredItems
    .filter((t) => t.status === "posted")
    .reduce((sum, t) => sum + BigInt(feeMinor(t)), 0n);

  const primary = filteredItems[0];
  const pCurr = primary?.currency ?? "IDR";
  const pExp = primary?.exponent ?? 0;

  const currentMonthExpense = useMemo(() => {
    const item = monthly.find((m) => m.currency === pCurr);
    if (!item) return null;
    return formatMinor(item.expenseMinor, item.currency, item.exponent);
  }, [monthly, pCurr]);

  // Command Ribbon
  const commandRibbon = (
    <div className="mutasi-ribbon">
      <div className="mutasi-ribbon-group">
        <span className="mutasi-ribbon-label">
          <Funnel size={14} aria-hidden="true" /> Filter:
        </span>
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="mutasi-select"
          aria-label="Filter berdasarkan akun"
        >
          <option value="ALL">Semua Akun</option>
          {accountNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as "all" | FinanceActivity["kind"])}
          className="mutasi-select"
          aria-label="Filter berdasarkan jenis transaksi"
        >
          <option value="all">Semua Jenis</option>
          <option value="expense">Pengeluaran</option>
          <option value="income">Pemasukan</option>
          <option value="transfer">Transfer / Top-Up</option>
          <option value="repay">Bayar Kredit</option>
          <option value="refund">Refund</option>
          <option value="borrow">Pinjam</option>
          <option value="adjustment">Koreksi</option>
        </select>
      </div>

      <div className="mutasi-ribbon-group">
        <button
          type="button"
          onClick={() => setSortBy((prev) => (prev === "date" ? "amount" : "date"))}
          className="mutasi-btn"
          title="Ubah urutan transaksi"
        >
          <ArrowsDownUp size={14} aria-hidden="true" />
          <span>{sortBy === "date" ? "Terbaru" : "Nominal"}</span>
        </button>

        <button
          type="button"
          onClick={downloadCsv}
          className="mutasi-btn"
          title="Unduh data mutasi format CSV"
        >
          <DownloadSimple size={14} weight="bold" aria-hidden="true" />
          <span>Ekspor .CSV</span>
        </button>
      </div>
    </div>
  );

  // Tab 1: Semua Mutasi
  const semuaPanel = (
    <div>
      {commandRibbon}

      {/* Desktop 8-Column Table */}
      <div className="mutasi-table-wrapper mutasi-table-desktop">
        <table className="mutasi-table">
          <thead>
            <tr>
              <th>Tanggal &amp; Waktu</th>
              <th>Jenis</th>
              <th>Akun Sumber → Tujuan</th>
              <th>Kategori</th>
              <th>Catatan / Keterangan</th>
              <th className="mutasi-text-right">Nominal Pokok</th>
              <th className="mutasi-text-right">Biaya Admin</th>
              <th className="mutasi-text-right">Total Mutasi</th>
            </tr>
          </thead>
          <tbody>
            {!filteredItems.length ? (
              <tr>
                <td colSpan={8} className="mutasi-empty-state">
                  {activityPage.loading
                    ? "Memuat data mutasi…"
                    : "Tidak ada transaksi pada filter ini."}
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => {
                const d = new Date(item.occurredAt);
                const dateStr = d.toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "Asia/Jakarta",
                });
                const timeStr = d.toLocaleTimeString("id-ID", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Jakarta",
                });
                const feeBig = BigInt(feeMinor(item));
                const isVoided = item.status === "voided";

                return (
                  <tr
                    key={item.id}
                    data-voided={isVoided}
                    onClick={() => openDetails(item)}
                    title="Klik untuk membuka rincian transaksi"
                  >
                    <td>
                      <div>
                        <strong>{dateStr}</strong>
                      </div>
                      <div className="mutasi-time-sub">
                        {timeStr} · {item.id.slice(0, 8)}
                      </div>
                    </td>
                    <td>
                      <span className={`mutasi-badge mutasi-badge--${item.kind}`}>
                        {labels[item.kind]}
                      </span>
                    </td>
                    <td>
                      <div className="mutasi-route-arrow">
                        <span>{item.sourceName || "—"}</span>
                        {item.destinationName && (
                          <>
                            <ArrowRight size={12} aria-hidden="true" />
                            <span className="mutasi-route-dest">{item.destinationName}</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td>{item.categoryName || "—"}</td>
                    <td className="mutasi-note-cell">
                      <div className="mutasi-note-text">{item.note || labels[item.kind]}</div>
                      {item.status === "superseded" && (
                        <span className="mutasi-badge-corrected">Dikoreksi</span>
                      )}
                    </td>
                    <td className="mutasi-text-right mutasi-tabular">
                      {formatMinor(item.baseAmountMinor, item.currency, item.exponent)}
                    </td>
                    <td className="mutasi-text-right mutasi-tabular">
                      {feeBig > 0n ? (
                        <span className="mutasi-fee">
                          {formatMinor(feeBig.toString(), item.currency, item.exponent)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      className={`mutasi-text-right mutasi-tabular ${
                        item.kind === "income"
                          ? "mutasi-amount--in"
                          : item.kind === "expense"
                          ? "mutasi-amount--out"
                          : "mutasi-amount--neutral"
                      }`}
                    >
                      {item.kind === "income" ? "+" : item.kind === "expense" ? "−" : ""}
                      {formatMinor(totalMinor(item), item.currency, item.exponent)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List */}
      <div className="mutasi-list-mobile">
        {!filteredItems.length ? (
          <div className="mutasi-empty-state">
            {activityPage.loading
              ? "Memuat data mutasi…"
              : "Tidak ada transaksi pada filter ini."}
          </div>
        ) : (
          filteredItems.map((item) => {
            const d = new Date(item.occurredAt);
            const dateStr = d.toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
              timeZone: "Asia/Jakarta",
            });
            const feeBig = BigInt(feeMinor(item));
            return (
              <div
                key={item.id}
                className="mutasi-mobile-item"
                data-voided={item.status === "voided"}
                onClick={() => openDetails(item)}
              >
                <div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <span className={`mutasi-badge mutasi-badge--${item.kind}`}>
                      {labels[item.kind]}
                    </span>
                    <small className="mutasi-time-sub">{dateStr}</small>
                  </div>
                  <div style={{ fontWeight: 600, marginTop: "4px" }}>
                    {item.note || labels[item.kind]}
                  </div>
                  <small style={{ color: "var(--subtle)" }}>
                    {item.sourceName}
                    {item.destinationName ? ` → ${item.destinationName}` : ""}
                  </small>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    className={
                      item.kind === "income"
                        ? "mutasi-amount--in"
                        : item.kind === "expense"
                        ? "mutasi-amount--out"
                        : "mutasi-amount--neutral"
                    }
                  >
                    {item.kind === "income" ? "+" : item.kind === "expense" ? "−" : ""}
                    {formatMinor(totalMinor(item), item.currency, item.exponent)}
                  </div>
                  {feeBig > 0n && (
                    <div className="mutasi-fee">
                      Admin {formatMinor(feeBig.toString(), item.currency, item.exponent)}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      <div className="mutasi-pager">
        <button
          type="button"
          className="mutasi-btn"
          disabled={activityPage.loading || activityPage.pageNumber === 1}
          onClick={activityPage.previous}
        >
          Sebelumnya
        </button>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--subtle)" }}>
          Halaman {activityPage.pageNumber}
        </span>
        <button
          type="button"
          className="mutasi-btn"
          disabled={activityPage.loading || !activityPage.hasNext}
          onClick={activityPage.next}
        >
          Berikutnya
        </button>
      </div>
    </div>
  );

  // Tab 2: Otomatisasi & Jadwal
  const otomatisasiPanel = (
    <div className="mutasi-tab-card">
      <div className="mutasi-tab-card-header">
        <div>
          <h2 className="mutasi-tab-card-title">Otomatisasi &amp; Transaksi Terjadwal</h2>
          <p className="mutasi-tab-card-desc">
            Kelola aturan mutasi berulang, pembagian alokasi gaji otomatis, dan jadwal transaksi.
          </p>
        </div>
        <AppLink href="/transactions/automation" className="button-primary">
          Buka Ruang Kerja Otomatisasi <ArrowRight size={ICON_SM} aria-hidden="true" />
        </AppLink>
      </div>
      <div>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)" }}>
          Transaksi otomatis yang dieksekusi akan tercatat secara resmi di Buku Mutasi dengan tanda
          khusus <strong>Otomatisasi</strong>.
        </p>
      </div>
    </div>
  );

  // Tab 3: Impor CSV / Excel
  const imporPanel = (
    <div className="mutasi-tab-card">
      <div className="mutasi-tab-card-header">
        <div>
          <h2 className="mutasi-tab-card-title">
            Impor e-Statement CSV / Excel (BCA, Mandiri, GoPay)
          </h2>
          <p className="mutasi-tab-card-desc">
            Deteksi otomatis biaya admin BI-FAST, pemetaan kategori belanja, dan rekonsiliasi.
          </p>
        </div>
        <AppLink href="/transactions/imports" className="button-primary">
          <FileArrowUp size={ICON_SM} aria-hidden="true" />
          <span>Buka Ruang Kerja Impor</span>
        </AppLink>
      </div>
      <div>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)" }}>
          Unggah rekening koran digital bank atau e-wallet Anda. Sistem akan memetakan mutasi dan
          mendeteksi transaksi ganda secara cerdas sebelum dimasukkan ke dalam buku besar.
        </p>
      </div>
    </div>
  );

  // Tab 4: Riwayat Koreksi & Void
  const auditPanel = (
    <div className="mutasi-tab-card">
      <div className="mutasi-tab-card-header">
        <div>
          <h2 className="mutasi-tab-card-title">Riwayat Koreksi &amp; Pembatalan (Audit Trail)</h2>
          <p className="mutasi-tab-card-desc">
            Log buku besar append-only: semua pembatalan (void) dan penyesuaian tersimpan permanen.
          </p>
        </div>
      </div>

      {!auditItems.length ? (
        <p className="mutasi-empty-state">
          Belum ada riwayat transaksi yang dibatalkan atau dikoreksi.
        </p>
      ) : (
        <div>
          {auditItems.map((item) => {
            const when = new Date(item.occurredAt).toLocaleString("id-ID", {
              timeZone: "Asia/Jakarta",
            });
            return (
              <div key={item.id} className="mutasi-audit-row">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <small style={{ color: "var(--subtle)" }}>
                    {item.id.slice(0, 8)} · {when}
                  </small>
                  <span className="mutasi-badge-corrected">
                    {item.status === "voided" ? "Dibatalkan" : "Dikoreksi"}
                  </span>
                </div>
                <div style={{ fontWeight: 600, margin: "4px 0" }}>
                  {item.note || labels[item.kind]} — {item.sourceName}
                  {item.destinationName ? ` → ${item.destinationName}` : ""}
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--subtle)" }}>
                  Nominal: {formatMinor(item.baseAmountMinor, item.currency, item.exponent)}
                  {item.adjustmentReason ? ` · Alasan: ${item.adjustmentReason}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const heading = (
    <PageHeading
      title="Buku Mutasi"
      description={`Total ${activities.length} aktivitas tercatat${
        currentMonthExpense ? ` · Belanja bulan ini ${currentMonthExpense}` : ""
      }`}
      actions={
        toastMsg ? (
          <div
            style={{
              padding: "4px 10px",
              borderRadius: "var(--radius-md)",
              background: "var(--positive-light)",
              color: "var(--positive)",
              fontSize: "var(--text-2xs)",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <CheckCircle size={14} weight="bold" aria-hidden="true" />
            <span>{toastMsg}</span>
          </div>
        ) : undefined
      }
    />
  );

  return (
    <div className="page transactions-page">
      <PageTabs
        label="Lembar Kerja Buku Mutasi"
        heading={heading}
        tabs={[
          { id: "semua", label: "Semua Mutasi", panel: semuaPanel },
          { id: "otomatisasi", label: "Otomatisasi & Jadwal", panel: otomatisasiPanel },
          { id: "impor", label: "Impor CSV / Excel", panel: imporPanel },
          { id: "audit", label: "Riwayat Koreksi & Void", panel: auditPanel },
        ]}
      />

      <ExcelStatusBar
        rowCount={filteredItems.length}
        totalIn={formatMinor(totalInMinor.toString(), pCurr, pExp)}
        totalOut={formatMinor(totalOutMinor.toString(), pCurr, pExp)}
        extraLabel={
          totalFeeMinor > 0n
            ? `Total Biaya Admin: ${formatMinor(totalFeeMinor.toString(), pCurr, pExp)}`
            : undefined
        }
      />

      {editing && (
        <TransactionEditor
          key={editing.id}
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {refundPreset && (
        <TransactionEditor
          key={`refund:${refundPreset.refundOfActivityId}`}
          preset={refundPreset}
          onClose={() => setRefundPreset(null)}
        />
      )}
    </div>
  );
}
