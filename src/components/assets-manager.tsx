"use client";

import "../app/assets/assets.css";
import { sortTemporal } from "@/lib/list-order";
import { useListSort } from "./use-list-sort";
import { ListSortControl } from "./list-sort-control";
import { PageTabs } from "./page-tabs";
import { TransactionEditor } from "./transaction-editor";
import { ExcelStatusBar } from "./excel-status-bar";
import { useInspector, useInspectorSync, type InspectorEntry } from "./inspector";
import { InspectorFacts } from "./inspector-facts";
import type { TransactionPreset } from "@/lib/domain/transaction-preset";

import { useEffect, useRef, useState } from "react";
import { CaretDown, CaretRight, PencilSimple, Plus, X } from "@phosphor-icons/react";
import { Amount, Chip, monthLabel, PageHeading } from "./ui";
import { resolveProviderMark } from "@/lib/domain/provider-marks";
import {
  bpsToInput,
  encodeAssetTermsNote,
  estimateAssetMonthlyYield,
  formatAdminScheduleLabel,
  formatBpsRate,
  formatInterestCycleLabel,
  parseAssetTerms,
  parseBpsInput,
  stripAssetMetaTags,
  type InterestCycle,
} from "@/lib/domain/asset-terms";
import {
  computeCreditBills,
  CREDIT_STATUS_LABEL,
  creditAccountStatus,
  formatShortDueIso,
  isCreditAsset,
  isReceivableAsset,
} from "@/lib/domain/credit";
import { installmentContracts } from "@/lib/domain/credit-overview";
import { ProviderBrandMark } from "./provider-brand-mark";
import { InlineCatalogSelect } from "./inline-catalog-select";
import { financeRequest, requestJson } from "@/lib/finance/client";
import { ExportMenuButton } from "./export-menu-button";
import { FinanceOptionsStatus, useFinanceDialog, useFinanceOptions } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import type { AssetDetailInfo, AssetOpeningHistory } from "@/lib/repositories/assets";
import type { ActivityDraft, AssetClass, FinanceAsset } from "@/lib/finance/types";
import type { InvestmentTotal } from "@/lib/investments/types";
import { AppLink } from "./app-link";
import { FinancialAmount } from "./financial-amount";
import { SectionHeading } from "./section-heading";

const ADMIN_DAY_CHOICES = [
  { value: "0", label: "Akhir bulan" },
  ...Array.from({ length: 28 }, (_, idx) => ({
    value: String(idx + 1),
    label: `Tanggal ${idx + 1}`,
  })),
];

function shouldIgnoreRowClick(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, input, select, textarea, label, summary"));
}

function formatSignedMinor(amountMinor: bigint, currency: string, exponent: number): string {
  if (amountMinor === 0n) return formatMinor(0n, currency, exponent);
  const absFormatted = formatMinor(amountMinor < 0n ? -amountMinor : amountMinor, currency, exponent);
  return amountMinor > 0n ? `+${absFormatted}` : `−${absFormatted}`;
}

const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  asset: "Aset",
  liability: "Kewajiban",
  receivable: "Piutang",
};

function recentActivityKindLabel(
  kind: string,
  direction: "in" | "out",
  counterpartyName: string | null,
  categoryName: string | null,
): { fallbackTitle: string; kindLabel: string } {
  switch (kind) {
    case "transfer":
      return {
        fallbackTitle:
          direction === "in"
            ? `Transfer dari ${counterpartyName ?? "akun lain"}`
            : `Transfer ke ${counterpartyName ?? "akun lain"}`,
        kindLabel: direction === "in" ? "Transfer masuk" : "Transfer keluar",
      };
    case "borrow":
      return {
        fallbackTitle: counterpartyName ? `Pinjaman (${counterpartyName})` : "Pinjaman",
        kindLabel: "Pinjam",
      };
    case "repay":
      return {
        fallbackTitle: counterpartyName ? `Pelunasan (${counterpartyName})` : "Pelunasan",
        kindLabel: "Lunas",
      };
    case "refund":
      return {
        fallbackTitle: categoryName ? `Refund · ${categoryName}` : "Refund pengeluaran",
        kindLabel: categoryName ? `Refund · ${categoryName}` : "Refund",
      };
    case "adjustment":
      return {
        fallbackTitle: "Koreksi saldo",
        kindLabel: "Koreksi",
      };
    case "income":
      return {
        fallbackTitle: categoryName || "Pemasukan",
        kindLabel: categoryName ?? "Pemasukan",
      };
    default:
      return {
        fallbackTitle: categoryName || "Pengeluaran",
        kindLabel: categoryName ?? "Pengeluaran",
      };
  }
}

export function isTopUpAccount(asset: FinanceAsset): boolean {
  const text = `${asset.assetTypeName} ${asset.providerName ?? ""} ${asset.assetGroupName ?? ""} ${asset.displayName}`.toLowerCase();
  return /e-money|emoney|flazz|tapcash|brizzi|uang elektronik|dompet digital|e-wallet|ewallet|gopay|shopeepay|ovo|dana|linkaja/i.test(text);
}

export function classifyRegularAsset(asset: FinanceAsset): "emoney" | "tabungan" | "kas_bank" {
  if (isTopUpAccount(asset)) return "emoney";
  if (
    !asset.normallySpendable ||
    parseAssetTerms(asset.note).interestRateBps > 0 ||
    /deposito|tabungan berjangka|simpanan/i.test(`${asset.assetTypeName} ${asset.displayName}`)
  ) {
    return "tabungan";
  }
  return "kas_bank";
}

export function AssetForm({
  initial,
  onClose,
  defaultAssetClass,
}: {
  initial?: FinanceAsset;
  onClose: () => void;
  defaultAssetClass?: AssetClass;
}) {
  const { refresh, notify } = useFinanceFeedback();
  const dialog = useFinanceDialog(onClose);
  const { options, optionsError, retry, reload } = useFinanceOptions();
  const [error, setError] = useState("");
  const { pending, begin, finish } = useMutationPending();
  const [operation, setOperation] = useState<"save" | "archive">("save");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const classReplay = useRef<{ payload: string; key: string } | null>(null);
  // One key and one opening time per payload: a resend after a lost response returns the same asset instead of a second opening balance.
  const createReplay = useRef<{ payload: string; key: string; at: string } | null>(null);

  const initialTerms = parseAssetTerms(initial?.note);
  const [rawAssetClass] = useState<AssetClass | "">(initial?.assetClass ?? "");
  const assetClass: AssetClass | "" = rawAssetClass || defaultAssetClass || "asset";

  // Regular account fee & deposit/savings interest terms
  const [adminFee, setAdminFee] = useState<string>(
    initial && initialTerms.adminFeeMinor > 0n
      ? minorToInput(initialTerms.adminFeeMinor.toString(), initial.exponent)
      : "",
  );
  const [adminDay, setAdminDay] = useState<string>(String(initialTerms.adminDay));
  const [interestDay, setInterestDay] = useState<string>(String(initialTerms.interestDay));
  const [autoPostAdmin, setAutoPostAdmin] = useState<boolean>(initialTerms.autoPostAdminFee);
  const [interestRate, setInterestRate] = useState<string>(bpsToInput(initialTerms.interestRateBps));
  const [interestTax, setInterestTax] = useState<string>(
    initialTerms.interestRateBps > 0 ? bpsToInput(initialTerms.interestTaxBps) || "0" : "20",
  );
  const [interestCycle, setInterestCycle] = useState<InterestCycle>(initialTerms.interestCycle);

  const [name, setName] = useState(initial?.displayName ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? "IDR");
  const [opening, setOpening] = useState("");
  const [typeId, setTypeId] = useState(initial?.assetTypeId ?? "");
  const [groupId, setGroupId] = useState(initial?.assetGroupId ?? "");
  const [providerId, setProviderId] = useState(initial?.providerId ?? "");
  const [networkId, setNetworkId] = useState(initial?.paymentNetworkId ?? "");
  const [liquid, setLiquid] = useState(initial?.normallyLiquid ?? true);
  const [spendable, setSpendable] = useState(initial?.normallySpendable ?? true);
  const [suffix, setSuffix] = useState(initial?.safeSuffix ?? "");
  const [note, setNote] = useState(stripAssetMetaTags(initial?.note));
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(initial));
  const exponent = options?.currencies.find((item) => item.code === currency)?.exponent ?? 0;
  const availableAssetTypes = options?.catalogs.assetTypes ?? [];

  let previewAdminMinor = 0n;
  try {
    if (adminFee.trim()) previewAdminMinor = BigInt(inputToMinor(adminFee.trim(), exponent));
    if (previewAdminMinor < 0n) previewAdminMinor = 0n;
  } catch {
    previewAdminMinor = 0n;
  }

  let previewRateBps = 0;
  try {
    if (interestRate.trim()) previewRateBps = parseBpsInput(interestRate, 100);
  } catch {
    previewRateBps = 0;
  }

  let previewTaxBps = 2000;
  try {
    if (interestTax.trim()) previewTaxBps = parseBpsInput(interestTax, 100);
  } catch {
    previewTaxBps = 2000;
  }

  let previewBaseBalance = initial ? BigInt(initial.balanceMinor) : 0n;
  if (!initial && opening.trim()) {
    try {
      previewBaseBalance = BigInt(inputToMinor(opening.trim(), exponent));
    } catch {
      previewBaseBalance = 0n;
    }
  }

  const yieldPreview = estimateAssetMonthlyYield(previewBaseBalance, {
    adminFeeMinor: previewAdminMinor,
    interestRateBps: previewRateBps,
    interestTaxBps: previewTaxBps,
  });

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assetClass) {
      setError("Kelas akun wajib dipilih (Aset, Kewajiban, atau Piutang).");
      return;
    }
    if (!begin()) return;
    setError("");
    setOperation("save");
    try {
      const parsedAdminMinor = adminFee.trim()
        ? BigInt(inputToMinor(adminFee.trim(), exponent))
        : 0n;
      if (parsedAdminMinor < 0n) {
        throw new Error("Biaya admin bulanan tidak boleh negatif.");
      }
      const parsedRate = interestRate.trim() ? parseBpsInput(interestRate, 100) : 0;
      const parsedTax =
        parsedRate > 0
          ? interestTax.trim()
            ? parseBpsInput(interestTax, 100)
            : 2000
          : 2000;
      const parsedAdminDay = Number(adminDay);
      const encodedNote = encodeAssetTermsNote(note, {
        adminFeeMinor: parsedAdminMinor,
        adminDay: parsedAdminDay,
        autoPostAdminFee: parsedAdminMinor > 0n && autoPostAdmin,
        interestRateBps: parsedRate,
        interestTaxBps: parsedTax,
        interestCycle,
        interestDay: Number(interestDay),
        adminRuleId: initialTerms.adminRuleId,
      });

      if (encodedNote && encodedNote.length > 1000) {
        throw new Error("Catatan terlalu panjang.");
      }

      const openingMinorStr = initial
        ? undefined
        : inputToMinor(opening.trim() || "0", exponent);

      const body = {
        id: initial?.id,
        displayName: name,
        currency,
        openingAmountMinor: openingMinorStr,
        openingEffectiveAt: new Date().toISOString(),
        assetTypeId: typeId || availableAssetTypes[0]?.id,
        assetGroupId: groupId || undefined,
        providerId: providerId || undefined,
        paymentNetworkId: networkId || undefined,
        normallyLiquid: assetClass === "receivable" ? false : liquid,
        normallySpendable: assetClass === "receivable" ? false : spendable,
        safeSuffix: suffix || undefined,
        note: encodedNote,
        assetClass,
      };
      if (initial && assetClass !== initial.assetClass) {
        const classPayload = JSON.stringify({ id: initial.id, assetClass });
        if (classReplay.current?.payload !== classPayload) {
          classReplay.current = { payload: classPayload, key: crypto.randomUUID() };
        }
        await financeRequest("asset-class-change", {
          id: initial.id,
          assetClass,
          idempotencyKey: classReplay.current.key,
        });
      }
      if (initial) await financeRequest("asset-update", body);
      else {
        const createPayload = JSON.stringify({ ...body, openingEffectiveAt: undefined });
        if (createReplay.current?.payload !== createPayload) {
          createReplay.current = { payload: createPayload, key: crypto.randomUUID(), at: new Date().toISOString() };
        }
        await financeRequest("asset-create", { ...body, openingEffectiveAt: createReplay.current.at, idempotencyKey: createReplay.current.key });
      }
      refresh();
      notify(initial ? "Data berhasil diperbarui." : "Aset berhasil ditambahkan.");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data gagal disimpan.");
    } finally {
      finish();
    }
  }

  async function archive() {
    if (!initial || !begin()) return;
    setError("");
    setOperation("archive");
    try {
      await financeRequest("asset-archive", { id: initial.id });
      refresh();
      notify("Akun berhasil diarsipkan.");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Akun gagal diarsipkan.");
    } finally {
      finish();
    }
  }

  return (
    <dialog
      ref={dialog}
      className="finance-dialog"
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
      aria-labelledby="asset-form-title"
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">ASET TERCATAT</span>
          <h2 id="asset-form-title">{initial ? "Ubah aset" : "Aset baru"}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => dialog.current?.close()}
          aria-label="Tutup"
          disabled={pending}
        >
          <X size={20} />
        </button>
      </div>
      {!options ? (
        <FinanceOptionsStatus error={optionsError} retry={retry} />
      ) : (
        <form onSubmit={save} aria-busy={pending}>
          <fieldset className="finance-fieldset" disabled={pending}>
            <label className="field">
              <span>Nama rekening / aset</span>
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Mis. BNI Taplus Muda, BCA, GoPay, Kas Tunai"
              />
            </label>

            {!initial && (
              <div className="field-grid">
                <label className="field">
                  <span>Mata uang</span>
                  <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                    {options.currencies.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Saldo awal (opsional)</span>
                  <input
                    inputMode="decimal"
                    value={opening}
                    onChange={(event) => setOpening(event.target.value)}
                    placeholder="0"
                  />
                </label>
              </div>
            )}

            <div className="field-grid">
              <InlineCatalogSelect
                label="Jenis aset"
                catalog="assetTypes"
                createLabel="jenis aset"
                required
                value={typeId || availableAssetTypes[0]?.id || ""}
                items={availableAssetTypes}
                extraOptions={
                  initial?.assetTypeId &&
                  !availableAssetTypes.some((item) => item.id === initial.assetTypeId) ? (
                    <option value={initial.assetTypeId}>{initial.assetTypeName}</option>
                  ) : undefined
                }
                onCreated={() => void reload()}
                onChange={setTypeId}
              />
              <InlineCatalogSelect
                label="Penyedia / Bank"
                catalog="providers"
                createLabel="penyedia"
                value={providerId}
                emptyLabel="Tanpa penyedia"
                items={options.catalogs.providers}
                extraOptions={
                  initial?.providerId &&
                  !options.catalogs.providers.some((item) => item.id === initial.providerId) ? (
                    <option value={initial.providerId}>{initial.providerName} (diarsipkan)</option>
                  ) : undefined
                }
                onCreated={() => void reload()}
                onChange={setProviderId}
              />
            </div>

            <div className="finance-checks">
              <label>
                <input
                  type="checkbox"
                  checked={liquid}
                  onChange={(event) => {
                    setLiquid(event.target.checked);
                    if (!event.target.checked) setSpendable(false);
                  }}
                />{" "}
                Dana likuid
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={spendable}
                  disabled={!liquid}
                  onChange={(event) => setSpendable(event.target.checked)}
                />{" "}
                Dapat digunakan
              </label>
            </div>

            <details
              className="asset-form-advanced"
              open={advancedOpen}
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            >
              <summary>Pengaturan bunga, biaya admin &amp; detail opsional</summary>
              <div className="field-grid">
                <label className="field">
                  <span>Biaya admin/bln ({currency})</span>
                  <input
                    inputMode="decimal"
                    value={adminFee}
                    onChange={(event) => setAdminFee(event.target.value)}
                    placeholder="0 — Gratis"
                  />
                </label>
                <label className="field">
                  <span>Bunga simpanan (% p.a.)</span>
                  <input
                    inputMode="decimal"
                    value={interestRate}
                    onChange={(event) => setInterestRate(event.target.value)}
                    placeholder="Mis. 0,5 atau 4,25"
                  />
                </label>
              </div>

              {(previewAdminMinor > 0n || previewRateBps > 0) && (
                <div className="asset-terms-config">
                  <div className="field-grid">
                    {previewAdminMinor > 0n && (
                      <label className="field">
                        <span>Jadwal potong admin</span>
                        <select value={adminDay} onChange={(event) => setAdminDay(event.target.value)}>
                          {ADMIN_DAY_CHOICES.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {previewRateBps > 0 && (
                      <>
                        <label className="field">
                          <span>Siklus cair bunga</span>
                          <select
                            value={interestCycle}
                            onChange={(event) => setInterestCycle(event.target.value as InterestCycle)}
                          >
                            <option value="monthly">Bulanan</option>
                            <option value="daily">Cair harian</option>
                            <option value="maturity">Saat jatuh tempo</option>
                          </select>
                        </label>
                        {interestCycle === "monthly" && (
                          <label className="field">
                            <span>Tgl cair bunga</span>
                            <select value={interestDay} onChange={(event) => setInterestDay(event.target.value)}>
                              {ADMIN_DAY_CHOICES.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label className="field">
                          <span>Pajak bunga (%)</span>
                          <input
                            inputMode="decimal"
                            value={interestTax}
                            onChange={(event) => setInterestTax(event.target.value)}
                            placeholder="20"
                          />
                        </label>
                      </>
                    )}
                  </div>

                  {previewAdminMinor > 0n && (
                    <label className="asset-auto-admin-check">
                      <input
                        type="checkbox"
                        checked={autoPostAdmin}
                        onChange={(event) => setAutoPostAdmin(event.target.checked)}
                      />
                      <span>Catat biaya admin otomatis tiap bulan</span>
                    </label>
                  )}

                  {previewBaseBalance > 0n && previewRateBps > 0 && (
                    <p className="asset-terms-preview">
                      Estimasi bunga bersih:{" "}
                      <strong>
                        +{formatMinor(yieldPreview.netInterestMonthlyMinor.toString(), currency, exponent)}/bln
                      </strong>{" "}
                      ({formatMinor(yieldPreview.netInterestAnnualMinor.toString(), currency, exponent)}/thn)
                      {previewAdminMinor > 0n && (
                        <>
                          {" · "}Net setelah admin:{" "}
                          <strong
                            className={
                              yieldPreview.netAfterAdminMonthlyMinor < 0n ? "pnl-negative" : "pnl-positive"
                            }
                          >
                            {formatSignedMinor(yieldPreview.netAfterAdminMonthlyMinor, currency, exponent)}/bln
                          </strong>
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}

              <div className="field-grid">
                <InlineCatalogSelect
                  label="Grup aset"
                  catalog="assetGroups"
                  createLabel="grup aset"
                  value={groupId}
                  emptyLabel="Tanpa grup"
                  items={options.catalogs.assetGroups}
                  extraOptions={
                    initial?.assetGroupId &&
                    !options.catalogs.assetGroups.some((item) => item.id === initial.assetGroupId) ? (
                      <option value={initial.assetGroupId}>{initial.assetGroupName} (diarsipkan)</option>
                    ) : undefined
                  }
                  onCreated={() => void reload()}
                  onChange={setGroupId}
                />
                <InlineCatalogSelect
                  label="Jaringan kartu"
                  catalog="paymentNetworks"
                  createLabel="jaringan kartu"
                  value={networkId}
                  emptyLabel="Tidak ada"
                  items={options.catalogs.paymentNetworks}
                  extraOptions={
                    initial?.paymentNetworkId &&
                    !options.catalogs.paymentNetworks.some((item) => item.id === initial.paymentNetworkId) ? (
                      <option value={initial.paymentNetworkId}>{"Jaringan tersimpan"} (diarsipkan)</option>
                    ) : undefined
                  }
                  onCreated={() => void reload()}
                  onChange={setNetworkId}
                />
              </div>

              <div className="field-grid">
                <label className="field">
                  <span>4 digit akhir (opsional)</span>
                  <input
                    maxLength={4}
                    value={suffix}
                    onChange={(event) => setSuffix(event.target.value)}
                    placeholder="Mis. 4821"
                  />
                </label>
                <label className="field">
                  <span>Catatan (opsional)</span>
                  <input
                    maxLength={850}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Opsional"
                  />
                </label>
              </div>
            </details>

            {error && (
              <p role="alert" className="finance-error">
                {error}
              </p>
            )}
            {confirmArchive && (
              <div className="finance-confirm">
                <p>
                  Arsipkan akun ini? Riwayat dan saldonya tetap tersimpan, tetapi akun tidak tersedia untuk transaksi baru. Anda dapat memulihkannya nanti.
                </p>
                <button
                  type="button"
                  className="finance-danger"
                  onClick={archive}
                  disabled={pending}
                  aria-busy={pending && operation === "archive"}
                >
                  {pending && operation === "archive" ? (
                    <LoadingIndicator>Mengarsipkan…</LoadingIndicator>
                  ) : (
                    "Ya, arsipkan"
                  )}
                </button>
                <button
                  type="button"
                  className="finance-secondary"
                  onClick={() => setConfirmArchive(false)}
                >
                  Batal
                </button>
              </div>
            )}
            <div className="finance-actions">
              {initial && !confirmArchive && (
                <button
                  type="button"
                  className="finance-danger"
                  onClick={() => setConfirmArchive(true)}
                >
                  Arsipkan
                </button>
              )}
              <button
                type="submit"
                className="button-primary"
                disabled={pending}
                aria-busy={pending && operation === "save"}
              >
                {pending && operation === "save" ? (
                  <LoadingIndicator>{initial ? "Memperbarui…" : "Menyimpan…"}</LoadingIndicator>
                ) : (
                  "Simpan aset"
                )}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </dialog>
  );
}

function AssetDetailDialog({
  asset,
  onClose,
  onEdit,
  onCorrectOpening,
  onPayBill,
  onSettleReceivable,
}: {
  asset: FinanceAsset;
  onClose: () => void;
  onEdit: () => void;
  onCorrectOpening: () => void;
  onPayBill?: () => void;
  onSettleReceivable?: () => void;
}) {
  const dialog = useFinanceDialog(onClose);
  const [detail, setDetail] = useState<AssetDetailInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    requestJson<AssetDetailInfo>(`/api/finance/asset-detail?id=${encodeURIComponent(asset.id)}`, {
      cache: "no-store",
    })
      .then((data) => {
        if (active) {
          setDetail(data);
          setLoading(false);
        }
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Detail akun belum dapat dimuat.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [asset.id]);

  const isCredit = isCreditAsset(asset);
  const isReceivable = isReceivableAsset(asset);
  const mark = resolveProviderMark(
    asset.providerName,
    asset.displayName,
    isCredit ? "coral" : isReceivable ? "teal" : asset.normallySpendable ? "blue" : asset.normallyLiquid ? "cyan" : "violet",
  );
  const terms = parseAssetTerms(asset.note);
  const cleanNote = stripAssetMetaTags(asset.note);
  const bills = computeCreditBills(asset);
  const hasBill = bills.totalUnpaidMinor > 0n;
  const contracts = isCredit ? installmentContracts(asset) : [];
  const installmentRows = asset.creditInstallments ?? [];

  const balanceBig = BigInt(asset.balanceMinor);
  const openingBig = BigInt(asset.openingMinor);
  const yieldEst = estimateAssetMonthlyYield(balanceBig, terms);

  const money = (val: string | bigint) => formatMinor(val, asset.currency, asset.exponent);
  const headerSubtitle = [
    ASSET_CLASS_LABEL[asset.assetClass],
    asset.providerName,
    asset.assetTypeName,
    asset.safeSuffix ? `•••• ${asset.safeSuffix}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <dialog
      ref={dialog}
      className="finance-dialog asset-detail-dialog"
      aria-labelledby="asset-detail-title"
    >
      <div className="dialog-heading asset-detail-heading">
        <div className="asset-detail-identity">
          <ProviderBrandMark mark={mark} />
          <div>
            <span className="eyebrow">
              {!asset.isActive
                ? "ASET DIARSIPKAN"
                : isCredit
                  ? "DETAIL FASILITAS KREDIT"
                  : isReceivable
                    ? "DETAIL PIUTANG & TALANGAN"
                    : "DETAIL REKENING & ASET"}
            </span>
            <h2 id="asset-detail-title">{asset.displayName}</h2>
            {headerSubtitle && <p className="asset-detail-subtitle">{headerSubtitle}</p>}
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Tutup"
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
      </div>

      <div className="asset-detail-hero">
        {isCredit ? (
          <>
            <div className="asset-detail-hero-main">
              <span>Total kewajiban belum lunas</span>
              <strong className={`financial-value financial-value--summary ${hasBill ? "pnl-negative" : "pnl-positive"}`}>
                {hasBill ? money(bills.totalUnpaidMinor) : CREDIT_STATUS_LABEL[creditAccountStatus(bills)]}
              </strong>
            </div>
            <div className="asset-detail-hero-pair">
              <div>
                <span>Tagihan terdekat ({formatShortDueIso(bills.currentDueIso)})</span>
                <strong className={bills.currentBillMinor > 0n ? "pnl-negative" : "pnl-positive"}>
                  {bills.currentBillMinor > 0n ? money(bills.currentBillMinor) : "Lunas"}
                </strong>
              </div>
              <div>
                <span>
                  {bills.availableLimitMinor !== null
                    ? "Sisa limit tersedia"
                    : `Periode depan (${formatShortDueIso(bills.nextDueIso)})`}
                </span>
                <strong>
                  {bills.availableLimitMinor !== null
                    ? money(bills.availableLimitMinor)
                    : money(bills.nextBillMinor)}
                </strong>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="asset-detail-hero-main">
              <span>Saldo tercatat saat ini</span>
              <strong className="financial-value financial-value--summary">{money(balanceBig)}</strong>
            </div>
            <div className="asset-detail-hero-pair">
              <div>
                <span>Saldo awal efektif</span>
                <strong>{money(openingBig)}</strong>
              </div>
              <div>
                <span>Kelas akun</span>
                <strong>{ASSET_CLASS_LABEL[asset.assetClass]}</strong>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="asset-detail-section">
        <h3 className="u-table-title">Profil &amp; ketentuan akun</h3>
        <div className="u-table-wrap">
          <table className="u-table" aria-label="Profil dan ketentuan akun">
            <tbody>
              <tr>
                <th scope="row">
                  <strong>Kelas akun</strong>
                </th>
                <td>{ASSET_CLASS_LABEL[asset.assetClass]}</td>
              </tr>
              <tr>
                <th scope="row">
                  <strong>Klasifikasi</strong>
                </th>
                <td>
                  {asset.assetTypeName}
                  {asset.assetGroupName ? ` · ${asset.assetGroupName}` : ""}
                </td>
              </tr>
              {(asset.providerName || detail?.paymentNetworkName || asset.safeSuffix) && (
                <tr>
                  <th scope="row">
                    <strong>Penyedia &amp; jaringan</strong>
                  </th>
                  <td>
                    {[
                      asset.providerName,
                      detail?.paymentNetworkName,
                      asset.safeSuffix ? `•••• ${asset.safeSuffix}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                </tr>
              )}
              {isCredit ? (
                <>
                  <tr>
                    <th scope="row">
                      <strong>Siklus tagihan</strong>
                    </th>
                    <td>
                      Cutoff tgl {bills.cutoffDay} · Jatuh tempo tgl {bills.dueDay}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">
                      <strong>Limit kredit</strong>
                    </th>
                    <td>
                      {bills.limitMinor > 0n ? (
                        <>
                          {money(bills.limitMinor)}
                          {bills.availableLimitMinor !== null && (
                            <small className="u-cell-sub">
                              Tersedia {money(bills.availableLimitMinor)}
                            </small>
                          )}
                        </>
                      ) : (
                        <span className="asset-muted-val">Tidak dibatasi</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">
                      <strong>Tagihan periode depan ({formatShortDueIso(bills.nextDueIso)})</strong>
                    </th>
                    <td>{money(bills.nextBillMinor)}</td>
                  </tr>
                  {bills.laterBillMinor > 0n && (
                    <tr>
                      <th scope="row">
                        <strong>Cicilan periode setelahnya</strong>
                      </th>
                      <td>{money(bills.laterBillMinor)}</td>
                    </tr>
                  )}
                  {bills.overpaidMinor > 0n && (
                    <tr>
                      <th scope="row">
                        <strong>Lebih bayar</strong>
                      </th>
                      <td className="pnl-positive">{money(bills.overpaidMinor)}</td>
                    </tr>
                  )}
                </>
              ) : (
                <>
                  <tr>
                    <th scope="row">
                      <strong>Status likuiditas</strong>
                    </th>
                    <td>
                      {!asset.isActive
                        ? "Diarsipkan"
                        : isReceivable
                          ? "Piutang / Talangan · Bukan kas langsung"
                          : asset.normallySpendable
                            ? "Dana likuid · Dapat digunakan"
                            : asset.normallyLiquid
                              ? "Dana likuid · Cadangan"
                              : "Aset non-likuid"}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">
                      <strong>Biaya admin bulanan</strong>
                      {terms.adminFeeMinor > 0n && (
                        <small className="u-cell-sub">
                          Potong {formatAdminScheduleLabel(terms.adminDay)} ·{" "}
                          {terms.autoPostAdminFee && detail?.adminAutomationStatus !== "paused"
                            ? "Otomatis tercatat"
                            : "Pencatatan manual"}
                        </small>
                      )}
                    </th>
                    <td className={terms.adminFeeMinor > 0n ? "pnl-negative" : "asset-muted-val"}>
                      {terms.adminFeeMinor > 0n ? `${money(terms.adminFeeMinor)}/bln` : "Gratis (Rp0)"}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">
                      <strong>Bunga simpanan / deposito</strong>
                      {terms.interestRateBps > 0 && (
                        <small className="u-cell-sub">
                          Pajak {formatBpsRate(terms.interestTaxBps)} ·{" "}
                          {formatInterestCycleLabel(terms.interestCycle, terms.interestDay)}
                        </small>
                      )}
                    </th>
                    <td className={terms.interestRateBps > 0 ? "pnl-positive" : "asset-muted-val"}>
                      {terms.interestRateBps > 0
                        ? `${formatBpsRate(terms.interestRateBps)} p.a.`
                        : "Tidak diatur (0%)"}
                    </td>
                  </tr>
                  {(terms.interestRateBps > 0 || terms.adminFeeMinor > 0n) && (
                    <tr>
                      <th scope="row">
                        <strong>Estimasi hasil bersih / bulan</strong>
                        <small className="u-cell-sub">
                          {terms.interestRateBps > 0
                            ? `Bunga bersih +${money(yieldEst.netInterestMonthlyMinor)}${
                                terms.adminFeeMinor > 0n ? ` − admin ${money(terms.adminFeeMinor)}` : ""
                              }`
                            : `Biaya admin rutin ${money(terms.adminFeeMinor)}/bln`}
                        </small>
                      </th>
                      <td
                        className={
                          yieldEst.netAfterAdminMonthlyMinor > 0n
                            ? "pnl-positive"
                            : yieldEst.netAfterAdminMonthlyMinor < 0n
                              ? "pnl-negative"
                              : "asset-muted-val"
                        }
                      >
                        {formatSignedMinor(yieldEst.netAfterAdminMonthlyMinor, asset.currency, asset.exponent)}
                      </td>
                    </tr>
                  )}
                </>
              )}
              {cleanNote && (
                <tr>
                  <th scope="row">
                    <strong>Catatan</strong>
                  </th>
                  <td>{cleanNote}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isCredit && (
        <div className="asset-detail-section">
          <div className="asset-detail-section-head">
            <h3 className="u-table-title">Jadwal cicilan</h3>
            {contracts.length > 0 && (
              <span className="asset-detail-count">{contracts.length} kontrak aktif</span>
            )}
          </div>
          {installmentRows.length > 0 ? (
            <div className="u-table-wrap">
              <table className="u-table" aria-label="Jadwal cicilan kredit">
                <thead>
                  <tr>
                    <th scope="col">Periode &amp; cicilan</th>
                    <th scope="col">Pokok &amp; bunga</th>
                  </tr>
                </thead>
                <tbody>
                  {installmentRows.map((row) => {
                    const rowTotal = BigInt(row.principalMinor) + BigInt(row.interestMinor);
                    return (
                      <tr key={`${row.activityId}-${row.seq}`}>
                        <th scope="row">
                          <strong>
                            {monthLabel(row.period)} · Cicilan ke-{row.seq}
                          </strong>
                          <small className="u-cell-sub">
                            {row.period} · {row.status === "scheduled" ? "Terjadwal" : "Dibatalkan"}
                          </small>
                        </th>
                        <td>
                          <FinancialAmount as="span" value={money(rowTotal)} />
                          <small className="u-cell-sub">
                            Pokok {money(row.principalMinor)} · Bunga {money(row.interestMinor)}
                          </small>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="finance-hint asset-detail-empty">Belum ada jadwal cicilan pada akun kredit ini.</p>
          )}
        </div>
      )}

      {detail && (
        <div className="asset-detail-section">
          <div className="asset-detail-section-head">
            <h3 className="u-table-title">Ringkasan aktivitas akun</h3>
            <span className="asset-detail-count">{detail.activitySummary.activityCount} aktivitas</span>
          </div>
          <div className="u-table-wrap">
            <table className="u-table" aria-label="Ringkasan aktivitas akun">
              <tbody>
                <tr>
                  <th scope="row">
                    <strong>Pengeluaran bersih</strong>
                    <small className="u-cell-sub">Termasuk biaya pada akun ini, sudah dikurangi refund</small>
                  </th>
                  <td className={BigInt(detail.activitySummary.expenseMinor) > 0n ? "pnl-negative" : BigInt(detail.activitySummary.expenseMinor) < 0n ? "pnl-positive" : ""}>
                    <FinancialAmount as="span" value={money(detail.activitySummary.expenseMinor)} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    <strong>Refund diterima</strong>
                    <small className="u-cell-sub">Sudah dikurangkan di pengeluaran bersih</small>
                  </th>
                  <td className={BigInt(detail.activitySummary.refundMinor) > 0n ? "pnl-positive" : ""}>
                    <FinancialAmount as="span" value={money(detail.activitySummary.refundMinor)} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    <strong>Transfer keluar</strong>
                    <small className="u-cell-sub">Pokok transfer keluar saja</small>
                  </th>
                  <td>
                    <FinancialAmount as="span" value={money(detail.activitySummary.transferOutMinor)} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    <strong>Pemasukan</strong>
                  </th>
                  <td className={BigInt(detail.activitySummary.incomeMinor) > 0n ? "pnl-positive" : ""}>
                    <FinancialAmount as="span" value={money(detail.activitySummary.incomeMinor)} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    <strong>Transfer masuk</strong>
                  </th>
                  <td>
                    <FinancialAmount as="span" value={money(detail.activitySummary.transferInMinor)} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="asset-detail-section">
        <div className="asset-detail-section-head">
          <h3 className="u-table-title">Transaksi terakhir</h3>
          {detail && detail.activitySummary.activityCount > 0 && (
            <span className="asset-detail-count">{detail.activitySummary.activityCount} transaksi tercatat</span>
          )}
        </div>
        {loading ? (
          <p className="finance-hint" role="status" aria-live="polite">Memuat riwayat akun…</p>
        ) : error ? (
          <p role="alert" className="finance-error">
            {error}
          </p>
        ) : detail && detail.recentActivities.length > 0 ? (
          <>
            <div className="u-table-wrap">
              <table className="u-table" aria-label="Transaksi terakhir akun">
                <thead>
                  <tr>
                    <th scope="col">Transaksi</th>
                    <th scope="col">Mutasi</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentActivities.map((act) => {
                    const shortDate = new Date(act.occurredAt).toLocaleDateString("id-ID", {
                      timeZone: "Asia/Jakarta",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    });
                    const { fallbackTitle, kindLabel } = recentActivityKindLabel(
                      act.kind,
                      act.direction,
                      act.counterpartyName,
                      act.categoryName,
                    );
                    const title = act.note?.trim() || fallbackTitle;
                    const signedVal =
                      act.direction === "in"
                        ? `+${money(act.amountMinor)}`
                        : `−${money(act.amountMinor)}`;
                    return (
                      <tr key={act.id}>
                        <th scope="row">
                          <strong>{title}</strong>
                          <small className="u-cell-sub">
                            {kindLabel} · {shortDate}
                          </small>
                        </th>
                        <td className={act.direction === "in" ? "pnl-positive" : "pnl-negative"}>
                          <FinancialAmount as="span" value={signedVal} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="asset-detail-more">
              <AppLink className="text-link" href="/transactions" onClick={onClose}>
                Lihat semua transaksi di Transactions →
              </AppLink>
            </div>
          </>
        ) : (
          <p className="finance-hint asset-detail-empty">Belum ada transaksi tercatat pada akun ini.</p>
        )}
      </div>

      <div className="finance-actions">
        <button type="button" className="finance-secondary" onClick={() => dialog.current?.close()}>
          Tutup
        </button>
        {!isCredit && (
          <button
            type="button"
            className="finance-secondary"
            onClick={() => {
              onClose();
              onCorrectOpening();
            }}
          >
            {asset.isActive ? "Koreksi saldo awal" : "Riwayat saldo awal"}
          </button>
        )}
        {isCredit && hasBill && asset.isActive && (
          <button
            type="button"
            className="finance-secondary"
            onClick={() => {
              onClose();
              onPayBill?.();
            }}
          >
            Bayar tagihan
          </button>
        )}
        {!isCredit && isReceivable && balanceBig > 0n && asset.isActive && (
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              onClose();
              onSettleReceivable?.();
            }}
          >
            Terima ganti
          </button>
        )}
        {asset.isActive && (
          <button
            type="button"
            className={!isCredit && isReceivable && balanceBig > 0n ? "finance-secondary" : "button-primary"}
            onClick={() => {
              onClose();
              onEdit();
            }}
          >
            <PencilSimple size={15} weight="bold" />
            {isCredit ? "Ubah fasilitas" : "Ubah aset"}
          </button>
        )}
      </div>
    </dialog>
  );
}

export function PayCreditBillDialog({
  creditAsset,
  regularAssets,
  onClose,
}: {
  creditAsset: FinanceAsset;
  regularAssets: FinanceAsset[];
  onClose: () => void;
}) {
  const dialog = useFinanceDialog(onClose);
  const { refresh, notify } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const replay = useRef<{ payload: string; key: string } | null>(null);
  const eligibleSources = regularAssets.filter(
    (item) => item.isActive && item.currency === creditAsset.currency,
  );
  const bills = computeCreditBills(creditAsset);
  const defaultPayMinor =
    bills.currentBillMinor > 0n ? bills.currentBillMinor : bills.totalUnpaidMinor;
  const [sourceId, setSourceId] = useState(eligibleSources[0]?.id ?? "");
  const [amount, setAmount] = useState(
    defaultPayMinor > 0n ? minorToInput(defaultPayMinor.toString(), creditAsset.exponent) : "",
  );
  const [fee, setFee] = useState("");
  const [note, setNote] = useState(
    `Pelunasan tagihan ${creditAsset.displayName} (${formatShortDueIso(bills.currentDueIso)})`,
  );
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!begin()) return;
    setError("");
    try {
      if (!sourceId) throw new Error("Pilih rekening sumber pembayaran.");
      const draft: ActivityDraft = {
        kind: "transfer",
        amountMinor: inputToMinor(amount, creditAsset.exponent),
        sourceAssetId: sourceId,
        destinationAssetId: creditAsset.id,
        transferFeeMinor: fee.trim() ? inputToMinor(fee, creditAsset.exponent) : undefined,
        occurredAt: new Date().toISOString(),
        note: note.trim() || `Pelunasan tagihan ${creditAsset.displayName}`,
      };
      const payload = JSON.stringify({ draft });
      if (replay.current?.payload !== payload) {
        replay.current = { payload, key: crypto.randomUUID() };
      }
      await financeRequest("post", { draft, idempotencyKey: replay.current.key });
      refresh();
      notify(`Tagihan ${creditAsset.displayName} berhasil dibayar.`);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pembayaran tagihan gagal disimpan.");
    } finally {
      finish();
    }
  }

  return (
    <dialog
      ref={dialog}
      className="finance-dialog"
      aria-labelledby="pay-credit-bill-title"
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">PELUNASAN KREDIT & PAYLATER</span>
          <h2 id="pay-credit-bill-title">Bayar tagihan {creditAsset.displayName}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Tutup"
          disabled={pending}
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
      </div>
      <p className="finance-hint">
        Pelunasan dicatat sebagai transfer dari rekening pembayar ke <strong>{creditAsset.displayName}</strong> agar saldo tagihan berkurang tanpa menghitung pengeluaran dua kali.
      </p>
      {!eligibleSources.length ? (
        <p className="finance-error" role="alert">
          Belum ada rekening/aset aktif dalam mata uang {creditAsset.currency} untuk membayar tagihan ini.
        </p>
      ) : (
        <form onSubmit={submit} aria-busy={pending}>
          <fieldset className="finance-fieldset" disabled={pending}>
            <dl className="investment-preview">
              <div>
                <dt>Jatuh tempo terdekat ({formatShortDueIso(bills.currentDueIso)})</dt>
                <dd className="pnl-negative">
                  {formatMinor(bills.currentBillMinor.toString(), creditAsset.currency, creditAsset.exponent)}
                </dd>
              </div>
              {bills.nextBillMinor > 0n && (
                <div>
                  <dt>Periode berikutnya ({formatShortDueIso(bills.nextDueIso)})</dt>
                  <dd>
                    {formatMinor(bills.nextBillMinor.toString(), creditAsset.currency, creditAsset.exponent)}
                  </dd>
                </div>
              )}
            </dl>
            <label className="field">
              <span>Bayar dari rekening ({creditAsset.currency})</span>
              <select
                required
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
              >
                {eligibleSources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} · {formatMinor(item.balanceMinor, item.currency, item.exponent)}
                  </option>
                ))}
              </select>
            </label>
            <div className="field-grid">
              <label className="field">
                <span>Jumlah bayar ({creditAsset.currency})</span>
                <input
                  required
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0"
                />
              </label>
              <label className="field">
                <span>Biaya admin / bunga tambahan (opsional)</span>
                <input
                  inputMode="decimal"
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                  placeholder="0"
                />
              </label>
            </div>
            <label className="field">
              <span>Catatan</span>
              <input
                maxLength={240}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="finance-error">
                {error}
              </p>
            )}
            <div className="finance-actions">
              <button
                type="button"
                className="finance-secondary"
                onClick={() => dialog.current?.close()}
              >
                Batal
              </button>
              <button type="submit" className="button-primary" disabled={pending} aria-busy={pending}>
                {pending ? <LoadingIndicator>Memproses pembayaran…</LoadingIndicator> : "Bayar tagihan"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </dialog>
  );
}

export function SettleReceivableDialog({
  receivableAsset,
  regularAssets,
  onClose,
}: {
  receivableAsset: FinanceAsset;
  regularAssets: FinanceAsset[];
  onClose: () => void;
}) {
  const dialog = useFinanceDialog(onClose);
  const { refresh, notify } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const replay = useRef<{ payload: string; key: string } | null>(null);
  const eligibleDestinations = regularAssets.filter(
    (item) =>
      item.isActive &&
      item.id !== receivableAsset.id &&
      item.currency === receivableAsset.currency &&
      !isCreditAsset(item) &&
      !isReceivableAsset(item),
  );
  const currentBalanceMinor = BigInt(receivableAsset.balanceMinor);
  const defaultAmountMinor = currentBalanceMinor > 0n ? currentBalanceMinor : 0n;
  const [destinationId, setDestinationId] = useState(eligibleDestinations[0]?.id ?? "");
  const [amount, setAmount] = useState(
    defaultAmountMinor > 0n ? minorToInput(defaultAmountMinor.toString(), receivableAsset.exponent) : "",
  );
  const [fee, setFee] = useState("");
  const [note, setNote] = useState(
    `Pengembalian talangan · ${receivableAsset.displayName}`,
  );
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!begin()) return;
    setError("");
    try {
      if (!destinationId) throw new Error("Pilih rekening penerima dana ganti.");
      const draft: ActivityDraft = {
        kind: "transfer",
        amountMinor: inputToMinor(amount, receivableAsset.exponent),
        sourceAssetId: receivableAsset.id,
        destinationAssetId: destinationId,
        transferFeeMinor: fee.trim() ? inputToMinor(fee, receivableAsset.exponent) : undefined,
        occurredAt: new Date().toISOString(),
        note: note.trim() || `Pengembalian talangan · ${receivableAsset.displayName}`,
      };
      const payload = JSON.stringify({ draft });
      if (replay.current?.payload !== payload) {
        replay.current = { payload, key: crypto.randomUUID() };
      }
      await financeRequest("post", { draft, idempotencyKey: replay.current.key });
      refresh();
      notify(`Pengembalian talangan ${receivableAsset.displayName} berhasil dicatat.`);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pengembalian talangan gagal disimpan.");
    } finally {
      finish();
    }
  }

  return (
    <dialog
      ref={dialog}
      className="finance-dialog"
      aria-labelledby="settle-receivable-title"
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">PELUNASAN PIUTANG &amp; TALANGAN</span>
          <h2 id="settle-receivable-title">Terima ganti {receivableAsset.displayName}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Tutup"
          disabled={pending}
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
      </div>
      <p className="finance-hint">
        Pencatatan dilakukan sebagai transfer dari <strong>{receivableAsset.displayName}</strong> ke rekening penerima agar saldo piutang berkurang dan kas bertambah tanpa tercatat sebagai pemasukan ganda di Insights.
      </p>
      {!eligibleDestinations.length ? (
        <p className="finance-error" role="alert">
          Belum ada rekening/aset aktif dalam mata uang {receivableAsset.currency} untuk menerima dana ganti ini.
        </p>
      ) : (
        <form onSubmit={submit} aria-busy={pending}>
          <fieldset className="finance-fieldset" disabled={pending}>
            <dl className="investment-preview">
              <div>
                <dt>Sisa piutang berjalan</dt>
                <dd className={currentBalanceMinor > 0n ? "pnl-positive" : "asset-muted-val"}>
                  {formatMinor(receivableAsset.balanceMinor, receivableAsset.currency, receivableAsset.exponent)}
                </dd>
              </div>
            </dl>
            <label className="field">
              <span>Rekening penerima dana ganti ({receivableAsset.currency})</span>
              <select
                required
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
              >
                {eligibleDestinations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} · {formatMinor(item.balanceMinor, item.currency, item.exponent)}
                  </option>
                ))}
              </select>
            </label>
            <div className="field-grid">
              <label className="field">
                <span>Jumlah diganti ({receivableAsset.currency})</span>
                <input
                  required
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0"
                />
              </label>
              <label className="field">
                <span>Biaya admin / potongan (opsional)</span>
                <input
                  inputMode="decimal"
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                  placeholder="0"
                />
              </label>
            </div>
            <label className="field">
              <span>Catatan</span>
              <input
                maxLength={240}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="finance-error">
                {error}
              </p>
            )}
            <div className="finance-actions">
              <button
                type="button"
                className="finance-secondary"
                onClick={() => dialog.current?.close()}
              >
                Batal
              </button>
              <button type="submit" className="button-primary" disabled={pending} aria-busy={pending}>
                {pending ? <LoadingIndicator>Memproses pelunasan…</LoadingIndicator> : "Terima ganti"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </dialog>
  );
}

function AssetOpeningCorrection({ asset, onClose }: { asset: FinanceAsset; onClose: () => void }) {
  const dialog = useFinanceDialog(onClose);
  const { refresh, notify } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const [history, setHistory] = useState<AssetOpeningHistory | null>(null);
  const correctionSort = useListSort(`assets.${asset.id}.opening-corrections`);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const retry = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    let active = true;
    requestJson<AssetOpeningHistory>(`/api/finance/asset-opening?id=${encodeURIComponent(asset.id)}`, { cache: "no-store" })
      .then((data) => { if (active) { setHistory(data); setAmount(minorToInput(data.effectiveMinor, data.exponent)); setLoading(false); } })
      .catch((cause) => { if (active) { setError(cause instanceof Error ? cause.message : "Riwayat belum dapat dimuat."); setLoading(false); } });
    return () => { active = false; };
  }, [asset.id]);
  let corrected: string | null = null;
  try { if (history) corrected = inputToMinor(amount, history.exponent); } catch { /* Incomplete input while typing. */ }
  const delta = history && corrected !== null ? BigInt(corrected) - BigInt(history.effectiveMinor) : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!history || !begin()) return; setError("");
    try {
      const body = { assetId: asset.id, expectedMinor: history.effectiveMinor, correctedMinor: inputToMinor(amount, history.exponent), note: note.trim() || undefined };
      const payload = JSON.stringify(body);
      if (retry.current?.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
      await financeRequest("asset-opening-correct", { ...body, idempotencyKey: retry.current.key });
      refresh(); notify("Saldo awal berhasil dikoreksi."); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Koreksi belum dapat disimpan."); }
    finally { finish(); }
  }
  return <dialog ref={dialog} className="finance-dialog" aria-labelledby="asset-opening-title" onCancel={(event) => { if (pending) event.preventDefault(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">REKONSILIASI ASET</span><h2 id="asset-opening-title">Koreksi saldo awal</h2></div><button type="button" className="icon-button" aria-label="Tutup" disabled={pending} onClick={() => dialog.current?.close()}><X size={20} /></button></div>
    <p className="finance-hint">Perbaiki saldo saat aset pertama dicatat. Transaksi yang sudah ada tetap utuh.</p>
    {!asset.isActive && <p className="finance-hint">Aset diarsipkan. Pulihkan aset sebelum membuat koreksi baru; riwayatnya tetap dapat dilihat.</p>}
    {loading ? <p className="finance-hint" role="status" aria-live="polite">Memuat saldo awal…</p> : history && <form onSubmit={submit} aria-busy={pending}><fieldset className="finance-fieldset" disabled={pending}>
      <dl className="investment-preview"><div><dt>Saldo awal asli</dt><dd>{formatMinor(history.originalMinor, history.currency, history.exponent)}</dd></div><div><dt>Saldo awal saat ini</dt><dd>{formatMinor(history.effectiveMinor, history.currency, history.exponent)}</dd></div></dl>
      {asset.isActive && <>
      <label className="field"><span>Saldo awal yang benar ({history.currency})</span><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></label>
      {delta !== null && <p className="finance-hint">Perubahan saldo awal: {delta > 0n ? "+" : ""}{formatMinor(delta, history.currency, history.exponent)}. Saldo saat ini ikut berubah sebesar ini.</p>}
      <label className="field"><span>Alasan koreksi (opsional)</span><textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </>}
      {history.corrections.length > 0 && <details className="investment-price-history"><summary>Riwayat koreksi ({history.corrections.length})</summary><ListSortControl {...correctionSort} /><div className="investment-opening-history">{sortTemporal(history.corrections, correctionSort.direction, item => item.createdAt, item => item.id).map((item) => <article className="investment-correction-entry" key={item.id}><small>{new Date(item.createdAt).toLocaleString("id-ID")}</small><p><strong>Saldo awal:</strong> {formatMinor(item.previousMinor, history.currency, history.exponent)} → {formatMinor(item.correctedMinor, history.currency, history.exponent)}</p>{item.note && <p className="investment-correction-note">Alasan: {item.note}</p>}</article>)}</div></details>}
      {error && <p role="alert" className="finance-error">{error}</p>}
      <div className="finance-actions"><button type="button" className="finance-secondary" onClick={() => dialog.current?.close()}>Tutup</button>{asset.isActive && <button type="submit" className="button-primary" disabled={pending || corrected === null || corrected === history.effectiveMinor} aria-busy={pending}>{pending ? <LoadingIndicator>Menyimpan koreksi...</LoadingIndicator> : "Simpan koreksi"}</button>}</div>
    </fieldset></form>}
    {!loading && !history && <p role="alert" className="finance-error">{error}</p>}
  </dialog>;
}

function shortAccountRef(id: string) {
  const clean = id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `AKN-${clean.slice(0, 4)}-${clean.slice(-4)}`;
}

function isEmoneyAccount(asset: FinanceAsset): boolean {
  const t = (asset.assetTypeName || "").toLowerCase();
  const d = (asset.displayName || "").toLowerCase();
  return (
    t.includes("e-money") ||
    d.includes("flazz") ||
    d.includes("brizzi") ||
    d.includes("tapcash") ||
    d.includes("jakcard") ||
    d.includes("e-money")
  );
}

function isSavingsOrDepositAccount(asset: FinanceAsset): boolean {
  if (isEmoneyAccount(asset)) return false;
  const t = (asset.assetTypeName || "").toLowerCase();
  const d = (asset.displayName || "").toLowerCase();
  const terms = parseAssetTerms(asset.note);
  return (
    t.includes("deposito") ||
    d.includes("deposito") ||
    t.includes("tabungan") ||
    d.includes("tabungan") ||
    terms.interestRateBps > 0
  );
}

export function AssetsManager({
  assets,
  totals,
}: {
  assets: FinanceAsset[];
  totals: {
    currency: string;
    exponent: number;
    amountMinor: string;
    unpricedCount: number;
    liquidMinor?: string;
    eligibleMinor?: string;
    liabilitiesMinor?: string;
  }[];
  investmentTotals?: InvestmentTotal[];
}) {
  const { open, close } = useInspector();
  useInspectorSync("asset:", assets, (id) => assets.find((item) => `asset:${item.id}` === id),
    (asset, update) => openAccountInspector(asset, null, update));
  const [viewingAsset, setViewingAsset] = useState<FinanceAsset | null>(null);
  const [editing, setEditing] = useState<FinanceAsset | "new" | null>(null);
  const [payingCredit, setPayingCredit] = useState<FinanceAsset | null>(null);
  const [settlingReceivable, setSettlingReceivable] = useState<FinanceAsset | null>(null);
  const [correcting, setCorrecting] = useState<FinanceAsset | null>(null);
  const [topUpPreset, setTopUpPreset] = useState<TransactionPreset | null>(null);
  const { pending, begin, finish } = useMutationPending();
  const { refresh, notify, refreshing } = useFinanceFeedback();
  const [restoringId, setRestoringId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");

  async function restore(id: string) {
    if (refreshing || !begin()) return;
    setRestoringId(id);
    setError("");
    try {
      await financeRequest("asset-restore", { id });
      refresh();
      notify("Aset berhasil dipulihkan.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Aset belum dapat dipulihkan.");
    } finally {
      finish();
    }
  }

  const openNewAsset = () => setEditing("new");

  // Filter murni rekening/aset kas milik sendiri (bebas dari kredit, piutang talangan, dan akun investasi)
  const active = assets.filter((item) => item.isActive);
  const regularActive = active.filter(
    (item) =>
      item.assetClass === "asset" &&
      !isCreditAsset(item) &&
      !isReceivableAsset(item)
  );
  const archived = assets.filter(
    (item) => !item.isActive && item.assetClass === "asset"
  );

  const liveViewingAsset = viewingAsset
    ? assets.find((item) => item.id === viewingAsset.id) ?? viewingAsset
    : null;

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const emoneyAccounts = regularActive.filter(isEmoneyAccount);
  const tabunganDepositoAccounts = regularActive.filter(isSavingsOrDepositAccount);
  const kasBankAccounts = regularActive.filter(
    (a) => !emoneyAccounts.includes(a) && !tabunganDepositoAccounts.includes(a)
  );

  const primaryTotal = totals[0];
  const pCurr = primaryTotal?.currency ?? "IDR";
  const pExp = primaryTotal?.exponent ?? 0;

  // Totals are per currency (the primary one); summing minor units of different currencies would be meaningless.
  const primaryActive = regularActive.filter((a) => a.currency === pCurr);
  const totalBalanceBig = primaryActive.reduce((sum, a) => sum + BigInt(a.balanceMinor), 0n);
  const totalEstInterestBig = primaryActive.reduce((sum, a) => {
    const terms = parseAssetTerms(a.note);
    if (terms.interestRateBps <= 0) return sum;
    const yieldVal = estimateAssetMonthlyYield(BigInt(a.balanceMinor), terms);
    return sum + yieldVal.netInterestMonthlyMinor;
  }, 0n);
  const totalAdminBig = primaryActive.reduce((sum, a) => {
    const terms = parseAssetTerms(a.note);
    return sum + terms.adminFeeMinor;
  }, 0n);
  const netMonthlyCarryBig = totalEstInterestBig - totalAdminBig;

  function openAccountInspector(asset: FinanceAsset, trigger?: HTMLElement | null, emit: (entry: InspectorEntry, trigger?: HTMLElement | null) => void = open) {
    const terms = parseAssetTerms(asset.note);
    const yieldEst = estimateAssetMonthlyYield(BigInt(asset.balanceMinor), terms);
    const money = (val: string | bigint) => formatMinor(val, asset.currency, asset.exponent);
    const isEmoney = isEmoneyAccount(asset);
    const subtitle = [asset.providerName, asset.assetTypeName].filter(Boolean).join(" · ");

    emit(
      {
        id: `asset:${asset.id}`,
        title: asset.displayName,
        subtitle: subtitle || "Rekening & Aset",
        body: (
          <div className="inspector-cards">
            {/* Kartu 1: Ringkasan Hero Rekening */}
            <section className="inspector-card inspector-card--hero">
              <div className="inspector-card-top">
                <span className="inspector-ref-badge">{shortAccountRef(asset.id)}</span>
                <Chip tone={asset.normallySpendable ? "positive" : "info"}>
                  {isEmoney
                    ? "Kartu E-Money"
                    : asset.normallySpendable
                    ? "Likuid · Siap Pakai"
                    : "Tabungan / Cadangan"}
                </Chip>
              </div>
              <div className="inspector-hero-metric">
                <span className="inspector-hero-caption">Saldo Tercatat Saat Ini</span>
                <div className="inspector-hero-amount">
                  <Amount
                    value={money(asset.balanceMinor)}
                    level="summary"
                    tone={BigInt(asset.balanceMinor) < 0n ? "negative" : "positive"}
                  />
                </div>
              </div>
              <div className="inspector-meta-grid">
                <div>
                  <span className="inspector-meta-label">Institusi / Penyedia</span>
                  <strong className="inspector-meta-value">{asset.providerName || "—"}</strong>
                </div>
                <div>
                  <span className="inspector-meta-label">Jenis &amp; Nomor Ekor</span>
                  <strong className="inspector-meta-value">
                    {asset.assetTypeName}
                    {asset.safeSuffix ? ` · •••• ${asset.safeSuffix}` : ""}
                  </strong>
                </div>
              </div>
            </section>

            {/* Kartu 2: Rincian Bunga, Pajak & Biaya Admin Bulanan */}
            <section className="inspector-card inspector-card--breakdown">
              <h3 className="inspector-card-heading">Rincian Bunga, Pajak &amp; Biaya Admin Bulanan</h3>
              <InspectorFacts
                items={[
                  { label: "Saldo awal tercatat", value: <Amount value={money(asset.openingMinor)} /> },
                  {
                    label: "Suku bunga tahunan",
                    value:
                      terms.interestRateBps > 0
                        ? `${formatBpsRate(terms.interestRateBps)} p.a. (Pajak ${formatBpsRate(terms.interestTaxBps)})`
                        : "0% (Tanpa bunga)",
                  },
                  ...(terms.interestRateBps > 0
                    ? [
                        {
                          label: "Jadwal cair bunga",
                          value: formatInterestCycleLabel(terms.interestCycle, terms.interestDay),
                        },
                        {
                          label: "Estimasi bunga bersih",
                          value: (
                            <Amount
                              value={`+${money(yieldEst.netInterestMonthlyMinor)}/bln`}
                              tone="positive"
                            />
                          ),
                        },
                      ]
                    : []),
                  {
                    label: "Biaya admin bank",
                    value:
                      terms.adminFeeMinor > 0n ? (
                        <Amount value={`−${money(terms.adminFeeMinor)}/bln`} tone="negative" />
                      ) : (
                        "Bebas biaya admin"
                      ),
                  },
                ]}
              />
              {(terms.interestRateBps > 0 || terms.adminFeeMinor > 0n) && (
                <div className="inspector-highlight-box">
                  <span>Dampak Bersih Bulanan (Bunga − Admin)</span>
                  <strong>
                    {formatSignedMinor(
                      yieldEst.netAfterAdminMonthlyMinor,
                      asset.currency,
                      asset.exponent
                    )}
                    /bln
                  </strong>
                </div>
              )}
            </section>

            {/* Kartu 3: Tindakan Rekening */}
            <section className="inspector-card inspector-card--actions">
              <div className="assets-inspector-actions">
                {isEmoney && (
                  <button
                    type="button"
                    className="button-primary"
                    onClick={() => {
                      close();
                      setTopUpPreset({
                        kind: "transfer",
                        destinationId: asset.id,
                        note: `Top-Up ${asset.displayName}`,
                      });
                    }}
                  >
                    <Plus size={14} weight="bold" aria-hidden="true" />
                    <span>Top-Up E-Money</span>
                  </button>
                )}
                <button
                  type="button"
                  className="finance-secondary"
                  onClick={() => {
                    close();
                    setViewingAsset(asset);
                  }}
                >
                  Riwayat &amp; Mutasi Akun
                </button>
                <button
                  type="button"
                  className="finance-secondary"
                  onClick={() => {
                    close();
                    setCorrecting(asset);
                  }}
                >
                  Koreksi Saldo Awal
                </button>
                <button
                  type="button"
                  className="finance-secondary"
                  onClick={() => {
                    close();
                    setEditing(asset);
                  }}
                >
                  <PencilSimple size={14} weight="bold" aria-hidden="true" />
                  <span>Ubah Rekening</span>
                </button>
              </div>
            </section>
          </div>
        ),
      },
      trigger ?? (document.activeElement as HTMLElement | null)
    );
  }

  const renderAccountGroup = (
    id: string,
    title: string,
    items: FinanceAsset[],
    isEmoney = false,
    isTabungan = false
  ) => {
    const isCollapsed = Boolean(collapsedGroups[id]);
    const groupSubtotal = items.reduce((sum, a) => sum + BigInt(a.balanceMinor), 0n);

    return (
      <section className="assets-group-card" key={id}>
        <button
          type="button"
          onClick={() => toggleGroup(id)}
          className="assets-group-header"
          aria-expanded={!isCollapsed}
        >
          <div className="assets-group-title-wrap">
            {isCollapsed ? (
              <CaretRight size={14} weight="bold" aria-hidden="true" />
            ) : (
              <CaretDown size={14} weight="bold" aria-hidden="true" />
            )}
            <span className="assets-group-title">{title}</span>
            <span className="assets-group-count">{items.length} akun</span>
          </div>
          <span className="assets-group-subtotal">
            {formatMinor(groupSubtotal.toString(), pCurr, pExp)}
          </span>
        </button>

        {!isCollapsed && (
          <div className="assets-group-body">
            {!items.length ? (
              <div className="assets-group-empty">Belum ada rekening pada kelompok ini.</div>
            ) : (
              items.map((asset) => {
                const terms = parseAssetTerms(asset.note);
                const yieldVal =
                  terms.interestRateBps > 0
                    ? estimateAssetMonthlyYield(BigInt(asset.balanceMinor), terms)
                    : null;
                const mark = resolveProviderMark(
                  asset.providerName,
                  asset.displayName,
                  asset.normallySpendable ? "blue" : asset.normallyLiquid ? "cyan" : "violet"
                );
                const subText = [asset.providerName, asset.assetTypeName]
                  .filter(Boolean)
                  .join(" · ");
                const termLabel =
                  isTabungan && terms.interestRateBps > 0
                    ? `Bunga ${formatBpsRate(terms.interestRateBps)} p.a.${
                        yieldVal && yieldVal.netInterestMonthlyMinor > 0n
                          ? ` · +${formatMinor(
                              yieldVal.netInterestMonthlyMinor.toString(),
                              asset.currency,
                              asset.exponent
                            )}/bln`
                          : ""
                      }`
                    : isEmoney
                    ? "Chip NFC Prabayar"
                    : terms.adminFeeMinor > 0n
                    ? `Admin ${formatMinor(
                        terms.adminFeeMinor.toString(),
                        asset.currency,
                        asset.exponent
                      )}/bln`
                    : "Bebas biaya admin";

                return (
                  <div
                    key={asset.id}
                    className="assets-account-row"
                    onClick={(event) => {
                      if (!shouldIgnoreRowClick(event.target)) {
                        openAccountInspector(asset, event.currentTarget);
                      }
                    }}
                  >
                    {/* Left: Official Provider Brand Icon + Name + Institution */}
                    <div className="assets-account-left">
                      <ProviderBrandMark mark={mark} />
                      <div className="assets-account-identity">
                        <div className="assets-account-name-line">
                          <button
                            type="button"
                            className="assets-account-name-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAccountInspector(asset, e.currentTarget);
                            }}
                          >
                            {asset.displayName}
                          </button>
                          {asset.safeSuffix && (
                            <span className="assets-account-suffix">•••• {asset.safeSuffix}</span>
                          )}
                        </div>
                        <div className="assets-account-sub">{subText || "Rekening Aset"}</div>
                        <div className="assets-account-mobile-term">{termLabel}</div>
                      </div>
                    </div>

                    {/* Middle: Term Pill (Desktop) */}
                    <div className="assets-account-middle">
                      <span
                        className={`assets-term-pill${
                          terms.interestRateBps > 0
                            ? " assets-term-pill--yield"
                            : terms.adminFeeMinor > 0n
                            ? " assets-term-pill--fee"
                            : ""
                        }`}
                      >
                        {termLabel}
                      </span>
                    </div>

                    {/* Right: Balance + Quick Action */}
                    <div className="assets-account-right">
                      <div className="assets-balance-block">
                        <div
                          className="assets-balance-val"
                          data-negative={BigInt(asset.balanceMinor) < 0n}
                        >
                          {formatMinor(asset.balanceMinor, asset.currency, asset.exponent)}
                        </div>
                        <div className="assets-balance-caption">Saldo Tercatat</div>
                      </div>

                      {isEmoney && (
                        <button
                          type="button"
                          className="assets-topup-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTopUpPreset({
                              kind: "transfer",
                              destinationId: asset.id,
                              note: `Top-Up ${asset.displayName}`,
                            });
                          }}
                        >
                          <Plus size={12} weight="bold" aria-hidden="true" />
                          <span>Top-Up</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
    );
  };

  // Tab 1: Daftar Rekening & Saldo (3 Collapsible Groups)
  const daftarRekeningPanel = !regularActive.length ? (
    <section className="surface finance-empty">
      <h2>{archived.length ? "Tidak ada rekening aktif" : "Belum ada rekening atau aset"}</h2>
      <p>
        {archived.length
          ? "Tampilkan yang diarsipkan untuk memulihkan rekening, atau tambahkan rekening baru."
          : "Tambahkan rekening bank, dompet tunai, e-wallet, atau kartu e-money pertama Anda."}
      </p>
      <button className="button-primary" type="button" onClick={openNewAsset}>
        <Plus size={16} weight="bold" aria-hidden="true" />
        <span>Tambah Rekening</span>
      </button>
    </section>
  ) : (
    <div className="assets-workspace">
      {renderAccountGroup("kas", "Kas, Bank Operasional & E-Wallet", kasBankAccounts)}
      {renderAccountGroup(
        "tabungan",
        "Tabungan Bunga Tinggi & Deposito",
        tabunganDepositoAccounts,
        false,
        true
      )}
      {renderAccountGroup("emoney", "Kartu Prabayar E-Money (Chip NFC)", emoneyAccounts, true)}
    </div>
  );

  // Tab 2: Bunga, Biaya Admin & Rekonsiliasi Saldo Awal (Functional Audit & Yield Comparison Tab)
  const rekonsiliasiPanel = (
    <div className="assets-workspace">
      <div className="assets-terms-summary-strip">
        <div className="assets-terms-stat-card">
          <span className="assets-terms-stat-label">Estimasi Bunga Bersih / Bulan</span>
          <strong className="assets-terms-stat-val pnl-positive">
            +{formatMinor(totalEstInterestBig.toString(), pCurr, pExp)}
          </strong>
        </div>
        <div className="assets-terms-stat-card">
          <span className="assets-terms-stat-label">Total Potongan Admin Bank / Bulan</span>
          <strong className="assets-terms-stat-val pnl-negative">
            −{formatMinor(totalAdminBig.toString(), pCurr, pExp)}
          </strong>
        </div>
        <div className="assets-terms-stat-card">
          <span className="assets-terms-stat-label">Dampak Bersih (Bunga − Admin) / Bulan</span>
          <strong
            className={`assets-terms-stat-val ${
              netMonthlyCarryBig >= 0n ? "pnl-positive" : "pnl-negative"
            }`}
          >
            {formatSignedMinor(netMonthlyCarryBig, pCurr, pExp)}
          </strong>
        </div>
      </div>

      {/* Desktop Evaluation & Reconciliation Table */}
      <div className="assets-reconcile-table-wrap">
        <table className="assets-reconcile-table">
          <thead>
            <tr>
              <th>Rekening &amp; Institusi</th>
              <th>Bunga Simpanan</th>
              <th>Est. Bunga Bersih / Bln</th>
              <th>Biaya Admin / Bln</th>
              <th>Saldo Awal → Saat Ini</th>
              <th style={{ textAlign: "right" }}>Rekonsiliasi &amp; Ketentuan</th>
            </tr>
          </thead>
          <tbody>
            {regularActive.map((asset) => {
              const terms = parseAssetTerms(asset.note);
              const yieldEst = estimateAssetMonthlyYield(BigInt(asset.balanceMinor), terms);
              const money = (v: string | bigint) => formatMinor(v, asset.currency, asset.exponent);
              return (
                <tr key={asset.id}>
                  <td>
                    <strong>{asset.displayName}</strong>
                    <div className="assets-account-sub">
                      {[asset.providerName, asset.assetTypeName].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td>
                    {terms.interestRateBps > 0
                      ? `${formatBpsRate(terms.interestRateBps)} p.a. (Pajak ${formatBpsRate(
                          terms.interestTaxBps
                        )})`
                      : "0%"}
                  </td>
                  <td className={yieldEst.netInterestMonthlyMinor > 0n ? "pnl-positive" : ""}>
                    {yieldEst.netInterestMonthlyMinor > 0n
                      ? `+${money(yieldEst.netInterestMonthlyMinor)}`
                      : "—"}
                  </td>
                  <td className={terms.adminFeeMinor > 0n ? "pnl-negative" : ""}>
                    {terms.adminFeeMinor > 0n ? `−${money(terms.adminFeeMinor)}` : "Gratis"}
                  </td>
                  <td>
                    {money(asset.openingMinor)} → <strong>{money(asset.balanceMinor)}</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="assets-reconcile-actions">
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => setCorrecting(asset)}
                      >
                        Koreksi Saldo
                      </button>
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => setEditing(asset)}
                      >
                        Atur Bunga/Admin
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Evaluation & Reconciliation List */}
      <div className="assets-reconcile-mobile-list">
        {regularActive.map((asset) => {
          const terms = parseAssetTerms(asset.note);
          const yieldEst = estimateAssetMonthlyYield(BigInt(asset.balanceMinor), terms);
          const money = (v: string | bigint) => formatMinor(v, asset.currency, asset.exponent);
          return (
            <div key={asset.id} className="assets-reconcile-mobile-item">
              <div className="assets-reconcile-mobile-top">
                <strong>{asset.displayName}</strong>
                <span>{money(asset.balanceMinor)}</span>
              </div>
              <div className="assets-account-sub">
                Bunga:{" "}
                {terms.interestRateBps > 0
                  ? `${formatBpsRate(terms.interestRateBps)} (+${money(
                      yieldEst.netInterestMonthlyMinor
                    )}/bln)`
                  : "0%"}{" "}
                · Admin: {terms.adminFeeMinor > 0n ? `−${money(terms.adminFeeMinor)}/bln` : "Gratis"}
              </div>
              <div className="assets-reconcile-actions">
                <button type="button" className="row-action" onClick={() => setCorrecting(asset)}>
                  Koreksi Saldo
                </button>
                <button type="button" className="row-action" onClick={() => setEditing(asset)}>
                  Atur Bunga/Admin
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const heading = (
    <PageHeading
      title="Rekening & Aset"
      summary={
        <>
          <span>
            Total Tercatat:{" "}
            <strong>{formatMinor(totalBalanceBig.toString(), pCurr, pExp)}</strong>
          </span>
          {primaryTotal?.liquidMinor && (
            <>
              <span aria-hidden="true">|</span>
              <span>
                Dana Likuid:{" "}
                <strong>{formatMinor(primaryTotal.liquidMinor, pCurr, pExp)}</strong>
              </span>
            </>
          )}
        </>
      }
      actions={
        <>
          <ExportMenuButton dataset="assets" label="Ekspor Aset" />
          <button className="button-primary" type="button" onClick={openNewAsset}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            <span>Tambah Rekening</span>
          </button>
        </>
      }
    />
  );

  return (
    <div className="page finance-assets-page">
      <PageTabs
        label="Lembar Kerja Rekening & Aset"
        heading={heading}
        tabs={[
          {
            id: "rekening",
            label: "Daftar Rekening & Saldo",
            panel: daftarRekeningPanel,
          },
          {
            id: "rekonsiliasi",
            label: "Bunga, Admin & Rekonsiliasi",
            panel: rekonsiliasiPanel,
          },
        ]}
      />

      {archived.length > 0 && (
        <>
          <label className="finance-history-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />{" "}
            Tampilkan rekening yang diarsipkan ({archived.length})
          </label>
          {showArchived && (
            <section className="surface finance-archived">
              <SectionHeading title="Rekening diarsipkan" />
              <div className="asset-list">
                {archived.map((asset) => {
                  const mark = resolveProviderMark(
                    asset.providerName,
                    asset.displayName,
                    asset.normallySpendable ? "blue" : asset.normallyLiquid ? "cyan" : "violet"
                  );
                  return (
                    <div
                      className="asset-row asset-row--interactive data-list-row data-list-row--entity"
                      key={asset.id}
                      onClick={(event) => {
                        if (!shouldIgnoreRowClick(event.target)) setViewingAsset(asset);
                      }}
                    >
                      <div className="data-list-identity">
                        <ProviderBrandMark mark={mark} />
                        <div className="asset-copy">
                          <button
                            type="button"
                            className="asset-title-trigger"
                            onClick={() => setViewingAsset(asset)}
                          >
                            <strong>{asset.displayName}</strong>
                          </button>
                          <small>{ASSET_CLASS_LABEL[asset.assetClass]} · Diarsipkan</small>
                        </div>
                      </div>
                      <div className="data-list-management">
                        <strong className="asset-amount financial-value financial-value--entity">
                          {formatMinor(asset.balanceMinor, asset.currency, asset.exponent)}
                        </strong>
                        <div className="data-list-actions">
                          <button
                            type="button"
                            className="row-action"
                            onClick={() => setCorrecting(asset)}
                          >
                            Riwayat saldo awal
                          </button>
                          <button
                            type="button"
                            className="row-action"
                            disabled={pending || refreshing}
                            aria-busy={pending && restoringId === asset.id}
                            onClick={() => void restore(asset.id)}
                          >
                            {pending && restoringId === asset.id ? (
                              <LoadingIndicator>Memulihkan...</LoadingIndicator>
                            ) : (
                              "Pulihkan"
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {error && (
        <p className="finance-error" role="alert">
          {error}
        </p>
      )}

      <ExcelStatusBar
        rowCount={regularActive.length}
        totalIn={formatMinor(totalEstInterestBig.toString(), pCurr, pExp)}
        totalOut={formatMinor(totalAdminBig.toString(), pCurr, pExp)}
        customNetLabel="Total Nilai Tercatat"
        customNetValue={formatMinor(totalBalanceBig.toString(), pCurr, pExp)}
      />

      {liveViewingAsset && (
        <AssetDetailDialog
          key={liveViewingAsset.id}
          asset={liveViewingAsset}
          onClose={() => setViewingAsset(null)}
          onEdit={() => setEditing(liveViewingAsset)}
          onCorrectOpening={() => setCorrecting(liveViewingAsset)}
          onPayBill={() => setPayingCredit(liveViewingAsset)}
          onSettleReceivable={() => setSettlingReceivable(liveViewingAsset)}
        />
      )}
      {editing && (
        <AssetForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {payingCredit && (
        <PayCreditBillDialog
          key={payingCredit.id}
          creditAsset={payingCredit}
          regularAssets={regularActive}
          onClose={() => setPayingCredit(null)}
        />
      )}
      {settlingReceivable && (
        <SettleReceivableDialog
          key={settlingReceivable.id}
          receivableAsset={settlingReceivable}
          regularAssets={regularActive}
          onClose={() => setSettlingReceivable(null)}
        />
      )}
      {correcting && (
        <AssetOpeningCorrection
          key={correcting.id}
          asset={correcting}
          onClose={() => setCorrecting(null)}
        />
      )}
      {topUpPreset && (
        <TransactionEditor
          key={`topup:${topUpPreset.destinationId}`}
          preset={topUpPreset}
          onClose={() => setTopUpPreset(null)}
        />
      )}
    </div>
  );
}
