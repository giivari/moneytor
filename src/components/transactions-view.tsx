"use client";

import { useActivityPage } from "./activity-page";
import { useListSort } from "./use-list-sort";
import { useEffect, useMemo, useRef, useState } from "react";
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
import type { AutomationView } from "@/lib/automation/service";
import type { IncomeEventView } from "@/lib/automation/income-events";
import type { GeneralView } from "@/lib/automation/composable-service";
import { PageTabs } from "./page-tabs";
import { TransactionEditor } from "./transaction-editor";
import { AppLink } from "./app-link";
import { useInspector, useInspectorSync, type InspectorEntry } from "./inspector";
import type { ActivityTotals } from "@/lib/domain/activity-totals";
import { InspectorFacts } from "./inspector-facts";
import { Amount, Chip, PageHeading } from "./ui";
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

const kindTones: Record<
  FinanceActivity["kind"],
  "positive" | "negative" | "info" | "warning" | "neutral"
> = {
  income: "positive",
  expense: "negative",
  transfer: "info",
  borrow: "warning",
  repay: "positive",
  refund: "positive",
  adjustment: "neutral",
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

function shortRefCode(id: string) {
  const clean = id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `MUT-${clean.slice(0, 4)}-${clean.slice(-4)}`;
}

/**
 * Inspector body for one activity rendered in Figma Make's 3-card layout.
 * Correction opens the editor (a replacement); cancellation posts a void (reversal movements).
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
  const refundableMinor = item.netMinor ?? item.baseAmountMinor;
  const canRefund =
    item.kind === "expense" && item.status === "posted" && BigInt(refundableMinor) > 0n;
  const sign = item.kind === "expense" ? "−" : item.kind === "income" ? "+" : "";
  const amountTone = item.kind === "expense" ? "negative" : item.kind === "income" ? "positive" : "";
  const routeText =
    item.sourceName && item.destinationName
      ? `${item.sourceName} → ${item.destinationName}`
      : item.sourceName || item.destinationName || "—";
  const occurredText = new Date(item.occurredAt).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  });
  const statusText =
    item.status === "posted"
      ? "Aktif"
      : item.status === "voided"
      ? "Dibatalkan"
      : "Diganti oleh koreksi";

  return (
    <div className="inspector-cards" aria-busy={pending}>
      {/* Kartu 1: Ringkasan Hero */}
      <section className="inspector-card inspector-card--hero">
        <div className="inspector-card-top">
          <span className="inspector-ref-badge">{shortRefCode(item.id)}</span>
          <Chip tone={kindTones[item.kind]}>{labels[item.kind]}</Chip>
        </div>
        <div className="inspector-hero-metric">
          <span className="inspector-hero-caption">
            {isFlowKind(item.kind) ? "Total Arus Kas Dipindahkan" : "Total Mutasi Rekening"}
          </span>
          <div className="inspector-hero-amount">
            <Amount value={`${sign}${money(totalMinor(item))}`} level="summary" tone={amountTone} />
          </div>
        </div>
        {item.note && <p className="inspector-hero-title">{item.note}</p>}
        <div className="inspector-meta-grid">
          <div>
            <span className="inspector-meta-label">Tanggal &amp; Waktu</span>
            <strong className="inspector-meta-value">{occurredText}</strong>
          </div>
          <div>
            <span className="inspector-meta-label">Kategori</span>
            <strong className="inspector-meta-value">{item.categoryName || labels[item.kind]}</strong>
          </div>
        </div>
        <div className="inspector-flow-box">
          <span className="inspector-meta-label">Alur Rekening (Sumber → Tujuan)</span>
          <strong className="inspector-flow-route">{routeText}</strong>
        </div>
      </section>

      {/* Kartu 2: Bedah Komponen Akuntansi */}
      <section className="inspector-card inspector-card--breakdown">
        <h3 className="inspector-card-heading">Bedah Komponen Akuntansi</h3>
        <InspectorFacts
          items={[
            { label: "Status", value: statusText },
            { label: "Jenis", value: labels[item.kind] },
            ...(item.adjustmentReason
              ? [
                  {
                    label: "Alasan koreksi",
                    value:
                      item.adjustmentReason === "opening_debt"
                        ? "Saldo awal utang"
                        : "Rekonsiliasi saldo",
                  },
                ]
              : []),
            ...(item.refundOfActivityId
              ? [{ label: "Refund atas", value: item.refundOfActivityId }]
              : []),
            ...(item.recurringRuleName
              ? [{ label: "Asal", value: `Otomatisasi: ${item.recurringRuleName}` }]
              : []),
            ...(item.eventSourceIncomeId || item.automationSourceActivityId
              ? [
                  {
                    label: "Dipicu oleh",
                    value: `${labels[item.automationSourceKind ?? "income"]} ${
                      item.eventSourceAmountMinor
                        ? formatMinor(
                            item.eventSourceAmountMinor,
                            item.eventSourceCurrency ?? item.currency,
                            item.eventSourceExponent ?? item.exponent
                          )
                        : ""
                    }`,
                  },
                ]
              : []),
            { label: "Nominal pokok", value: <Amount value={money(item.baseAmountMinor)} /> },
            ...item.charges.map((charge) => ({
              label: charge.typeName,
              value: <Amount value={money(charge.amountMinor)} />,
            })),
            {
              label: isFlowKind(item.kind) ? "Pokok + biaya" : "Total arus kas riil",
              value: <Amount value={`${sign}${money(totalMinor(item))}`} tone={amountTone} />,
            },
            ...(item.refundedMinor && BigInt(item.refundedMinor) > 0n
              ? [
                  {
                    label: "Di-refund",
                    value: <Amount value={money(item.refundedMinor)} tone="positive" />,
                  },
                  {
                    label: "Pengeluaran bersih",
                    value: <Amount value={money(refundableMinor)} />,
                  },
                ]
              : []),
          ]}
        />
        {item.kind === "expense" && (
          <div className="inspector-highlight-box">
            <span>Porsi Konsumsi Murni Pribadi</span>
            <strong>{money(refundableMinor)}</strong>
          </div>
        )}
        {item.allocationAdjustmentId && (
          <p className="inspector-note">
            Penyesuaian alokasi: transaksi tambahan dari peninjauan pemasukan.
          </p>
        )}
        {isFlowKind(item.kind) && (
          <p className="inspector-note ui-muted">
            Pokok berpindah antar akun tanpa mengubah kekayaan bersih; hanya biaya admin yang mengurangi saldo.
          </p>
        )}
      </section>

      {/* Kartu 3: Tindakan Koreksi / Refund / Void */}
      {item.status === "posted" && !confirmVoid && (
        <section className="inspector-card inspector-card--actions">
          <div className="mutasi-inspector-actions">
            <button
              type="button"
              className="finance-secondary"
              disabled={pending}
              onClick={() => {
                close();
                onEdit(item);
              }}
            >
              Koreksi Nominal
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
              Void / Batalkan
            </button>
          </div>
        </section>
      )}

      {confirmVoid && (
        <section className="inspector-card inspector-card--actions">
          <div className="finance-confirm">
            <p>
              Batalkan transaksi ini? Semua pergerakannya akan dibalik dan catatan asli tetap tersimpan di jejak audit.
            </p>
            <div className="mutasi-inspector-actions">
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
          </div>
        </section>
      )}

      {error && (
        <p role="alert" className="finance-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function TransactionsView(props: {
  activities: FinanceActivity[];
  monthly: { currency: string; exponent: number; expenseMinor: string }[];
  /** Count and money totals over every posted activity, independent of the rows loaded in the list. */
  totals: ActivityTotals;
  automation?: {
    schedules: AutomationView;
    income: IncomeEventView;
    general: GeneralView;
  };
}) {
  const { activities, monthly, totals } = props;
  const { refreshing } = useFinanceFeedback();
  const { open } = useInspector();
  useInspectorSync("activity:", activities, (id) => activities.find((item) => `activity:${item.id}` === id),
    (item, update) => openDetails(item, null, update), true);
  const [kindFilter, setKindFilter] = useState<"all" | FinanceActivity["kind"]>("all");
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [showVoided, setShowVoided] = useState(false);
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [editing, setEditing] = useState<FinanceActivity | null>(null);
  const [refundPreset, setRefundPreset] = useState<TransactionPreset | null>(null);
  const sort = useListSort("transactions");

  const activityPage = useActivityPage(activities, kindFilter, showVoided, sort.direction);
  const rawItems = activityPage.items;

  const accountNames = useMemo(() => {
    const set = new Set<string>();
    activities.forEach((a) => {
      if (a.sourceName) set.add(a.sourceName);
      if (a.destinationName) set.add(a.destinationName);
    });
    return Array.from(set).sort();
  }, [activities]);

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

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  function triggerToast(msg: string) {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3500);
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

  function openDetails(item: FinanceActivity, trigger?: HTMLElement | null, emit: (entry: InspectorEntry, trigger?: HTMLElement | null) => void = open) {
    if (refreshing && emit === open) return;
    const when = new Date(item.occurredAt).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    });
    emit(
      {
        id: `activity:${item.id}`,
        title: "Rincian Transaksi",
        subtitle: `${labels[item.kind]} · ${when}`,
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

  const totalInMinor = filteredItems
    .filter((t) => t.kind === "income" && t.status === "posted")
    .reduce((sum, t) => sum + BigInt(t.baseAmountMinor), 0n);

  const totalOutMinor = filteredItems
    .filter((t) => (t.kind === "expense" || isFlowKind(t.kind)) && t.status === "posted")
    .reduce((sum, t) => {
      if (t.kind === "expense") return sum + BigInt(totalMinor(t));
      return sum + BigInt(feeMinor(t));
    }, 0n);

  const totalFeeMinor = filteredItems
    .filter((t) => t.status === "posted")
    .reduce((sum, t) => sum + BigInt(feeMinor(t)), 0n);

  const primary = filteredItems[0];
  const pCurr = primary?.currency ?? "IDR";
  const pExp = primary?.exponent ?? 0;

  // Unfiltered, the header and status bar speak for the whole ledger; with a filter the status bar describes the rows on screen.
  const unfiltered = kindFilter === "all" && accountFilter === "ALL" && !showVoided;
  const overall = totals.currencies.find((entry) => entry.currency === pCurr) ?? totals.currencies[0];
  const useOverall = unfiltered && overall !== undefined;
  const barCurrency = useOverall ? overall.currency : pCurr;
  const barExponent = useOverall ? overall.exponent : pExp;
  const barIn = useOverall ? BigInt(overall.inMinor) : totalInMinor;
  const barOut = useOverall ? BigInt(overall.outMinor) : totalOutMinor;
  const barFee = useOverall ? BigInt(overall.feeMinor) : totalFeeMinor;
  const barNet = barIn - barOut;
  const others = totals.total - (totals.counts.expense ?? 0) - (totals.counts.income ?? 0) - (totals.counts.transfer ?? 0);

  const currentMonthExpense = useMemo(() => {
    const item = monthly.find((m) => m.currency === pCurr) ?? monthly[0];
    if (!item) return null;
    const val = BigInt(item.expenseMinor) < 0n ? "0" : item.expenseMinor;
    return formatMinor(val, item.currency, item.exponent);
  }, [monthly, pCurr]);

  const commandRibbon = (
    <div className="mutasi-ribbon" role="region" aria-label="Filter dan kontrol mutasi">
      <div className="mutasi-ribbon-group mutasi-ribbon-filters">
        <span className="mutasi-ribbon-label">
          <Funnel size={14} aria-hidden="true" />
          <span>Filter:</span>
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
        <label className="mutasi-void-toggle">
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(e) => setShowVoided(e.target.checked)}
          />
          <span>Termasuk koreksi/void</span>
        </label>
      </div>

      <div className="mutasi-ribbon-group mutasi-ribbon-actions">
        <button
          type="button"
          onClick={() => {
            if (sortBy === "date") {
              sort.setDirection(sort.direction === "desc" ? "asc" : "desc");
            } else {
              setSortBy("date");
            }
          }}
          className="mutasi-btn"
          title="Ubah urutan tanggal"
        >
          <ArrowsDownUp size={14} aria-hidden="true" />
          <span>{sort.direction === "desc" ? "Terbaru" : "Terlama"}</span>
        </button>

        <button
          type="button"
          onClick={() => setSortBy((prev) => (prev === "date" ? "amount" : "date"))}
          className="mutasi-btn"
          data-active={sortBy === "amount"}
          title="Urutkan berdasarkan nominal terbesar"
        >
          <span>{sortBy === "amount" ? "Urut: Nominal" : "Urut: Tanggal"}</span>
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

  // Tab 1: Buku Mutasi (Tabel Desktop Adaptif 7->5 Kolom & Daftar Mobile 2-Sisi)
  const semuaPanel = (
    <div className="mutasi-workspace">
      {commandRibbon}

      {/* Desktop Adaptive Table (Zero Horizontal Scroll, Single-Line Locked) */}
      <div className="mutasi-table-wrapper mutasi-table-desktop">
        <table className="mutasi-table">
          <thead>
            <tr>
              <th className="mutasi-col-date">Tanggal</th>
              <th className="mutasi-col-kind">Jenis</th>
              <th className="mutasi-col-route">Akun Sumber → Tujuan</th>
              <th className="mutasi-col-category mutasi-col-secondary">Kategori</th>
              <th className="mutasi-col-note">Catatan / Keterangan</th>
              <th className="mutasi-col-fee mutasi-col-secondary mutasi-text-right">Biaya Admin</th>
              <th className="mutasi-col-total mutasi-text-right">Total Mutasi</th>
            </tr>
          </thead>
          <tbody>
            {!filteredItems.length ? (
              <tr>
                <td colSpan={7} className="mutasi-empty-state">
                  {activityPage.loading
                    ? "Memuat data mutasi…"
                    : "Tidak ada transaksi pada filter ini."}
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => {
                const d = new Date(item.occurredAt);
                const dateStr = d.toLocaleDateString("id-ID", {
                  day: "2-digit",
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
                const routeText =
                  item.sourceName && item.destinationName
                    ? `${item.sourceName} → ${item.destinationName}`
                    : item.sourceName || item.destinationName || "—";

                return (
                  <tr
                    key={item.id}
                    data-voided={isVoided}
                    onClick={(e) => openDetails(item, e.currentTarget)}
                    title="Klik untuk membuka rincian transaksi"
                  >
                    <td className="mutasi-col-date">
                      <div className="mutasi-cell-inline">
                        <strong className="mutasi-date-main">{dateStr}</strong>
                        <span className="mutasi-time-inline">{timeStr}</span>
                      </div>
                    </td>
                    <td className="mutasi-col-kind">
                      <span className={`mutasi-badge mutasi-badge--${item.kind}`}>
                        {labels[item.kind]}
                      </span>
                    </td>
                    <td className="mutasi-col-route">
                      <div className="mutasi-truncate" title={routeText}>
                        {item.sourceName || "—"}
                        {item.destinationName && (
                          <span className="mutasi-route-dest"> → {item.destinationName}</span>
                        )}
                      </div>
                    </td>
                    <td className="mutasi-col-category mutasi-col-secondary">
                      <div className="mutasi-truncate">{item.categoryName || "—"}</div>
                    </td>
                    <td className="mutasi-col-note">
                      <div className="mutasi-note-inline">
                        {item.categoryName && (
                          <span className="mutasi-inline-cat-pill">{item.categoryName}</span>
                        )}
                        <span className="mutasi-note-text">{item.note || labels[item.kind]}</span>
                        {item.status === "superseded" && (
                          <span className="mutasi-badge-corrected">Dikoreksi</span>
                        )}
                        {isVoided && <span className="mutasi-badge-corrected">Void</span>}
                      </div>
                    </td>
                    <td className="mutasi-col-fee mutasi-col-secondary mutasi-text-right mutasi-tabular">
                      {feeBig > 0n ? (
                        <span className="mutasi-fee">
                          {formatMinor(feeBig.toString(), item.currency, item.exponent)}
                        </span>
                      ) : (
                        <span className="mutasi-dash">—</span>
                      )}
                    </td>
                    <td className="mutasi-col-total mutasi-text-right mutasi-tabular">
                      <div className="mutasi-total-cell">
                        <span
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
                        </span>
                        {feeBig > 0n && (
                          <span className="mutasi-inline-fee-dot" title="Termasuk biaya admin">
                            +admin
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile 2-Sided Compact List (Figma Make 095803.png pattern) */}
      <div className="mutasi-list-mobile" role="list" aria-label="Daftar transaksi">
        {!filteredItems.length ? (
          <div className="mutasi-empty-state">
            {activityPage.loading
              ? "Memuat data mutasi…"
              : "Tidak ada transaksi pada filter ini."}
          </div>
        ) : (
          filteredItems.map((item) => {
            const d = new Date(item.occurredAt);
            const shortDate = d.toLocaleDateString("id-ID", {
              day: "2-digit",
              month: "short",
              timeZone: "Asia/Jakarta",
            });
            const feeBig = BigInt(feeMinor(item));
            const routeText =
              item.sourceName && item.destinationName
                ? `${item.sourceName} → ${item.destinationName}`
                : item.sourceName || item.destinationName || "—";

            return (
              <div
                key={item.id}
                role="listitem"
                className="mutasi-mobile-item"
                data-voided={item.status === "voided"}
                onClick={(e) => openDetails(item, e.currentTarget)}
              >
                <div className="mutasi-mobile-left">
                  <div className="mutasi-mobile-title">{item.note || labels[item.kind]}</div>
                  <div className="mutasi-mobile-route">
                    {shortDate} · {routeText}
                    {item.categoryName ? ` · ${item.categoryName}` : ""}
                  </div>
                </div>
                <div className="mutasi-mobile-right">
                  <div
                    className={`mutasi-tabular ${
                      item.kind === "income"
                        ? "mutasi-amount--in"
                        : item.kind === "expense"
                        ? "mutasi-amount--out"
                        : "mutasi-amount--neutral"
                    }`}
                  >
                    {item.kind === "income" ? "+" : item.kind === "expense" ? "−" : ""}
                    {formatMinor(totalMinor(item), item.currency, item.exponent)}
                  </div>
                  {feeBig > 0n ? (
                    <div className="mutasi-fee">
                      Admin {formatMinor(feeBig.toString(), item.currency, item.exponent)}
                    </div>
                  ) : (
                    <div className="mutasi-time-sub">{labels[item.kind]}</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {(activityPage.pageNumber > 1 || activityPage.hasNext) && (
        <div className="mutasi-pager">
          <button
            type="button"
            className="mutasi-btn"
            disabled={activityPage.loading || activityPage.pageNumber === 1}
            onClick={activityPage.previous}
          >
            Sebelumnya
          </button>
          <span className="mutasi-pager-label">Halaman {activityPage.pageNumber}</span>
          <button
            type="button"
            className="mutasi-btn"
            disabled={activityPage.loading || !activityPage.hasNext}
            onClick={activityPage.next}
          >
            Berikutnya
          </button>
        </div>
      )}
    </div>
  );

  // Tab 2: Otomatisasi & Jadwal
  const otomatisasiPanel = (
    <div className="mutasi-tab-card">
      <div className="mutasi-tab-card-header">
        <div>
          <h2 className="mutasi-tab-card-title">Otomatisasi &amp; Transaksi Terjadwal</h2>
          <p className="mutasi-tab-card-desc">
            Kelola aturan tagihan berulang, autodebet bulanan, dan alokasi persentase pemasukan otomatis.
          </p>
        </div>
        <AppLink href="/transactions/automation" className="button-primary">
          <span>Buka Ruang Kerja Otomatisasi</span>
          <ArrowRight size={ICON_SM} aria-hidden="true" />
        </AppLink>
      </div>
      <p className="mutasi-tab-card-body">
        Setiap transaksi otomatis yang jatuh tempo akan meminta konfirmasi di Beranda atau langsung membukukan mutasi sesuai aturan yang Anda tetapkan.
      </p>
    </div>
  );

  // Tab 3: Impor Mutasi (CSV)
  const imporPanel = (
    <div className="mutasi-tab-card">
      <div className="mutasi-tab-card-header">
        <div>
          <h2 className="mutasi-tab-card-title">Impor Mutasi Bank &amp; E-Wallet (CSV)</h2>
          <p className="mutasi-tab-card-desc">
            Unggah e-statement CSV untuk memetakan transaksi masuk, keluar, dan biaya admin secara massal.
          </p>
        </div>
        <AppLink href="/transactions/imports" className="button-primary">
          <FileArrowUp size={ICON_SM} aria-hidden="true" />
          <span>Buka Ruang Kerja Impor CSV</span>
        </AppLink>
      </div>
      <p className="mutasi-tab-card-body">
        Sistem akan memeriksa pratinjau baris, memisahkan biaya transfer/admin, dan menolak duplikasi sebelum disimpan ke buku besar.
      </p>
    </div>
  );

  const heading = (
    <PageHeading
      title="Buku Mutasi"
      summary={
        <>
          <span>
            Belanja Bulan Ini: <strong>{currentMonthExpense ?? "Rp0"}</strong>
          </span>
          <span aria-hidden="true">|</span>
          <span>
            Total: <strong>{totals.total} transaksi</strong>
          </span>
          <span aria-hidden="true">|</span>
          <span>
            <strong>{totals.counts.expense ?? 0}</strong> pengeluaran · <strong>{totals.counts.income ?? 0}</strong> pemasukan ·{" "}
            <strong>{totals.counts.transfer ?? 0}</strong> transfer{others > 0 && <> · <strong>{others}</strong> lainnya</>}
          </span>
        </>
      }
      actions={
        toastMsg ? (
          <div className="mutasi-toast" role="status">
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
          { id: "impor", label: "Impor Mutasi (CSV)", panel: imporPanel },
        ]}
      />

      <ExcelStatusBar
        rowCount={useOverall ? totals.total : filteredItems.length}
        rowPrefix={useOverall ? "Total" : undefined}
        ofTotal={useOverall || showVoided || accountFilter !== "ALL" ? undefined : kindFilter === "all" ? totals.total : totals.counts[kindFilter] ?? 0}
        totalIn={formatMinor(barIn.toString(), barCurrency, barExponent)}
        totalOut={formatMinor(barOut.toString(), barCurrency, barExponent)}
        customNetLabel="Selisih Bersih"
        customNetValue={`${barNet >= 0n ? "+" : "−"}${formatMinor(
          (barNet < 0n ? -barNet : barNet).toString(),
          barCurrency,
          barExponent
        )}`}
        isNetNegative={barNet < 0n}
        extraLabel={
          barFee > 0n
            ? `Total Biaya Admin: ${formatMinor(barFee.toString(), barCurrency, barExponent)}`
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
