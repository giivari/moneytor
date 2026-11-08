"use client";

import { sortTemporal } from "@/lib/list-order";
import { useListSort } from "./use-list-sort";
import { ListSortControl } from "./list-sort-control";

import { useEffect, useRef, useState } from "react";
import { Bank, CheckCircle, CreditCard, Drop, PencilSimple, Plus, Wallet, X } from "@phosphor-icons/react";
import { Kpi, monthLabel, PageHeading } from "./ui";
import { StatusBar } from "./status-bar";
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
  creditStateForDesiredBills,
  encodeCreditNote,
  formatShortDueIso,
  isCreditAsset,
  isReceivableAsset,
  nextMonthlyDueDayIso,
  parseCreditMeta,
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
import { InvestmentSummary } from "./investment-summary";
import { useMobileViewport } from "./use-mobile-viewport";

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

function AssetForm({
  initial,
  onClose,
}: {
  initial?: FinanceAsset;
  onClose: () => void;
}) {
  const { refresh, notify } = useFinanceFeedback();
  const dialog = useFinanceDialog(onClose);
  const { options, optionsError, retry, reload } = useFinanceOptions();
  const [error, setError] = useState("");
  const { pending, begin, finish } = useMutationPending();
  const [operation, setOperation] = useState<"save" | "archive">("save");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const classReplay = useRef<{ payload: string; key: string } | null>(null);

  const initialMeta = parseCreditMeta(initial?.note);
  const initialTerms = parseAssetTerms(initial?.note);
  const initialBills = initial ? computeCreditBills(initial) : null;
  const [assetClass, setAssetClass] = useState<AssetClass | "">(initial?.assetClass ?? "");
  const isCredit = assetClass === "liability";
  const hasScheduledInstallments = Boolean(
    initial?.creditInstallments?.some((row) => row.status === "scheduled"),
  );
  const [dueDay, setDueDay] = useState<string>(
    initial ? String(initialMeta.dueDay) : "1",
  );
  const [cutoffDay, setCutoffDay] = useState<string>(
    initial ? String(initialMeta.cutoffDay) : "20",
  );
  const [creditLimit, setCreditLimit] = useState<string>(
    initial && initialMeta.limitMinor > 0n
      ? minorToInput(initialMeta.limitMinor.toString(), initial.exponent)
      : "",
  );
  const [currentBillInput, setCurrentBillInput] = useState<string>(
    initialBills && initialBills.currentBillMinor > 0n
      ? minorToInput(initialBills.currentBillMinor.toString(), initial!.exponent)
      : "",
  );
  const [nextBillInput, setNextBillInput] = useState<string>(
    initialBills && initialBills.nextBillMinor > 0n
      ? minorToInput(initialBills.nextBillMinor.toString(), initial!.exponent)
      : "",
  );

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
  const exponent = options?.currencies.find((item) => item.code === currency)?.exponent ?? 0;

  const parsedDueNum = Number(dueDay) >= 1 && Number(dueDay) <= 31 ? Number(dueDay) : 1;
  const previewCurrentDue = formatShortDueIso(nextMonthlyDueDayIso(parsedDueNum, 0));
  const previewNextDue = formatShortDueIso(nextMonthlyDueDayIso(parsedDueNum, 1));

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
      let encodedNote: string | undefined;

      if (isCredit) {
        const parsedDue = dueDay.trim() ? Number(dueDay.trim()) : 1;
        const parsedCutoff = cutoffDay.trim() ? Number(cutoffDay.trim()) : 20;
        const limitMinor = creditLimit.trim()
          ? BigInt(inputToMinor(creditLimit.trim(), exponent))
          : 0n;
        const desiredCurrentMinor = currentBillInput.trim()
          ? BigInt(inputToMinor(currentBillInput.trim(), exponent))
          : 0n;
        const desiredNextMinor = nextBillInput.trim()
          ? BigInt(inputToMinor(nextBillInput.trim(), exponent))
          : 0n;
        // carryCurrent absorbs the ledger balance so the saved bills equal what the owner typed.
        encodedNote = encodeCreditNote(note, true, creditStateForDesiredBills({
          balanceMinor: initial ? BigInt(initial.balanceMinor) : 0n,
          desiredCurrentMinor,
          desiredNextMinor,
          dueDay: parsedDue,
          cutoffDay: parsedCutoff,
          limitMinor,
          // Installments due after the next bill are not on the form; keep them.
          existing: initial ? initialMeta : undefined,
        }));
      } else {
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
        encodedNote = encodeAssetTermsNote(note, {
          adminFeeMinor: parsedAdminMinor,
          adminDay: parsedAdminDay,
          autoPostAdminFee: parsedAdminMinor > 0n && autoPostAdmin,
          interestRateBps: parsedRate,
          interestTaxBps: parsedTax,
          interestCycle,
          interestDay: Number(interestDay),
          adminRuleId: initialTerms.adminRuleId,
        });
      }

      if (encodedNote && encodedNote.length > 1000) {
        throw new Error("Catatan terlalu panjang.");
      }

      const openingMinorStr = initial
        ? undefined
        : isCredit
          ? "0"
          : inputToMinor(opening.trim() || "0", exponent);

      const body = {
        id: initial?.id,
        displayName: name,
        currency,
        openingAmountMinor: openingMinorStr,
        openingEffectiveAt: new Date().toISOString(),
        assetTypeId: typeId || options?.catalogs.assetTypes[0]?.id,
        assetGroupId: groupId || undefined,
        providerId: providerId || undefined,
        paymentNetworkId: networkId || undefined,
        normallyLiquid: isCredit || assetClass === "receivable" ? false : liquid,
        normallySpendable: isCredit || assetClass === "receivable" ? false : spendable,
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
      await financeRequest(initial ? "asset-update" : "asset-create", body);
      refresh();
      notify(
        initial
          ? "Data berhasil diperbarui."
          : isCredit
            ? "Akun Kredit / PayLater berhasil ditambahkan."
            : "Aset berhasil ditambahkan.",
      );
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
          <span className="eyebrow">{isCredit ? "FASILITAS KREDIT" : "ASET TERCATAT"}</span>
          <h2 id="asset-form-title">
            {initial
              ? isCredit
                ? "Ubah Fasilitas Kredit"
                : "Ubah aset"
              : isCredit
                ? "Tambah Fasilitas Kredit"
                : "Aset baru"}
          </h2>
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
            <div className="field">
              <span>Kelas akun (wajib dipilih)</span>
              <div className="segmented" role="group" aria-label="Kelas akun">
                <button
                  type="button"
                  className={assetClass === "asset" ? "selected" : ""}
                  aria-pressed={assetClass === "asset"}
                  onClick={() => {
                    setAssetClass("asset");
                    if (error) setError("");
                  }}
                >
                  Aset (Rekening / Kas)
                </button>
                <button
                  type="button"
                  className={assetClass === "liability" ? "selected" : ""}
                  aria-pressed={assetClass === "liability"}
                  onClick={() => {
                    setAssetClass("liability");
                    setLiquid(false);
                    setSpendable(false);
                    if (error) setError("");
                  }}
                >
                  Kewajiban (Kredit)
                </button>
                <button
                  type="button"
                  className={assetClass === "receivable" ? "selected" : ""}
                  aria-pressed={assetClass === "receivable"}
                  onClick={() => {
                    setAssetClass("receivable");
                    setLiquid(false);
                    setSpendable(false);
                    if (error) setError("");
                  }}
                >
                  Piutang (Talangan)
                </button>
              </div>
              <small>
                {!assetClass
                  ? "Pilih kelas akun terlebih dahulu: Aset, Kewajiban, atau Piutang."
                  : hasScheduledInstallments && initial && assetClass !== initial.assetClass
                    ? "Perhatian: kelas akun tidak dapat diubah selama masih ada jadwal cicilan terjadwal."
                    : `Kelas dipilih: ${ASSET_CLASS_LABEL[assetClass]}`}
              </small>
            </div>

            <label className="field">
              <span>{isCredit ? "Nama fasilitas kredit" : "Nama aset"}</span>
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={isCredit ? "Mis. Kartu Kredit BCA, SPayLater, Kredivo, KTA" : "Mis. BNI Taplus Muda"}
              />
            </label>

            {!isCredit && !initial && (
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

            {isCredit && (
              <>
                <div className="field-grid">
                  {!initial && (
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
                  )}
                  <label className="field">
                    <span>Limit kredit ({currency})</span>
                    <input
                      inputMode="decimal"
                      value={creditLimit}
                      onChange={(event) => setCreditLimit(event.target.value)}
                      placeholder="0"
                    />
                    <small>Opsional. Untuk memantau sisa limit yang masih tersedia.</small>
                  </label>
                </div>

                <div className="field-grid">
                  <label className="field">
                    <span>Batas tgl transaksi / Cutoff (1–31)</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={cutoffDay}
                      onChange={(event) => setCutoffDay(event.target.value)}
                      placeholder="20"
                    />
                    <small>Transaksi di atas tgl ini otomatis masuk ke tagihan bulan berikutnya.</small>
                  </label>
                  <label className="field">
                    <span>Tanggal jatuh tempo bulanan (1–31)</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={dueDay}
                      onChange={(event) => setDueDay(event.target.value)}
                      placeholder="1"
                    />
                    <small>Mis. tgl 1 awal bulan atau tgl 25 akhir bulan.</small>
                  </label>
                </div>

                <div className="field-grid">
                  <label className="field">
                    <span>Tagihan jatuh tempo terdekat ({previewCurrentDue})</span>
                    <input
                      inputMode="decimal"
                      value={currentBillInput}
                      onChange={(event) => setCurrentBillInput(event.target.value)}
                      placeholder="0"
                    />
                    <small>Isi jika sudah ada tagihan berjalan yang jatuh tempo pada {previewCurrentDue}.</small>
                  </label>
                  <label className="field">
                    <span>Tagihan periode berikutnya ({previewNextDue})</span>
                    <input
                      inputMode="decimal"
                      value={nextBillInput}
                      onChange={(event) => setNextBillInput(event.target.value)}
                      placeholder="0"
                    />
                    <small>Isi jika sudah ada tagihan untuk periode bulan depan ({previewNextDue}).</small>
                  </label>
                </div>
              </>
            )}

            <div className="field-grid">
              <InlineCatalogSelect
                label="Jenis aset"
                catalog="assetTypes"
                createLabel="jenis aset"
                required
                value={typeId || options.catalogs.assetTypes[0]?.id || ""}
                items={options.catalogs.assetTypes}
                extraOptions={
                  initial?.assetTypeId &&
                  !options.catalogs.assetTypes.some((item) => item.id === initial.assetTypeId) ? (
                    <option value={initial.assetTypeId}>{initial.assetTypeName} (diarsipkan)</option>
                  ) : undefined
                }
                onCreated={() => void reload()}
                onChange={setTypeId}
              />
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
            </div>

            <div className="field-grid">
              <InlineCatalogSelect
                label="Penyedia"
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

            {!isCredit ? (
              <>
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

                <div className="field-grid">
                  <label className="field">
                    <span>Biaya admin bulanan ({currency})</span>
                    <input
                      inputMode="decimal"
                      value={adminFee}
                      onChange={(event) => setAdminFee(event.target.value)}
                      placeholder="0 — Gratis admin"
                    />
                    <small>Opsional. Potongan administrasi rutin rekening.</small>
                  </label>
                  <label className="field">
                    <span>Bunga simpanan / deposito (% p.a.)</span>
                    <input
                      inputMode="decimal"
                      value={interestRate}
                      onChange={(event) => setInterestRate(event.target.value)}
                      placeholder="Mis. 0,5 atau 4,25"
                    />
                    <small>Opsional. Suku bunga tahunan tabungan atau deposito.</small>
                  </label>
                </div>

                {(previewAdminMinor > 0n || previewRateBps > 0) && (
                  <div className="asset-terms-config">
                    <div className="field-grid">
                      {previewAdminMinor > 0n && (
                        <label className="field">
                          <span>Jadwal potong biaya admin</span>
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
                            <span>Siklus pencairan bunga</span>
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
                              <span>Tanggal cair bunga bulanan</span>
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
                            <small>Umumnya 20% PPh final simpanan/deposito.</small>
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
                        <span>Catat biaya admin otomatis tiap bulan di Automation</span>
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
              </>
            ) : (
              <p className="finance-hint">
                Transaksi s.d. tanggal <strong>{cutoffDay || 20}</strong> masuk ke tagihan jatuh tempo terdekat (<strong>{previewCurrentDue}</strong>), sedangkan transaksi di atas tanggal <strong>{cutoffDay || 20}</strong> otomatis masuk ke tagihan periode berikutnya (<strong>{previewNextDue}</strong>).
              </p>
            )}

            <div className="field-grid">
              <label className="field">
                <span>4 digit/karakter terakhir (opsional)</span>
                <input
                  maxLength={4}
                  value={suffix}
                  onChange={(event) => setSuffix(event.target.value)}
                />
                <small>Untuk membedakan rekening atau kartu tanpa menyimpan nomor lengkap.</small>
              </label>
              <label className="field">
                <span>Catatan</span>
                <textarea
                  rows={2}
                  maxLength={850}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Opsional"
                />
              </label>
            </div>

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
                ) : isCredit ? (
                  "Simpan Kredit / PayLater"
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
  onPayBill: () => void;
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
          <div className="route-loading-status asset-detail-loading" role="status">
            <LoadingIndicator>Memuat riwayat akun…</LoadingIndicator>
          </div>
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
              onPayBill();
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

function PayCreditBillDialog({
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

function SettleReceivableDialog({
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
    {loading ? <div className="route-loading-status" role="status"><LoadingIndicator>Menyiapkan formulir…</LoadingIndicator><span>Memuat saldo awal.</span></div> : history && <form onSubmit={submit} aria-busy={pending}><fieldset className="finance-fieldset" disabled={pending}>
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

function getAccountInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return ((parts[0][0] || "") + (parts[1][0] || "")).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function AssetsManager({ assets, totals, investmentTotals }: { assets: FinanceAsset[]; totals: { currency: string; exponent: number; amountMinor: string; unpricedCount: number; liquidMinor?: string; eligibleMinor?: string; liabilitiesMinor?: string }[]; investmentTotals: InvestmentTotal[] }) {
  const mobile = useMobileViewport();
  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  const [viewingAsset, setViewingAsset] = useState<FinanceAsset | null>(null);
  const [editing, setEditing] = useState<FinanceAsset | "new" | null>(null);
  const [payingCredit, setPayingCredit] = useState<FinanceAsset | null>(null);
  const [settlingReceivable, setSettlingReceivable] = useState<FinanceAsset | null>(null);
  const [correcting, setCorrecting] = useState<FinanceAsset | null>(null);
  const { pending, begin, finish } = useMutationPending();
  const { refresh, notify, refreshing } = useFinanceFeedback();
  const [restoringId, setRestoringId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  async function restore(id: string) {
    if (refreshing || !begin()) return; setRestoringId(id); setError("");
    try { await financeRequest("asset-restore", { id }); refresh(); notify("Aset berhasil dipulihkan."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Aset belum dapat dipulihkan."); }
    finally { finish(); }
  }
  const openNewAsset = () => setEditing("new");
  const active = assets.filter((item) => item.isActive);
  const regularActive = active.filter((item) => !isCreditAsset(item));
  const creditActive = active.filter((item) => isCreditAsset(item));
  const archived = assets.filter((item) => !item.isActive);
  const creditFirst = creditActive.some((item) => computeCreditBills(item).totalUnpaidMinor > 0n);

  const liveViewingAsset = viewingAsset
    ? assets.find((item) => item.id === viewingAsset.id) ?? viewingAsset
    : null;

  const creditSection = creditActive.length > 0 ? (
    <section className="surface credit-assets-section">
      <SectionHeading
        title="Fasilitas Kredit"
        eyebrow={creditFirst ? "PERLU PERHATIAN · ADA TAGIHAN" : "TAGIHAN BERJALAN & FASILITAS KREDIT"}
        action={<div className="section-heading-actions"><span className="count-pill">{creditActive.length} akun</span></div>}
      />
      <div className="credit-card-list">
        {creditActive.map((asset) => {
          const mark = resolveProviderMark(asset.providerName, asset.displayName, "coral");
          const meta = parseCreditMeta(asset.note);
          const bills = computeCreditBills(asset);
          const hasBill = bills.totalUnpaidMinor > 0n;
          const subtitle = [asset.providerName, asset.safeSuffix ? `•••• ${asset.safeSuffix}` : null].filter(Boolean).join(" · ");
          const limitUsedPct = bills.limitMinor > 0n && bills.availableLimitMinor !== null
            ? Math.min(100, Math.max(0, Math.round(Number(((bills.limitMinor - bills.availableLimitMinor) * 100n) / bills.limitMinor))))
            : null;
          return (
            <article
              className={`credit-card credit-card--interactive${hasBill ? " credit-card--due" : ""}`}
              key={asset.id}
              onClick={(event) => {
                if (!shouldIgnoreRowClick(event.target)) setViewingAsset(asset);
              }}
            >
              <div className="credit-card-head">
                <ProviderBrandMark mark={mark} />
                <div className="credit-card-title">
                  <button
                    type="button"
                    className="asset-title-trigger"
                    onClick={() => setViewingAsset(asset)}
                  >
                    <strong>{asset.displayName}</strong>
                  </button>
                  {subtitle && <span>{subtitle}</span>}
                </div>
              </div>
              <div className="credit-card-chips">
                <span className="credit-chip">{ASSET_CLASS_LABEL[asset.assetClass]}</span>
                <span className="credit-chip">Cutoff tgl {bills.cutoffDay}</span>
                <span className="credit-chip">Jatuh tempo tgl {bills.dueDay}</span>
                {(asset.creditInstallments ?? []).filter((row) => row.status === "scheduled").length > 0 && (
                  <span className="credit-chip">
                    {(asset.creditInstallments ?? []).filter((row) => row.status === "scheduled").length} cicilan terjadwal
                  </span>
                )}
              </div>
              {bills.availableLimitMinor !== null && (
                <div className="credit-limit">
                  <div className="credit-limit-text">
                    <span>Sisa limit</span>
                    <strong className="financial-value">{formatMinor(bills.availableLimitMinor.toString(), asset.currency, asset.exponent)}</strong>
                    <small>dari {formatMinor(bills.limitMinor.toString(), asset.currency, asset.exponent)}</small>
                  </div>
                  {limitUsedPct !== null && <div className="credit-limit-bar" aria-hidden="true"><span style={{ width: `${limitUsedPct}%` }} /></div>}
                </div>
              )}
              {meta.cleanNote && <small className="credit-card-note">{meta.cleanNote}</small>}
              {hasBill ? (
                <div className="credit-bills">
                  <div className="credit-bill-box credit-bill-box--current">
                    <span>Tagihan {formatShortDueIso(bills.currentDueIso)}</span>
                    <strong className="financial-value financial-value--entity">{formatMinor(bills.currentBillMinor.toString(), asset.currency, asset.exponent)}</strong>
                  </div>
                  {bills.nextBillMinor > 0n && (
                    <div className="credit-bill-box">
                      <span>Periode {formatShortDueIso(bills.nextDueIso)}</span>
                      <strong className="financial-value financial-value--entity">{formatMinor(bills.nextBillMinor.toString(), asset.currency, asset.exponent)}</strong>
                    </div>
                  )}
                </div>
              ) : (
                <strong className="pnl-positive credit-settled-pill"><CheckCircle size={15} weight="fill" /> {CREDIT_STATUS_LABEL[creditAccountStatus(bills)]}</strong>
              )}
              <div className="credit-card-actions">
                {hasBill && <button type="button" className="button-primary credit-pay-button" onClick={() => setPayingCredit(asset)}>Bayar tagihan</button>}
                <button type="button" className="row-action" onClick={() => setEditing(asset)}><PencilSimple size={14} weight="bold" /> Ubah / Atur tagihan</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  ) : null;

  return <div className="page finance-assets-page">
    <header className="page-header"><PageHeading title="Aset"
      description={totals[0] ? `Total Tercatat: ${formatMinor(totals[0].amountMinor, totals[0].currency, totals[0].exponent)}` : undefined}
      actions={<><ExportMenuButton dataset="assets" label="Ekspor Aset" /><button className="button-primary" type="button" onClick={openNewAsset}><Plus size={17} /> Tambah aset</button></>} /></header>
    {totals.map((item) => {
      const money = (value: string | undefined) => formatMinor(value ?? "0", item.currency, item.exponent);
      return <div className="ui-kpis assets-kpis" key={item.currency} aria-label={`Ringkasan aset ${item.currency}`}>
        <Kpi title="Total aset tercatat" icon={Bank} tone="neutral" value={money(item.amountMinor)} valueTone={BigInt(item.amountMinor) < 0n ? "negative" : ""}
          note={item.unpricedCount ? `${item.unpricedCount} posisi investasi tanpa harga belum termasuk` : `Termasuk investasi dan piutang · ${item.currency}`} />
        <Kpi title="Dana likuid" icon={Drop} tone="info" value={money(item.liquidMinor)} valueTone={BigInt(item.liquidMinor ?? "0") < 0n ? "negative" : ""} note="Akun aktif bertanda likuid" />
        <Kpi title="Dapat dipakai belanja" icon={Wallet} tone="positive" value={money(item.eligibleMinor)} valueTone={BigInt(item.eligibleMinor ?? "0") < 0n ? "negative" : ""} note="Sebelum cadangan dan kewajiban" />
        <Kpi title="Kewajiban kredit" icon={CreditCard} tone="negative" value={money(item.liabilitiesMinor)} note="Termasuk cicilan bulan berikutnya"
          action={<AppLink href="/credit" className="text-link">Kredit &amp; Talangan</AppLink>} />
      </div>;
    })}
    <div className="asset-overview-grid">
    <InvestmentSummary totals={investmentTotals} /></div>
    {creditFirst && creditSection}
    {!regularActive.length ? <section className="surface finance-empty"><h2>{archived.length ? "Tidak ada aset aktif" : "Belum ada aset"}</h2><p>{archived.length ? "Tampilkan yang diarsipkan untuk memulihkan aset, atau tambahkan aset baru." : "Buat akun atau aset pertama, lalu catat saldo awalnya."}</p>
      <button className="button-primary" type="button" onClick={openNewAsset}>Tambah aset</button></section> : <section className="surface"><SectionHeading title="Akun & nilai tercatat" eyebrow="ASET AKTIF" action={
        <div className="section-heading-actions">
          <div className="view-mode-toggle" role="group" aria-label="Mode tampilan aset">
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "card" ? "view-mode-btn--active" : ""}`}
              onClick={() => setViewMode("card")}
            >
              Kartu
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "table" ? "view-mode-btn--active" : ""}`}
              onClick={() => setViewMode("table")}
            >
              Tabel
            </button>
          </div>
          <span className="count-pill">{regularActive.length} aset</span>
          <ExportMenuButton dataset="assets" label="Ekspor Aset" />
        </div>
      } />
      {viewMode === "card" ? (
        <div className="asset-cards-grid">
          {regularActive.map((asset) => {
            const isReceivable = isReceivableAsset(asset);
            const terms = parseAssetTerms(asset.note);
            const termSummary = [
              isReceivable ? "Piutang / Talangan" : ASSET_CLASS_LABEL[asset.assetClass],
              !mobile && asset.assetGroupName ? asset.assetGroupName : null,
              terms.interestRateBps > 0 ? `Bunga ${formatBpsRate(terms.interestRateBps)} p.a.` : null,
              terms.adminFeeMinor > 0n ? `Admin ${formatMinor(terms.adminFeeMinor, asset.currency, asset.exponent)}/bln` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <article
                className="account-card"
                key={asset.id}
                onClick={(event) => {
                  if (!shouldIgnoreRowClick(event.target)) setViewingAsset(asset);
                }}
              >
                <div className="account-card-header">
                  <div className="account-card-brand">
                    <div className="account-card-initial" aria-hidden="true">
                      {getAccountInitials(asset.displayName)}
                    </div>
                    <div className="account-card-names">
                      <button
                        type="button"
                        className="asset-title-trigger"
                        onClick={() => setViewingAsset(asset)}
                      >
                        <strong>{asset.displayName}</strong>
                      </button>
                      <small>{asset.providerName ?? asset.assetTypeName}</small>
                    </div>
                  </div>
                  {asset.safeSuffix && (
                    <span className="account-card-number">•••• {asset.safeSuffix}</span>
                  )}
                </div>
                <div className="account-card-body">
                  <span className="account-card-label">Saldo Aktif</span>
                  <strong className="financial-value financial-value--entity account-card-amount">
                    {formatMinor(asset.balanceMinor, asset.currency, asset.exponent)}
                  </strong>
                </div>
                <div className="account-card-footer">
                  <span>{termSummary || ASSET_CLASS_LABEL[asset.assetClass]}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="asset-list">{regularActive.map((asset) => {
        const isReceivable = isReceivableAsset(asset);
        const mark = resolveProviderMark(
          asset.providerName,
          asset.displayName,
          isReceivable ? "teal" : asset.normallySpendable ? "blue" : asset.normallyLiquid ? "cyan" : "violet",
        );
        const terms = parseAssetTerms(asset.note);
        const termSummary = [
          isReceivable ? "Piutang / Talangan" : ASSET_CLASS_LABEL[asset.assetClass],
          !mobile && asset.assetGroupName ? asset.assetGroupName : null,
          terms.interestRateBps > 0 ? `Bunga ${formatBpsRate(terms.interestRateBps)} p.a.` : null,
          terms.adminFeeMinor > 0n ? `Admin ${formatMinor(terms.adminFeeMinor, asset.currency, asset.exponent)}/bln` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return <article
          className="asset-row asset-row--interactive data-list-row data-list-row--entity"
          key={asset.id}
          onClick={(event) => {
            if (!shouldIgnoreRowClick(event.target)) setViewingAsset(asset);
          }}
        >
        <div className="data-list-identity"><ProviderBrandMark mark={mark} />
          <div className="asset-copy">
            <button type="button" className="asset-title-trigger" onClick={() => setViewingAsset(asset)}>
              <strong>{asset.displayName}</strong>
            </button>
            <span>{[asset.providerName, asset.assetTypeName, asset.safeSuffix ? `•••• ${asset.safeSuffix}` : null].filter(Boolean).join(" · ")}</span>
            {termSummary && <small>{termSummary}</small>}
          </div></div>
        <div className="data-list-management"><strong className="asset-amount financial-value financial-value--entity">{formatMinor(asset.balanceMinor, asset.currency, asset.exponent)}</strong>
        <div className="data-list-actions">
          {isReceivable && BigInt(asset.balanceMinor) > 0n && (
            <button
              type="button"
              className="row-action"
              onClick={() => setSettlingReceivable(asset)}
            >
              Terima ganti
            </button>
          )}
          <button type="button" className="row-action" onClick={() => setEditing(asset)}><PencilSimple size={14} weight="bold" /> Ubah</button>
          <button type="button" className="row-action" onClick={() => setCorrecting(asset)}>Koreksi saldo awal</button>
        </div></div></article>;
      })}</div>
      )}</section>}

    {!creditFirst && creditSection}

    {archived.length > 0 && <><label className="finance-history-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Tampilkan yang diarsipkan ({archived.length})</label>
      {showArchived && <section className="surface finance-archived"><SectionHeading title="Aset diarsipkan" />
      <div className="asset-list">{archived.map((asset) => {
        const mark = resolveProviderMark(asset.providerName, asset.displayName, asset.normallySpendable ? "blue" : asset.normallyLiquid ? "cyan" : "violet");
        return <div
          className="asset-row asset-row--interactive data-list-row data-list-row--entity"
          key={asset.id}
          onClick={(event) => {
            if (!shouldIgnoreRowClick(event.target)) setViewingAsset(asset);
          }}
        ><div className="data-list-identity"><ProviderBrandMark mark={mark} /><div className="asset-copy"><button type="button" className="asset-title-trigger" onClick={() => setViewingAsset(asset)}><strong>{asset.displayName}</strong></button><small>{ASSET_CLASS_LABEL[asset.assetClass]} · Diarsipkan</small></div></div><div className="data-list-management"><strong className="asset-amount financial-value financial-value--entity">{formatMinor(asset.balanceMinor, asset.currency, asset.exponent)}</strong><div className="data-list-actions"><button type="button" className="row-action" onClick={() => setCorrecting(asset)}>Riwayat saldo awal</button><button type="button" className="row-action" disabled={pending || refreshing} aria-busy={pending && restoringId === asset.id} onClick={() => void restore(asset.id)}>{pending && restoringId === asset.id ? <LoadingIndicator>Memulihkan...</LoadingIndicator> : "Pulihkan"}</button></div></div></div>;
      })}</div><details className="context-help"><summary>Tentang aset diarsipkan</summary><p className="finance-hint supporting-prose">Saldo awal dan riwayat tetap tersimpan. Aset tidak dihapus permanen; pulihkan untuk menggunakannya kembali.</p></details></section>}</>}
    {error && <p className="finance-error" role="alert">{error}</p>}
    <details className="context-help"><summary>Cara membaca aset &amp; fasilitas kredit</summary><p className="finance-hint supporting-prose supporting-prose--section">Saldo aset positif berasal dari saldo awal dan seluruh pergerakan yang tercatat. Klik nama atau baris aset untuk melihat rincian ketentuan akun, bunga simpanan, biaya admin, dan mutasi terakhir.</p></details>
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
    {correcting && <AssetOpeningCorrection key={correcting.id} asset={correcting} onClose={() => setCorrecting(null)} />}
    <StatusBar
      rowCount={regularActive.length}
      extraLabel={totals[0] ? `Dana Likuid: ${formatMinor(totals[0].liquidMinor ?? "0", totals[0].currency, totals[0].exponent)}` : undefined}
    />
  </div>;
}
