"use client";

import { useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { OptionalChargesEditor, type ChargeEditorRow } from "./optional-charges-editor";
import { OptionalFormSection } from "./optional-form-section";
import { InlineCatalogSelect } from "./inline-catalog-select";
import { financeRequest, requestJson } from "@/lib/finance/client";
import { FinanceOptionsStatus, useFinanceDialog, useFinanceOptions } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import { isDedicatedCategory } from "@/lib/domain/catalog";
import {
  CREDIT_REMINDER_NOTE_PREFIX,
  calculateCreditInstallmentPlan,
  computeCreditBills,
  formatShortDueIso,
  isAfterCutoffDay,
  isCreditAsset,
  isReceivableAsset,
  nextMonthlyDueDayIso,
  parseCreditMeta,
} from "@/lib/domain/credit";
import { planSplitBill } from "@/lib/domain/split-bill";
import type { ActivityDraft, ActivityKind, FinanceActivity, FinanceAsset } from "@/lib/finance/types";

function localDate(iso?: string) {
  const date = iso ? new Date(iso) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formatAssetOptionLabel(item: FinanceAsset) {
  if (isCreditAsset(item)) {
    const bills = computeCreditBills(item);
    if (bills.availableLimitMinor !== null) {
      return `${item.displayName} (Kredit · Sisa limit ${formatMinor(bills.availableLimitMinor.toString(), item.currency, item.exponent)})`;
    }
    return `${item.displayName} (Kredit · Tagihan ${formatMinor(bills.totalUnpaidMinor.toString(), item.currency, item.exponent)})`;
  }
  return `${item.displayName} · ${formatMinor(item.balanceMinor, item.currency, item.exponent)}`;
}

export function TransactionEditor({ onClose, initial }: { onClose: () => void; initial?: FinanceActivity }) {
  const { refresh, notify } = useFinanceFeedback();
  const dialog = useFinanceDialog(onClose);
  const replay = useRef<{ payload: string; key: string } | null>(null);
  // A retried split bill must reuse its keys and receivable account, or a retry after a partial failure
  // would post the personal share twice or create a second receivable account.
  const splitReplay = useRef<{ payload: string; personalKey: string; transferKey: string; receivableId?: string } | null>(null);
  const { options, optionsError, retry, reload } = useFinanceOptions();
  const [error, setError] = useState("");
  const { pending, begin, finish } = useMutationPending();
  const [kind, setKind] = useState<ActivityKind>(initial?.kind ?? "expense");
  const [amount, setAmount] = useState(initial ? minorToInput(initial.baseAmountMinor, initial.exponent) : "");
  const [accountId, setAccountId] = useState(initial?.sourceAssetId ?? initial?.destinationAssetId ?? "");
  const [destinationId, setDestinationId] = useState(initial?.destinationAssetId ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [occurredAt, setOccurredAt] = useState(localDate(initial?.occurredAt));
  const [note, setNote] = useState(initial?.note ?? "");
  const [tenorMonths, setTenorMonths] = useState<number>(1);
  const [interestMode, setInterestMode] = useState<"percent" | "flat_minor">("percent");
  const [interestValue, setInterestValue] = useState<string>("");
  const [cycleOverride, setCycleOverride] = useState<"auto" | "current" | "next">("auto");
  const [charges, setCharges] = useState<ChargeEditorRow[]>(
    initial?.kind === "expense" ? initial.charges.map((charge) => ({
      id: charge.id, typeId: charge.typeId, amount: minorToInput(charge.amountMinor, initial.exponent),
    })) : []);
  const [fee, setFee] = useState(initial?.kind === "transfer" && initial.charges[0]
    ? minorToInput(initial.charges[0].amountMinor, initial.exponent) : "");
  const [chargesEnabled, setChargesEnabled] = useState(initial?.kind === "expense" && initial.charges.length > 0);
  const [feeEnabled, setFeeEnabled] = useState(initial?.kind === "transfer" && initial.charges.length > 0);
  const [feeMode, setFeeMode] = useState<"addon" | "deducted" | "both">("addon");
  const [deductedFee, setDeductedFee] = useState("");

  const [splitEnabled, setSplitEnabled] = useState(false);
  const [reimburseAmount, setReimburseAmount] = useState("");
  const [reimbursePerson, setReimbursePerson] = useState("");
  const [receivableAssetId, setReceivableAssetId] = useState("");

  const active = options?.assets ?? [];
  const account = accountId ? active.find((item) => item.id === accountId) : active[0];
  const currency = account?.currency ?? "IDR";
  const exponent = account?.exponent ?? 0;
  const destinationOptions = active.filter((item) => item.id !== account?.id && item.currency === currency);
  const destination = destinationId ? destinationOptions.find((item) => item.id === destinationId) : destinationOptions[0];
  const categories =
    options?.catalogs.transactionCategories.filter(
      (item) => item.appliesTo === kind && (!isDedicatedCategory(item) || item.id === initial?.categoryId),
    ) ?? [];
  const chargeTypes = options?.catalogs.chargeTypes.filter((item) => item.systemKey !== "transfer_fee") ?? [];

  const isCreditPurchase =
    !initial &&
    (kind === "expense" || (kind === "transfer" && Boolean(destination && !isCreditAsset(destination)))) &&
    Boolean(account && isCreditAsset(account));
  const creditMeta = parseCreditMeta(account?.note);
  const dueDay = creditMeta.dueDay;
  const cutoffDay = creditMeta.cutoffDay;

  const autoAfterCutoff = isAfterCutoffDay(new Date(occurredAt).toISOString(), cutoffDay, dueDay);
  const targetCycle: "current" | "next" =
    cycleOverride === "auto" ? (autoAfterCutoff ? "next" : "current") : cycleOverride;

  const currentDueShort = formatShortDueIso(nextMonthlyDueDayIso(dueDay, 0));
  const nextDueShort = formatShortDueIso(nextMonthlyDueDayIso(dueDay, 1));

  let creditPlan: ReturnType<typeof calculateCreditInstallmentPlan> | null = null;
  if (isCreditPurchase && amount.trim()) {
    try {
      const principalMinorStr = inputToMinor(amount, exponent);
      const parsedPercent =
        interestMode === "percent" && interestValue.trim()
          ? Number(interestValue.trim().replace(",", "."))
          : 0;
      const parsedFlatMinor =
        interestMode === "flat_minor" && interestValue.trim()
          ? inputToMinor(interestValue.trim(), exponent)
          : "0";
      creditPlan = calculateCreditInstallmentPlan({
        principalMinorStr,
        tenorMonths,
        interestMode,
        interestRatePercent: parsedPercent,
        interestFlatMinorStr: parsedFlatMinor,
      });
    } catch {
      creditPlan = null;
    }
  }

  let transferFeeSummaryHint: string | null = null;
  if (kind === "transfer" && feeEnabled && (fee.trim() || (feeMode === "both" && deductedFee.trim()))) {
    try {
      const addonFeeBig =
        (feeMode === "addon" || feeMode === "both") && fee.trim()
          ? BigInt(inputToMinor(fee.trim(), exponent))
          : 0n;
      const deductedFeeBig =
        feeMode === "deducted"
          ? (fee.trim() ? BigInt(inputToMinor(fee.trim(), exponent)) : 0n)
          : feeMode === "both"
            ? (deductedFee.trim() ? BigInt(inputToMinor(deductedFee.trim(), exponent)) : 0n)
            : 0n;
      const totalFeeBig = addonFeeBig + deductedFeeBig;

      if (amount.trim()) {
        const rawAmtMinor = inputToMinor(amount.trim(), exponent);
        const amtBig = BigInt(rawAmtMinor);
        const totalSource = amtBig + addonFeeBig;
        if (amtBig > deductedFeeBig) {
          const netDest = amtBig - deductedFeeBig;
          transferFeeSummaryHint = `Keluar dari sumber: ${formatMinor(totalSource.toString(), currency, exponent)} · Masuk bersih ke tujuan: ${formatMinor(netDest.toString(), currency, exponent)} · Total biaya admin: ${formatMinor(totalFeeBig.toString(), currency, exponent)}`;
        } else {
          transferFeeSummaryHint = `Total biaya admin: ${formatMinor(totalFeeBig.toString(), currency, exponent)} (Perhatian: Potongan di tujuan melebihi atau sama dengan nominal)`;
        }
      } else {
        transferFeeSummaryHint = `Biaya sumber: ${formatMinor(addonFeeBig.toString(), currency, exponent)} · Potongan tujuan: ${formatMinor(deductedFeeBig.toString(), currency, exponent)} · Total biaya: ${formatMinor(totalFeeBig.toString(), currency, exponent)}`;
      }
    } catch {
      transferFeeSummaryHint = null;
    }
  }

  let splitSummaryHint: string | null = null;
  if (kind === "expense" && splitEnabled && amount.trim() && reimburseAmount.trim()) {
    try {
      const totalBayarBig = BigInt(inputToMinor(amount.trim(), exponent));
      const talanganBig = BigInt(inputToMinor(reimburseAmount.trim(), exponent));
      if (talanganBig > 0n && talanganBig <= totalBayarBig) {
        const porsiPribadiBig = totalBayarBig - talanganBig;
        splitSummaryHint = `Total keluar dari rekening: ${formatMinor(totalBayarBig.toString(), currency, exponent)} · Pengeluaran pribadi Anda: ${formatMinor(porsiPribadiBig.toString(), currency, exponent)} · Masuk ke Piutang/Talangan: ${formatMinor(talanganBig.toString(), currency, exponent)}`;
      } else if (talanganBig > totalBayarBig) {
        splitSummaryHint = "Perhatian: Nominal talangan melebihi total nominal pembayaran.";
      }
    } catch {
      splitSummaryHint = null;
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!begin()) return; setError("");
    try {
      if (!account) throw new Error("Buat aset terlebih dahulu.");
      if (kind === "transfer" && !destination) throw new Error("Pilih dua aset aktif dengan mata uang yang sama.");
      const rawPrincipalMinor = inputToMinor(amount, exponent);
      const parsedPercent =
        interestMode === "percent" && interestValue.trim()
          ? Number(interestValue.trim().replace(",", "."))
          : 0;
      const parsedFlatMinor =
        interestMode === "flat_minor" && interestValue.trim()
          ? inputToMinor(interestValue.trim(), exponent)
          : "0";

      const plan = isCreditPurchase
        ? calculateCreditInstallmentPlan({
            principalMinorStr: rawPrincipalMinor,
            tenorMonths,
            interestMode,
            interestRatePercent: parsedPercent,
            interestFlatMinorStr: parsedFlatMinor,
          })
        : null;

      if (splitEnabled && !initial && kind === "expense" && reimburseAmount.trim()) {
        const splitCharges = (chargesEnabled ? charges : []).map((charge) => ({
          typeId: charge.typeId,
          amountMinor: inputToMinor(charge.amount, exponent),
        }));
        const split = planSplitBill({
          totalMinor: BigInt(rawPrincipalMinor),
          reimbursedMinor: BigInt(inputToMinor(reimburseAmount.trim(), exponent)),
          chargesMinor: splitCharges.reduce((sum, charge) => sum + BigInt(charge.amountMinor), 0n),
        });
        const personalShareBig = split.personalMinor;
        const talanganBig = split.reimbursedMinor;
        const splitPayload = JSON.stringify({ amount, reimburseAmount, reimbursePerson, receivableAssetId, accountId: account.id,
          categoryId, occurredAt, note, splitCharges });
        if (splitReplay.current?.payload !== splitPayload) {
          splitReplay.current = { payload: splitPayload, personalKey: crypto.randomUUID(), transferKey: crypto.randomUUID() };
        }
        const splitKeys = splitReplay.current;

        let targetReceivableId = receivableAssetId || splitKeys.receivableId || "";
        if (!targetReceivableId) {
          const existingReceivable = active.find(
            (item) =>
              item.currency === currency &&
              item.id !== account.id &&
              !isCreditAsset(item) &&
              isReceivableAsset(item),
          );
          if (existingReceivable) {
            targetReceivableId = existingReceivable.id;
          } else {
            const created = await financeRequest<{ id: string }>("asset-create", {
              displayName: currency === "IDR" ? "Piutang & Talangan" : `Piutang & Talangan (${currency})`,
              currency,
              openingAmountMinor: "0",
              openingEffectiveAt: new Date().toISOString(),
              assetTypeId: account.assetTypeId,
              assetGroupId: account.assetGroupId || undefined,
              normallyLiquid: false,
              normallySpendable: false,
              note: "Akun penampung uang talangan / split bill yang belum diganti.",
            });
            targetReceivableId = created.id;
          }
          splitKeys.receivableId = targetReceivableId;
        }

        const transferNote = `Talangan${reimbursePerson.trim() ? ` ${reimbursePerson.trim()}` : ""}${note.trim() ? ` · ${note.trim()}` : ""}`.slice(0, 1000);

        if (personalShareBig > 0n) {
          const personalDraft: ActivityDraft = {
            kind: "expense",
            amountMinor: personalShareBig.toString(),
            occurredAt: new Date(occurredAt).toISOString(),
            note: note.trim() || undefined,
            sourceAssetId: account.id,
            categoryId: categoryId || undefined,
            charges: splitCharges,
          };
          await financeRequest("post", { draft: personalDraft, idempotencyKey: splitKeys.personalKey });

          const splitTransferDraft: ActivityDraft = {
            kind: "transfer",
            amountMinor: talanganBig.toString(),
            occurredAt: new Date(occurredAt).toISOString(),
            note: transferNote,
            sourceAssetId: account.id,
            destinationAssetId: targetReceivableId,
          };
          await financeRequest("post", { draft: splitTransferDraft, idempotencyKey: splitKeys.transferKey });
        } else {
          // 100% talangan milik teman
          const splitTransferDraft: ActivityDraft = {
            kind: "transfer",
            amountMinor: talanganBig.toString(),
            occurredAt: new Date(occurredAt).toISOString(),
            note: transferNote,
            sourceAssetId: account.id,
            destinationAssetId: targetReceivableId,
          };
          await financeRequest("post", { draft: splitTransferDraft, idempotencyKey: splitKeys.transferKey });
        }

        refresh();
        notify("Transaksi berhasil dicatat (Porsi talangan dialihkan ke akun Piutang).");
        onClose();
        return;
      }

      let finalAmountMinor = rawPrincipalMinor;
      let finalTransferFeeMinor: string | undefined = undefined;
      // Installment top-up: the destination gets the full principal now; the server schedules the principal
      // and interest of installments 2..N into their own due months of the credit account.
      const isInstallmentTopUp = kind === "transfer" && isCreditPurchase && Boolean(plan) && tenorMonths > 1;

      if (kind === "transfer") {
        const transferPrincipalMinor = rawPrincipalMinor;

        const addonFeeBig =
          (feeMode === "addon" || feeMode === "both") && feeEnabled && fee.trim()
            ? BigInt(inputToMinor(fee.trim(), exponent))
            : 0n;
        const deductedFeeBig =
          feeEnabled
            ? feeMode === "deducted"
              ? (fee.trim() ? BigInt(inputToMinor(fee.trim(), exponent)) : 0n)
              : feeMode === "both"
                ? (deductedFee.trim() ? BigInt(inputToMinor(deductedFee.trim(), exponent)) : 0n)
                : 0n
            : 0n;

        if (deductedFeeBig > 0n && deductedFeeBig >= BigInt(transferPrincipalMinor)) {
          throw new Error("Biaya potong di tujuan tidak boleh melebihi atau sama dengan nominal transaksi.");
        }

        finalAmountMinor = (BigInt(transferPrincipalMinor) - deductedFeeBig).toString();

        const creditInterest = isCreditPurchase && plan ? BigInt(plan.monthlyInterestMinor) : 0n;
        const totalFee = addonFeeBig + deductedFeeBig + creditInterest;
        if (totalFee > 0n) {
          finalTransferFeeMinor = totalFee.toString();
        }
      } else {
        finalAmountMinor = plan ? plan.firstMonthTotalMinor : rawPrincipalMinor;
      }

      const postedAmountMinor = finalAmountMinor;

      const effectiveNote =
        isCreditPurchase && tenorMonths > 1
          ? isInstallmentTopUp
            ? `${note.trim() || account.displayName} (Dicicil ${tenorMonths}x · tagihan 1/${tenorMonths})`
            : `${note.trim() || account.displayName} (Cicilan 1/${tenorMonths})`
          : note;

      const draft: ActivityDraft = {
        kind,
        amountMinor: postedAmountMinor,
        occurredAt: new Date(occurredAt).toISOString(),
        note: effectiveNote,
        ...(kind === "income" ? { destinationAssetId: account.id } : { sourceAssetId: account.id }),
        ...(kind === "transfer"
          ? {
              destinationAssetId: destination!.id,
              transferFeeMinor: finalTransferFeeMinor,
            }
          : {}),
        ...(kind !== "transfer" ? { categoryId: categoryId || undefined } : {}),
        ...(kind === "expense"
          ? {
              charges: (chargesEnabled ? charges : []).map((charge) => ({
                typeId: charge.typeId,
                amountMinor: inputToMinor(charge.amount, exponent),
              })),
            }
          : {}),
      };
      const payload = JSON.stringify({ id: initial?.id, draft, tenorMonths: isCreditPurchase ? tenorMonths : 1, targetCycle });
      if (replay.current?.payload !== payload) replay.current = { payload, key: crypto.randomUUID() };
      // The server assigns a credit outflow to the next billing cycle in the same database transaction as
      // the posting, using the authoritative ledger impact and the freshly locked account note.
      await financeRequest(initial ? "replace" : "post", {
        id: initial?.id,
        draft,
        idempotencyKey: replay.current.key,
        // The effective cycle (automatic or manual override) is stored with the activity so a later void or
        // correction releases exactly what this posting deferred.
        ...(isCreditPurchase ? { creditCycle: targetCycle } : {}),
        ...(isCreditPurchase && plan && tenorMonths > 1
          ? { creditInstallments: { count: tenorMonths, principalMinor: plan.monthlyPrincipalMinor, interestMinor: plan.monthlyInterestMinor } }
          : {}),
      });

      if (isCreditPurchase && plan && plan.futureInstallmentsMinor.length > 0) {
        const startOffset = targetCycle === "next" ? 2 : 1;
        const labelBase = note.trim() || categories.find((c) => c.id === categoryId)?.displayName || account.displayName;
        const installments = plan.futureInstallmentsMinor.map((amt, idx) => ({
          title: `Cicilan ${idx + 2}/${tenorMonths} · ${account.displayName} (${labelBase})`.slice(0, 120),
          amountMinor: amt,
          dueOn: nextMonthlyDueDayIso(dueDay, idx + startOffset),
          // The amount is already inside the credit account's schedule for that month; the prefix keeps the
          // reminder out of the planning totals so it is not counted twice.
          note: `${CREDIT_REMINDER_NOTE_PREFIX} cicilan ini sudah termasuk tagihan ${account.displayName} jatuh tempo ${formatShortDueIso(nextMonthlyDueDayIso(dueDay, idx + startOffset))}. Total ${tenorMonths}x = ${formatMinor(plan.grandTotalMinor, currency, exponent)}.`.slice(0, 500),
        }));
        await requestJson("/api/planning", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save-installments",
            title: `Cicilan ${account.displayName}`,
            currency,
            installments,
            idempotencyKey: crypto.randomUUID(),
          }),
          cache: "no-store",
        });
      }

      refresh();
      notify(
        initial
          ? "Transaksi berhasil dikoreksi."
          : isCreditPurchase
            ? tenorMonths > 1
              ? `Cicilan 1/${tenorMonths} masuk tagihan ${targetCycle === "next" ? nextDueShort : currentDueShort} & ${tenorMonths - 1} cicilan berikutnya dijadwalkan.`
              : `Transaksi masuk ke tagihan jatuh tempo ${targetCycle === "next" ? nextDueShort : currentDueShort}.`
            : "Transaksi berhasil dicatat.",
      );
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Transaksi gagal disimpan."); }
    finally { finish(); }
  }

  return <dialog ref={dialog} className="finance-dialog transaction-dialog" aria-labelledby="transaction-editor-title"
    onCancel={(event) => { if (pending) event.preventDefault(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">CATAT PERGERAKAN</span><h2 id="transaction-editor-title">{initial ? "Koreksi transaksi" : "Transaksi baru"}</h2></div>
      <button className="icon-button" type="button" onClick={() => dialog.current?.close()} aria-label="Tutup" disabled={pending}><X size={20} /></button></div>
    {initial && <p className="finance-hint">Koreksi membalik catatan lama dan menyimpan penggantinya. Riwayat lama tetap tersedia.</p>}
    {!options ? <FinanceOptionsStatus error={optionsError} retry={retry} /> : <form onSubmit={save} aria-busy={pending}><fieldset className="finance-fieldset" disabled={pending}>
      {!active.length && <p className="finance-hint">Buat aset di halaman Assets sebelum mencatat transaksi.</p>}
      <div className="field"><span>Jenis transaksi</span><div className="segmented" role="group" aria-label="Jenis transaksi">
        {(["expense", "income", "transfer"] as const).map((item) => <button type="button" key={item} className={kind === item ? "selected" : ""}
          onClick={() => { setKind(item); setCategoryId(""); }}>{item === "expense" ? "Pengeluaran" : item === "income" ? "Pemasukan" : "Transfer"}</button>)}
      </div></div>
      <label className="field transaction-amount-field"><span>{isCreditPurchase ? `Harga pokok transaksi (${currency})` : `Jumlah (${currency})`}</span><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></label>
      <label className="field"><span>{kind === "income" ? "Aset penerima" : "Aset sumber"}</span><select required value={account?.id ?? ""}
        onChange={(event) => setAccountId(event.target.value)}><option value="">Pilih aset aktif</option>{active.map((item) => <option key={item.id} value={item.id}>{formatAssetOptionLabel(item)}</option>)}</select></label>

      {isCreditPurchase && (
        <div className="credit-payment-scheme">
          <div className="field-grid">
            <label className="field">
              <span>Tenor / Skema pembayaran</span>
              <select
                value={tenorMonths}
                onChange={(event) => setTenorMonths(Number(event.target.value))}
              >
                <option value={1}>Bayar penuh 1x (Beli Sekarang Bayar Nanti)</option>
                <option value={2}>Cicilan 2 bulan (2x)</option>
                <option value={3}>Cicilan 3 bulan (3x)</option>
                <option value={6}>Cicilan 6 bulan (6x)</option>
                <option value={12}>Cicilan 12 bulan (12x)</option>
                <option value={24}>Cicilan 24 bulan (24x)</option>
              </select>
            </label>
            <label className="field">
              <span>Masuk ke periode tagihan</span>
              <select
                value={cycleOverride}
                onChange={(event) => setCycleOverride(event.target.value as "auto" | "current" | "next")}
              >
                <option value="auto">
                  Otomatis sesuai cutoff tgl {cutoffDay} ({autoAfterCutoff ? `Jatuh tempo ${nextDueShort}` : `Jatuh tempo ${currentDueShort}`})
                </option>
                <option value="current">Tagihan terdekat (Jatuh tempo {currentDueShort})</option>
                <option value="next">Tagihan bulan depan (Jatuh tempo {nextDueShort})</option>
              </select>
            </label>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Bunga / biaya kredit per bulan</span>
              <input
                inputMode="decimal"
                value={interestValue}
                onChange={(event) => setInterestValue(event.target.value)}
                placeholder={interestMode === "percent" ? "Mis. 2.95 atau 0" : "0"}
              />
            </label>
            <label className="field">
              <span>Satuan bunga</span>
              <select
                value={interestMode}
                onChange={(event) => setInterestMode(event.target.value as "percent" | "flat_minor")}
              >
                <option value="percent">Persen (% per bulan, mis. 2.95%)</option>
                <option value="flat_minor">Nominal tetap ({currency} per bulan)</option>
              </select>
            </label>
          </div>

          {creditPlan && (
            <small className="finance-hint">
              {tenorMonths === 1 ? (
                <>
                  Total tagihan: <strong>{formatMinor(creditPlan.firstMonthTotalMinor, currency, exponent)}</strong>{" "}
                  (pokok {formatMinor(creditPlan.monthlyPrincipalMinor, currency, exponent)} + bunga/biaya {formatMinor(creditPlan.monthlyInterestMinor, currency, exponent)}) → Masuk ke tagihan jatuh tempo <strong>{targetCycle === "next" ? nextDueShort : currentDueShort}</strong>.
                </>
              ) : (
                <>
                  Cicilan per bulan: <strong>{formatMinor(creditPlan.firstMonthTotalMinor, currency, exponent)}</strong>{" "}
                  (pokok {formatMinor(creditPlan.monthlyPrincipalMinor, currency, exponent)} + bunga {formatMinor(creditPlan.monthlyInterestMinor, currency, exponent)} / bln · Total {tenorMonths}x = {formatMinor(creditPlan.grandTotalMinor, currency, exponent)}). Cicilan 1/{tenorMonths} masuk ke tagihan <strong>{targetCycle === "next" ? nextDueShort : currentDueShort}</strong>.
                </>
              )}
            </small>
          )}
        </div>
      )}

      {kind === "transfer" && (
        <>
          <label className="field">
            <span>Aset tujuan</span>
            <select
              required
              value={destination?.id ?? ""}
              onChange={(event) => setDestinationId(event.target.value)}
            >
              <option value="">Pilih aset tujuan</option>
              {destinationOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatAssetOptionLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <OptionalFormSection label="Ada biaya transfer" enabled={feeEnabled} onChange={setFeeEnabled}>
            <label className="field">
              <span>Skema potongan biaya</span>
              <select
                value={feeMode}
                onChange={(event) => setFeeMode(event.target.value as "addon" | "deducted" | "both")}
              >
                <option value="addon">
                  Tambah di luar nominal (Potong dari akun sumber)
                </option>
                <option value="deducted">
                  Potong di dalam / di jalan (Mengurangi saldo masuk di tujuan)
                </option>
                <option value="both">
                  Biaya ganda (Kena admin di akun sumber + dipotong lagi di tujuan)
                </option>
              </select>
            </label>
            {feeMode === "both" ? (
              <div className="field-grid">
                <label className="field">
                  <span>Biaya di akun sumber ({currency})</span>
                  <input
                    inputMode="decimal"
                    value={fee}
                    onChange={(event) => setFee(event.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="field">
                  <span>Potongan di akun tujuan ({currency})</span>
                  <input
                    inputMode="decimal"
                    value={deductedFee}
                    onChange={(event) => setDeductedFee(event.target.value)}
                    placeholder="0"
                  />
                </label>
              </div>
            ) : (
              <label className="field">
                <span>
                  {feeMode === "deducted"
                    ? `Biaya potong di tujuan (${currency})`
                    : `Biaya di akun sumber (${currency})`}
                </span>
                <input
                  inputMode="decimal"
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                  placeholder="0"
                />
              </label>
            )}
            {transferFeeSummaryHint && (
              <small className="finance-hint">{transferFeeSummaryHint}</small>
            )}
          </OptionalFormSection>
        </>
      )}
      {kind !== "transfer" && <InlineCatalogSelect
        label="Kategori (opsional)"
        catalog="transactionCategories"
        appliesTo={kind}
        value={categoryId}
        emptyLabel="Tanpa kategori"
        items={categories}
        onCreated={() => void reload()}
        onChange={setCategoryId}
      />}
      {kind === "expense" && <OptionalChargesEditor enabled={chargesEnabled} onEnabledChange={setChargesEnabled}
        rows={charges} onChange={setCharges} chargeTypes={chargeTypes} maxRows={20} onChargeTypeCreated={() => void reload()} />}
      {!initial && kind === "expense" && !isCreditPurchase && (
        <OptionalFormSection
          label="Ada porsi talangan / bayarin orang lain (Split Bill)"
          enabled={splitEnabled}
          onChange={setSplitEnabled}
        >
          <div className="field-grid">
            <label className="field">
              <span>Nominal yang ditalangi / porsi orang lain ({currency})</span>
              <input
                inputMode="decimal"
                value={reimburseAmount}
                onChange={(event) => setReimburseAmount(event.target.value)}
                placeholder="0"
              />
            </label>
            <label className="field">
              <span>Nama teman / keterangan talangan (opsional)</span>
              <input
                value={reimbursePerson}
                onChange={(event) => setReimbursePerson(event.target.value)}
                placeholder="Mis. Budi & Siti"
              />
            </label>
          </div>
          <label className="field">
            <span>Akun penampung piutang/talangan</span>
            <select
              value={receivableAssetId}
              onChange={(event) => setReceivableAssetId(event.target.value)}
            >
              <option value="">Buat/gunakan akun &apos;Piutang &amp; Talangan&apos; otomatis</option>
              {destinationOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatAssetOptionLabel(item)}
                </option>
              ))}
            </select>
          </label>
          {splitSummaryHint && (
            <small className="finance-hint">{splitSummaryHint}</small>
          )}
        </OptionalFormSection>
      )}
      <details className="transaction-optional" open={Boolean(initial) || isCreditPurchase || undefined}><summary>Waktu & catatan <span>opsional</span></summary>
        <div className="field-grid"><label className="field"><span>Waktu</span><input required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
          <label className="field"><span>Catatan</span><textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Tambahkan keterangan bila perlu" /></label></div>
      </details>
      {error && <p className="finance-error" role="alert">{error}</p>}
      <div className="finance-actions"><button type="button" className="finance-secondary" onClick={() => dialog.current?.close()} disabled={pending}>Batal</button>
        <button type="submit" className="button-primary" disabled={pending || !active.length} aria-busy={pending}>{pending ? <LoadingIndicator>{initial ? "Memperbarui…" : "Menyimpan…"}</LoadingIndicator> : initial ? "Simpan koreksi" : "Simpan transaksi"}</button></div>
    </fieldset></form>}
  </dialog>;
}
