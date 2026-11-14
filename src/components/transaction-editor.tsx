"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { OptionalChargesEditor, type ChargeEditorRow } from "./optional-charges-editor";
import { OptionalFormSection } from "./optional-form-section";
import { InlineCatalogSelect } from "./inline-catalog-select";
import { financeRequest, requestJson } from "@/lib/finance/client";
import { FinanceOptionsStatus, invalidateFinanceOptions, useFinanceDialog, useFinanceOptions } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { ICON_SM } from "./icon-size";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import { editableInstallmentCharges, installmentEditDefaults, installmentPurchaseRequest, installmentTopUpRequest } from "@/lib/domain/credit-purchase";
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
import { buildEditorDraft, pickTransferSource, type TransactionPreset } from "@/lib/domain/transaction-preset";
import type { ActivityDraft, AdjustmentReason, AnyActivityKind, FinanceActivity, FinanceAsset } from "@/lib/finance/types";

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

export function TransactionEditor({ onClose, initial, preset }: { onClose: () => void; initial?: FinanceActivity; preset?: TransactionPreset }) {
  const { refresh, notify } = useFinanceFeedback();
  const dialog = useFinanceDialog(onClose);
  const replay = useRef<{ payload: string; key: string; reminderKey: string } | null>(null);
  // Kunci tetap per payload untuk split bill multi-teman (satu kunci per teman) dan piutang yang dibuat pada sesi ini.
  const multiSplitReplay = useRef<{ payload: string; keys: string[] } | null>(null);
  const createdReceivables = useRef(new Map<string, string>());
  const receivableRequests = useRef(new Map<string, { key: string; at: string }>());
  // A retried split bill must reuse its keys and receivable account, or a retry after a partial failure
  // would post the personal share twice or create a second receivable account.
  const splitReplay = useRef<{ payload: string; key: string; personalKey: string; transferKey: string; receivableId?: string } | null>(null);
  const { options, optionsError, retry, reload } = useFinanceOptions();
  const [error, setError] = useState("");
  // Steps: 1 jenis, 2 akun & nominal, 3 opsi lanjutan. All field state lives here, so switching steps loses nothing.
  // A correction or a preset kind (Catat per jenis, Bayar tagihan) starts at step 2.
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(initial || preset?.kind ? 2 : 1);
  function goTo(next: 1 | 2 | 3) {
    const target = step === 1 && next === 3 ? 2 : next;
    // Moving on from step 2 needs its required fields (amount, accounts); moving back never does.
    if (step === 2 && target === 3 && formRef.current && !formRef.current.reportValidity()) return;
    setStep(target);
  }
  const { pending, begin, finish } = useMutationPending();
  const [kind, setKind] = useState<AnyActivityKind>(initial?.kind ?? preset?.kind ?? "expense");
  const [amount, setAmount] = useState(initial ? minorToInput(initial.baseAmountMinor, initial.exponent) : preset?.amount ?? "");
  const [accountId, setAccountId] = useState(initial?.sourceAssetId ?? initial?.destinationAssetId ?? preset?.accountId ?? "");
  const [destinationId, setDestinationId] = useState(initial?.destinationAssetId ?? preset?.destinationId ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [occurredAt, setOccurredAt] = useState(localDate(initial?.occurredAt));
  const [note, setNote] = useState(initial?.note ?? preset?.note ?? "");
  const [refundOfActivityId, setRefundOfActivityId] = useState(initial?.refundOfActivityId ?? preset?.refundOfActivityId ?? "");
  const [adjustmentReason, setAdjustmentReason] = useState<AdjustmentReason>(initial?.adjustmentReason ?? "reconciliation");
  const [adjustmentDirection, setAdjustmentDirection] = useState<"increase" | "decrease">(
    initial?.kind === "adjustment" && initial.sourceAssetId ? "decrease" : "increase",
  );
  const [repayInterest, setRepayInterest] = useState(
    initial?.kind === "repay" && initial.charges[0] ? minorToInput(initial.charges[0].amountMinor, initial.exponent) : "",
  );
  const [refundExpenses, setRefundExpenses] = useState<FinanceActivity[]>([]);
  const [refundExpensesLoading, setRefundExpensesLoading] = useState(false);

  // Correcting an installment purchase or top-up starts from its stored tenor and monthly interest.
  const initialInstallment = initial?.kind === "expense" || initial?.kind === "transfer" ? installmentEditDefaults(initial.creditInstallments) : initial?.creditInstallments ? installmentEditDefaults(initial.creditInstallments) : null;
  // The fee of a stored top-up holds the interest of every month; only the rest is the owner's own transfer fee.
  const storedTopUpInterest = initialInstallment && initial?.kind === "transfer" ? BigInt(initialInstallment.interestFlatMinor) * BigInt(initialInstallment.tenorMonths) : 0n;
  const storedOwnFee = initial?.kind === "transfer" && initial.charges[0] ? BigInt(initial.charges[0].amountMinor) - storedTopUpInterest : 0n;
  const [tenorMonths, setTenorMonths] = useState<number>(initialInstallment?.tenorMonths ?? 1);
  const [interestMode, setInterestMode] = useState<"percent" | "flat_minor">(initialInstallment?.interestMode ?? "percent");
  const [interestValue, setInterestValue] = useState<string>(
    initialInstallment && initial ? minorToInput(initialInstallment.interestFlatMinor, initial.exponent) : "");
  const [cycleOverride, setCycleOverride] = useState<"auto" | "current" | "next">("auto");
  const [charges, setCharges] = useState<ChargeEditorRow[]>(
    initial?.kind === "expense" ? (initialInstallment ? editableInstallmentCharges(initial.charges) : initial.charges).map((charge) => ({
      id: charge.id, typeId: charge.typeId, amount: minorToInput(charge.amountMinor, initial.exponent),
    })) : []);
  const [fee, setFee] = useState(initial?.kind === "transfer" && storedOwnFee > 0n ? minorToInput(storedOwnFee.toString(), initial.exponent) : "");
  const [chargesEnabled, setChargesEnabled] = useState(initial?.kind === "expense"
    && (initialInstallment ? editableInstallmentCharges(initial.charges) : initial.charges).length > 0);
  const [feeEnabled, setFeeEnabled] = useState(initial?.kind === "transfer" && storedOwnFee > 0n);
  const [feeMode, setFeeMode] = useState<"addon" | "deducted" | "both">("addon");
  const [deductedFee, setDeductedFee] = useState("");

  const [splitEnabled, setSplitEnabled] = useState(false);
  type SplitFriendRow = { id: string; name: string; amount: string };
  const [splitFriends, setSplitFriends] = useState<SplitFriendRow[]>([
    { id: "f-1", name: "", amount: "" },
  ]);
  const [splitMode, setSplitMode] = useState<"custom" | "equal">("custom");

  const active = options?.assets ?? [];
  const requiresLiabilityPrimary = kind === "borrow" || (kind === "adjustment" && adjustmentReason === "opening_debt");
  const primaryPool = requiresLiabilityPrimary
    ? active.filter((item) => item.assetClass === "liability")
    : kind === "repay"
      ? active.filter((item) => item.assetClass !== "liability")
      : active;
  const effectivePrimaryPool = primaryPool.length ? primaryPool : active;
  // A transfer preset names only the destination (a credit account to pay): the source defaults to a spendable account, not to that credit account.
  const account = (accountId ? effectivePrimaryPool.find((item) => item.id === accountId) : undefined)
    ?? ((kind === "transfer" || kind === "repay") && destinationId ? pickTransferSource(active, destinationId) : undefined)
    ?? effectivePrimaryPool[0];
  const currency = account?.currency ?? "IDR";
  const exponent = account?.exponent ?? 0;
  const rawDestinationOptions = active.filter((item) => item.id !== account?.id && item.currency === currency);
  const destinationOptions = kind === "repay"
    ? rawDestinationOptions.filter((item) => item.assetClass === "liability")
    : kind === "borrow"
      ? rawDestinationOptions.filter((item) => item.assetClass !== "liability")
      : rawDestinationOptions;
  const effectiveDestinationOptions = destinationOptions.length ? destinationOptions : rawDestinationOptions;
  const destination = (destinationId ? effectiveDestinationOptions.find((item) => item.id === destinationId) : undefined)
    ?? (kind === "transfer" && account && isReceivableAsset(account) ? pickTransferSource(active, account.id) : undefined)
    ?? effectiveDestinationOptions[0];
  const categories =
    options?.catalogs.transactionCategories.filter(
      (item) => item.appliesTo === kind && (!isDedicatedCategory(item) || item.id === initial?.categoryId),
    ) ?? [];
  const chargeTypes = options?.catalogs.chargeTypes.filter((item) => item.systemKey !== "transfer_fee") ?? [];

  useEffect(() => {
    if (kind !== "refund") return;
    let activeRequest = true;
    setRefundExpensesLoading(true);
    requestJson<{ items: FinanceActivity[] }>("/api/finance/activities?kind=expense", { cache: "no-store" })
      .catch(() => null)
      .then((activitiesPage) => {
        if (!activeRequest) return;
        const list = (activitiesPage?.items ?? []).filter(
          (item) =>
            item.currency === currency &&
            (item.id === initial?.refundOfActivityId ||
              item.id === preset?.refundOfActivityId ||
              BigInt(item.netMinor ?? item.baseAmountMinor) > 0n),
        );
        setRefundExpenses(list);
        setRefundOfActivityId((prev) => (prev && list.some((item) => item.id === prev) ? prev : list[0]?.id ?? ""));
        setRefundExpensesLoading(false);
      });
    return () => { activeRequest = false; };
  }, [kind, currency, initial?.refundOfActivityId, preset?.refundOfActivityId]);

  const selectedRefundOrigin = refundExpenses.find((item) => item.id === refundOfActivityId);

  const isDebtScheduleApplicable =
    kind === "borrow" || (kind === "adjustment" && adjustmentReason === "opening_debt");
  const isCreditPurchase =
    (!initial || Boolean(initialInstallment)) &&
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
  if ((isCreditPurchase || (isDebtScheduleApplicable && tenorMonths > 1)) && amount.trim()) {
    try {
      const principalMinorStr = inputToMinor(amount, exponent);
      const parsedPercent =
        !isDebtScheduleApplicable && interestMode === "percent" && interestValue.trim()
          ? Number(interestValue.trim().replace(",", "."))
          : 0;
      const parsedFlatMinor =
        !isDebtScheduleApplicable && interestMode === "flat_minor" && interestValue.trim()
          ? inputToMinor(interestValue.trim(), exponent)
          : "0";
      creditPlan = calculateCreditInstallmentPlan({
        principalMinorStr,
        tenorMonths,
        interestMode: isDebtScheduleApplicable ? "flat_minor" : interestMode,
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

  function applyEqualSplit(baseAmount: string, friends: SplitFriendRow[]) {
    if (!baseAmount.trim()) return friends;
    try {
      const totalMinor = BigInt(inputToMinor(baseAmount.trim(), exponent));
      const count = 1 + friends.length;
      const shareMinor = totalMinor / BigInt(count);
      const shareInput = minorToInput(shareMinor.toString(), exponent);
      return friends.map((f) => ({ ...f, amount: shareInput }));
    } catch {
      return friends;
    }
  }

  async function getOrCreateReceivable(friendName: string) {
    const trimmed = friendName.trim();
    if (!trimmed) return undefined;
    const wanted = trimmed.toLowerCase();
    const targetTitle = `piutang · ${wanted}`;
    // Cocok persis (judul "Piutang · Nama" atau nama saja): "Budi" tidak boleh jatuh ke "Piutang · Budiman".
    const existing = (options?.assets ?? []).find(
      (a) =>
        a.isActive &&
        a.assetClass === "receivable" &&
        a.currency === currency &&
        [targetTitle, wanted].includes(a.displayName.trim().toLowerCase())
    );
    if (existing) return existing.id;
    const createdHere = createdReceivables.current.get(`${currency}:${wanted}`);
    if (createdHere) return createdHere;
    try {
      const assetTypeId = options?.catalogs.assetTypes[0]?.id;
      if (!assetTypeId) return undefined;
      const requestKey = `${currency}:${wanted}`;
      const request = receivableRequests.current.get(requestKey) ?? { key: crypto.randomUUID(), at: new Date().toISOString() };
      receivableRequests.current.set(requestKey, request);
      const res = await financeRequest<{ id: string }>("asset-create", {
        idempotencyKey: request.key,
        displayName: `Piutang · ${trimmed}`,
        assetTypeId,
        normallyLiquid: false,
        normallySpendable: false,
        assetClass: "receivable",
        currency,
        openingAmountMinor: "0",
        openingEffectiveAt: request.at,
        note: `Talangan split bill untuk ${trimmed}`,
      });
      createdReceivables.current.set(`${currency}:${wanted}`, res.id);
      invalidateFinanceOptions();
      return res.id;
    } catch {
      return undefined;
    }
  }

  let splitBreakdown: {
    totalBayar: string;
    talangan: string;
    porsiPribadi: string;
    perFriends: { name: string; amount: string }[];
    warning?: string;
  } | null = null;
  if (kind === "expense" && splitEnabled && amount.trim()) {
    try {
      const totalBayarBig = BigInt(inputToMinor(amount.trim(), exponent));
      let talanganTotalBig = 0n;
      const perFriends: { name: string; amount: string }[] = [];
      for (const f of splitFriends) {
        if (f.amount.trim()) {
          const m = BigInt(inputToMinor(f.amount.trim(), exponent));
          talanganTotalBig += m;
          perFriends.push({
            name: f.name.trim() || `Teman ${perFriends.length + 1}`,
            amount: formatMinor(m.toString(), currency, exponent),
          });
        }
      }
      if (talanganTotalBig > totalBayarBig) {
        splitBreakdown = {
          totalBayar: formatMinor(totalBayarBig.toString(), currency, exponent),
          talangan: formatMinor(talanganTotalBig.toString(), currency, exponent),
          porsiPribadi: formatMinor("0", currency, exponent),
          perFriends,
          warning: "Perhatian: Total nominal talangan melebihi total nominal pembayaran.",
        };
      } else {
        const porsiPribadiBig = totalBayarBig - talanganTotalBig;
        splitBreakdown = {
          totalBayar: formatMinor(totalBayarBig.toString(), currency, exponent),
          talangan: formatMinor(talanganTotalBig.toString(), currency, exponent),
          porsiPribadi: formatMinor(porsiPribadiBig.toString(), currency, exponent),
          perFriends,
        };
      }
    } catch {
      splitBreakdown = null;
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!begin()) return; setError("");
    try {
      if (!account) throw new Error("Buat aset terlebih dahulu.");
      if ((kind === "transfer" || kind === "borrow" || kind === "repay") && !destination) {
        throw new Error("Pilih dua aset aktif dengan mata uang yang sama.");
      }
      if (requiresLiabilityPrimary && account.assetClass !== "liability") {
        throw new Error("Pilih akun kewajiban (liability) untuk transaksi ini.");
      }
      if (kind === "repay" && destination?.assetClass !== "liability") {
        throw new Error("Pilih akun kewajiban (liability) sebagai tujuan pelunasan.");
      }
      if (kind === "refund" && !refundOfActivityId) {
        throw new Error("Pilih pengeluaran asal yang di-refund.");
      }
      const rawPrincipalMinor = inputToMinor(amount, exponent);
      const parsedPercent =
        !isDebtScheduleApplicable && interestMode === "percent" && interestValue.trim()
          ? Number(interestValue.trim().replace(",", "."))
          : 0;
      const parsedFlatMinor =
        !isDebtScheduleApplicable && interestMode === "flat_minor" && interestValue.trim()
          ? inputToMinor(interestValue.trim(), exponent)
          : "0";

      const hasDebtSchedule = isDebtScheduleApplicable && tenorMonths > 1;
      const plan = isCreditPurchase || hasDebtSchedule
        ? calculateCreditInstallmentPlan({
            principalMinorStr: rawPrincipalMinor,
            tenorMonths,
            interestMode: isDebtScheduleApplicable ? "flat_minor" : interestMode,
            interestRatePercent: parsedPercent,
            interestFlatMinorStr: parsedFlatMinor,
          })
        : null;

      if (splitEnabled && !initial && kind === "expense") {
        const validFriends = splitFriends.filter(
          (f) => f.amount.trim() && BigInt(inputToMinor(f.amount.trim(), exponent)) > 0n
        );
        if (validFriends.length > 0) {
          const splitCharges = (chargesEnabled ? charges : []).map((charge) => ({
            typeId: charge.typeId,
            amountMinor: inputToMinor(charge.amount, exponent),
          }));
          const totalBayarBig = BigInt(rawPrincipalMinor);
          const totalFriendsTalangan = validFriends.reduce(
            (sum, f) => sum + BigInt(inputToMinor(f.amount.trim(), exponent)),
            0n
          );
          if (totalFriendsTalangan > totalBayarBig) {
            throw new Error("Total talangan tidak boleh melebihi jumlah pembayaran.");
          }
          const porsiPribadiBig = totalBayarBig - totalFriendsTalangan;

          // Case 1: Tepat 1 Teman
          if (validFriends.length === 1) {
            const friend = validFriends[0];
            const friendTalanganBig = BigInt(inputToMinor(friend.amount.trim(), exponent));
            const splitPayload = JSON.stringify({
              amount,
              friendName: friend.name,
              friendAmount: friend.amount,
              accountId: account.id,
              categoryId,
              occurredAt,
              note,
              splitCharges,
            });
            if (splitReplay.current?.payload !== splitPayload) {
              splitReplay.current = {
                payload: splitPayload,
                key: crypto.randomUUID(),
                personalKey: crypto.randomUUID(),
                transferKey: crypto.randomUUID(),
              };
            }
            const splitKeys = splitReplay.current;
            const targetReceivableId =
              splitKeys.receivableId ||
              (await getOrCreateReceivable(friend.name)) ||
              undefined;
            const splitResult = await financeRequest<{
              personalActivityId: string | null;
              transferActivityId: string;
              receivableAssetId: string;
              receivableCreated: boolean;
            }>("split-bill", {
              idempotencyKey: splitKeys.key,
              sourceAssetId: account.id,
              totalMinor: rawPrincipalMinor,
              reimbursedMinor: friendTalanganBig.toString(),
              occurredAt: new Date(occurredAt).toISOString(),
              categoryId: categoryId || undefined,
              charges: splitCharges.length ? splitCharges : undefined,
              person: friend.name.trim() || undefined,
              note: note.trim() || undefined,
              receivableAssetId: targetReceivableId,
            });
            splitKeys.receivableId = splitResult.receivableAssetId;

            refresh();
            notify(
              splitResult.receivableCreated
                ? "Transaksi berhasil dicatat (Akun Piutang & Talangan dibuat otomatis)."
                : "Transaksi berhasil dicatat (Porsi talangan dialihkan ke akun Piutang)."
            );
            onClose();
            return;
          }

          // Case 2: Banyak Teman (Multi-Teman)
          const multiPayload = JSON.stringify({
            amount, accountId: account.id, categoryId, occurredAt, note, splitCharges,
            friends: validFriends.map((f) => ({ name: f.name.trim(), amount: f.amount.trim() })),
          });
          if (multiSplitReplay.current?.payload !== multiPayload) {
            multiSplitReplay.current = { payload: multiPayload, keys: validFriends.map(() => crypto.randomUUID()) };
          }
          const friendKeys = multiSplitReplay.current.keys;
          const firstFriend = validFriends[0];
          const firstFriendTalanganBig = BigInt(inputToMinor(firstFriend.amount.trim(), exponent));
          const firstTotalMinor = (porsiPribadiBig + firstFriendTalanganBig).toString();
          const firstReceivableId = await getOrCreateReceivable(firstFriend.name);

          await financeRequest<{
            personalActivityId: string | null;
            transferActivityId: string;
            receivableAssetId: string;
            receivableCreated: boolean;
          }>("split-bill", {
            idempotencyKey: friendKeys[0],
            sourceAssetId: account.id,
            totalMinor: firstTotalMinor,
            reimbursedMinor: firstFriendTalanganBig.toString(),
            occurredAt: new Date(occurredAt).toISOString(),
            categoryId: categoryId || undefined,
            charges: splitCharges.length ? splitCharges : undefined,
            person: firstFriend.name.trim() || undefined,
            note: note.trim() || undefined,
            receivableAssetId: firstReceivableId,
          });

          for (const [friendIndex, otherFriend] of validFriends.slice(1).entries()) {
            const otherTalanganBig = BigInt(inputToMinor(otherFriend.amount.trim(), exponent));
            const otherReceivableId = await getOrCreateReceivable(otherFriend.name);
            await financeRequest<{
              personalActivityId: string | null;
              transferActivityId: string;
              receivableAssetId: string;
              receivableCreated: boolean;
            }>("split-bill", {
              idempotencyKey: friendKeys[friendIndex + 1],
              sourceAssetId: account.id,
              totalMinor: otherTalanganBig.toString(),
              reimbursedMinor: otherTalanganBig.toString(),
              occurredAt: new Date(occurredAt).toISOString(),
              person: otherFriend.name.trim() || undefined,
              note: note.trim() || undefined,
              receivableAssetId: otherReceivableId,
            });
          }

          refresh();
          notify(`Transaksi split bill berhasil dicatat untuk ${validFriends.length} teman.`);
          onClose();
          return;
        }
      }

      let finalAmountMinor = rawPrincipalMinor;
      let finalTransferFeeMinor: string | undefined = undefined;
      // Installment top-up: the destination gets the full principal now and the ledger carries principal plus the
      // interest of every month; the server splits it into one installment row per due month of the credit account.
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

        // Interest of every month is booked now, like an installment purchase; the schedule rows only split the bill.
        const creditInterest = isCreditPurchase && plan ? BigInt(installmentTopUpRequest(plan, tenorMonths).transferFeeMinor) : 0n;
        const totalFee = addonFeeBig + deductedFeeBig + creditInterest;
        if (totalFee > 0n) {
          finalTransferFeeMinor = totalFee.toString();
        }
      }
      // Installment purchase: what is posted now and what the server schedules for the later months.
      const interestChargeTypeId = options?.catalogs.chargeTypes.find((item) => item.systemKey === "installment_interest")?.id;
      const loanInterestChargeTypeId = options?.catalogs.chargeTypes.find((item) => item.systemKey === "loan_interest")?.id;
      const purchase = kind === "expense" && isCreditPurchase && plan && tenorMonths > 1
        ? installmentPurchaseRequest(plan, tenorMonths, interestChargeTypeId)
        : null;
      if (kind === "expense") finalAmountMinor = purchase ? purchase.amountMinor : plan ? plan.firstMonthTotalMinor : rawPrincipalMinor;

      const postedAmountMinor = finalAmountMinor;

      const effectiveNote =
        isCreditPurchase && tenorMonths > 1
          ? isInstallmentTopUp
            ? `${note.trim() || account.displayName} (Dicicil ${tenorMonths}x · tagihan 1/${tenorMonths})`
            : `${note.trim() || account.displayName} (Dicicil ${tenorMonths}x)`
          : note;

      const repayInterestMinor =
        kind === "repay" && repayInterest.trim() ? inputToMinor(repayInterest.trim(), exponent) : "0";
      const expenseCharges =
        kind === "expense"
          ? [
              ...(chargesEnabled ? (purchase ? editableInstallmentCharges(charges, interestChargeTypeId) : charges) : []).map((charge) => ({
                typeId: charge.typeId,
                amountMinor: inputToMinor(charge.amount, exponent),
              })),
              ...(purchase?.charges ?? []),
            ]
          : undefined;

      const draft: ActivityDraft = buildEditorDraft({
        kind,
        amountMinor: postedAmountMinor,
        occurredAt: new Date(occurredAt).toISOString(),
        note: effectiveNote,
        primaryAssetId: account.id,
        destinationAssetId: destination?.id,
        categoryId: categoryId || undefined,
        transferFeeMinor: finalTransferFeeMinor,
        expenseCharges,
        repayInterestMinor,
        loanInterestChargeTypeId,
        refundOfActivityId,
        adjustmentReason,
        adjustmentDirection,
      });
      const payload = JSON.stringify({ id: initial?.id, draft, tenorMonths: isCreditPurchase || hasDebtSchedule ? tenorMonths : 1, targetCycle });
      if (replay.current?.payload !== payload) replay.current = { payload, key: crypto.randomUUID(), reminderKey: crypto.randomUUID() };
      // The server assigns a credit outflow to the next billing cycle in the same database transaction as
      // the posting, using the authoritative ledger impact and the freshly locked account note.
      await financeRequest(initial ? "replace" : "post", {
        id: initial?.id,
        draft,
        idempotencyKey: replay.current.key,
        // The effective cycle (automatic or manual override) is stored with the activity so a later void or
        // correction releases exactly what this posting deferred.
        ...(isCreditPurchase || hasDebtSchedule ? { creditCycle: targetCycle } : {}),
        ...(purchase
          ? { creditInstallments: purchase.creditInstallments }
          : (isCreditPurchase || hasDebtSchedule) && plan && tenorMonths > 1
            ? {
                creditInstallments: {
                  count: tenorMonths,
                  principalMinor: plan.monthlyPrincipalMinor,
                  interestMinor: isDebtScheduleApplicable ? "0" : plan.monthlyInterestMinor,
                },
              }
            : {}),
      });

      // Reminders were created with the original purchase; a correction does not add a second set.
      if (!initial && isCreditPurchase && plan && plan.futureInstallmentsMinor.length > 0) {
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
            idempotencyKey: replay.current.reminderKey,
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


  const stepTitles = ["Jenis", "Akun & nominal", "Opsi lanjutan"] as const;
  const kindLabels: Record<AnyActivityKind, string> = {
    expense: "Pengeluaran",
    income: "Pemasukan",
    transfer: "Transfer",
    borrow: "Pinjam",
    repay: "Lunas",
    refund: "Refund",
    adjustment: "Koreksi",
  };
  const kindLabel = kind === "expense" && splitEnabled ? "Pengeluaran (Split Bill / Talangan)" : kindLabels[kind];
  return <dialog ref={dialog} className="finance-dialog transaction-dialog" aria-labelledby="transaction-editor-title"
    onCancel={(event) => { if (pending) event.preventDefault(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">CATAT PERGERAKAN</span><h2 id="transaction-editor-title">{initial ? "Koreksi transaksi" : "Transaksi baru"}</h2></div>
      <button className="icon-button" type="button" onClick={() => dialog.current?.close()} aria-label="Tutup" disabled={pending}><X size={ICON_SM} /></button></div>
    {initial && <p className="finance-hint">Koreksi membalik catatan lama dan menyimpan penggantinya. Riwayat lama tetap tersedia.</p>}
    {!options ? <FinanceOptionsStatus error={optionsError} retry={retry} /> : <form ref={formRef} onSubmit={save} aria-busy={pending}><fieldset className="finance-fieldset" disabled={pending}>
      <ol className="transaction-steps" aria-label="Langkah pencatatan">
        {stepTitles.map((title, index) => <li key={title}><button type="button" className="transaction-step" data-state={step === index + 1 ? "current" : step > index + 1 ? "done" : "todo"}
          aria-current={step === index + 1 ? "step" : undefined} onClick={() => goTo((index + 1) as 1 | 2 | 3)}><span aria-hidden="true">{index + 1}</span>{title}</button></li>)}
      </ol>
      {!active.length && <p className="finance-hint">Buat aset di halaman Assets sebelum mencatat transaksi.</p>}

      {step === 1 && <>
      <div className="field"><span>Jenis transaksi</span><div className="segmented" role="group" aria-label="Jenis transaksi">
        {(["expense", "income", "transfer", "borrow", "repay", "refund", "adjustment"] as const).map((item) => (
          <button
            type="button"
            key={item}
            className={kind === item && !(item === "expense" && splitEnabled) ? "selected" : ""}
            onClick={() => {
              setKind(item);
              setSplitEnabled(false);
              setCategoryId("");
              goTo(2);
            }}
          >
            {kindLabels[item]}
          </button>
        ))}
        <button
          type="button"
          className={kind === "expense" && splitEnabled ? "selected" : ""}
          onClick={() => {
            setKind("expense");
            setSplitEnabled(true);
            setCategoryId("");
            goTo(2);
          }}
        >
          Split Bill
        </button>
      </div></div>
      </>}
      {step === 2 && <>
        <p className="transaction-kind-summary"><span>Jenis</span><strong>{kindLabel}</strong><button type="button" className="text-link" onClick={() => goTo(1)}>Ubah</button></p>
      {kind === "adjustment" && (
        <div className="field-grid">
          <label className="field">
            <span>Alasan koreksi</span>
            <select
              value={adjustmentReason}
              onChange={(event) => setAdjustmentReason(event.target.value as AdjustmentReason)}
            >
              <option value="reconciliation">Rekonsiliasi saldo</option>
              <option value="opening_debt">Saldo awal utang / kewajiban</option>
            </select>
          </label>
          {adjustmentReason === "reconciliation" && (
            <label className="field">
              <span>Arah koreksi</span>
              <select
                value={adjustmentDirection}
                onChange={(event) => setAdjustmentDirection(event.target.value as "increase" | "decrease")}
              >
                <option value="increase">Tambah saldo (masuk ke aset)</option>
                <option value="decrease">Kurangi saldo (keluar dari aset)</option>
              </select>
            </label>
          )}
        </div>
      )}
      <label className="field transaction-amount-field"><span>{isCreditPurchase ? `Harga pokok transaksi (${currency})` : `Jumlah (${currency})`}</span><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></label>
      <label className="field"><span>{kind === "income" ? "Aset penerima" : kind === "refund" ? "Aset penerima refund" : kind === "borrow" || (kind === "adjustment" && adjustmentReason === "opening_debt") ? "Akun kewajiban (sumber utang)" : "Aset sumber"}</span><select required value={account?.id ?? ""}
        onChange={(event) => setAccountId(event.target.value)}><option value="">Pilih aset aktif</option>{effectivePrimaryPool.map((item) => <option key={item.id} value={item.id}>{formatAssetOptionLabel(item)}</option>)}</select></label>
      {requiresLiabilityPrimary && primaryPool.length === 0 && (
        <small className="finance-hint">Belum ada akun dengan kelas Kewajiban (liability). Buat atau pilih akun kewajiban terlebih dahulu.</small>
      )}
      {kind === "refund" && (
        <label className="field">
          <span>Pengeluaran asal yang di-refund</span>
          <select
            required
            value={refundOfActivityId}
            onChange={(event) => setRefundOfActivityId(event.target.value)}
            disabled={refundExpensesLoading}
          >
            <option value="">{refundExpensesLoading ? "Memuat daftar pengeluaran…" : "Pilih pengeluaran asal"}</option>
            {refundExpenses.map((item) => (
              <option key={item.id} value={item.id}>
                {(item.note || item.categoryName || "Pengeluaran")} · {item.sourceName} · Sisa {formatMinor(item.netMinor ?? item.baseAmountMinor, item.currency, item.exponent)}
              </option>
            ))}
          </select>
          {selectedRefundOrigin && (
            <small className="finance-hint">
              Sudah di-refund: <strong>{formatMinor(selectedRefundOrigin.refundedMinor ?? "0", selectedRefundOrigin.currency, selectedRefundOrigin.exponent)}</strong>
              {" · "}Sisa dapat di-refund: <strong>{formatMinor(selectedRefundOrigin.netMinor ?? selectedRefundOrigin.baseAmountMinor, selectedRefundOrigin.currency, selectedRefundOrigin.exponent)}</strong>
            </small>
          )}
        </label>
      )}

      {(isCreditPurchase || isDebtScheduleApplicable) && (
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

          {!isDebtScheduleApplicable && (
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
          )}

          {creditPlan && (
            <small className="finance-hint">
              {tenorMonths === 1 ? (
                <span>
                  Total tagihan: <strong>{formatMinor(creditPlan.firstMonthTotalMinor, currency, exponent)}</strong>{" "}
                  (pokok {formatMinor(creditPlan.monthlyPrincipalMinor, currency, exponent)} + bunga/biaya {formatMinor(creditPlan.monthlyInterestMinor, currency, exponent)}) → Masuk ke tagihan jatuh tempo <strong>{targetCycle === "next" ? nextDueShort : currentDueShort}</strong>.
                </span>
              ) : (
                <span>
                  Cicilan per bulan: <strong>{formatMinor(creditPlan.firstMonthTotalMinor, currency, exponent)}</strong>{" "}
                  (pokok {formatMinor(creditPlan.monthlyPrincipalMinor, currency, exponent)} + bunga {formatMinor(creditPlan.monthlyInterestMinor, currency, exponent)} / bln · Total {tenorMonths}x = {formatMinor(creditPlan.grandTotalMinor, currency, exponent)}). Cicilan 1/{tenorMonths} masuk ke tagihan <strong>{targetCycle === "next" ? nextDueShort : currentDueShort}</strong>.
                </span>
              )}
            </small>
          )}
        </div>
      )}

      {(kind === "transfer" || kind === "borrow" || kind === "repay") && (
        <label className="field">
          <span>{kind === "repay" ? "Aset tujuan (akun kewajiban)" : kind === "borrow" ? "Aset tujuan (penerima dana)" : "Aset tujuan"}</span>
          <select
            required
            value={destination?.id ?? ""}
            onChange={(event) => setDestinationId(event.target.value)}
          >
            <option value="">Pilih aset tujuan</option>
            {effectiveDestinationOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {formatAssetOptionLabel(item)}
              </option>
            ))}
          </select>
        </label>
      )}

      {kind === "expense" && splitEnabled && (
        <div className="split-bill-box">
          <div className="split-bill-header">
            <span style={{ fontWeight: "var(--weight-semibold)", fontSize: "var(--text-sm)", color: "var(--ink)" }}>
              Split Bill / Talangan Teman
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <div className="split-mode-toggle" role="group" aria-label="Mode pembagian talangan">
                <button
                  type="button"
                  className={`split-mode-btn ${splitMode === "custom" ? "active" : ""}`}
                  onClick={() => setSplitMode("custom")}
                >
                  Per Orang
                </button>
                <button
                  type="button"
                  className={`split-mode-btn ${splitMode === "equal" ? "active" : ""}`}
                  onClick={() => {
                    setSplitMode("equal");
                    setSplitFriends(applyEqualSplit(amount, splitFriends));
                  }}
                >
                  Bagi Rata
                </button>
              </div>
              <button
                type="button"
                className="text-link"
                style={{ fontSize: "var(--text-xs)" }}
                onClick={() => {
                  setSplitEnabled(false);
                  setSplitFriends([{ id: "f-1", name: "", amount: "" }]);
                }}
              >
                Batalkan
              </button>
            </div>
          </div>

          <div className="split-friends-list">
            {splitFriends.map((friend, idx) => (
              <div className="split-friend-row" key={friend.id}>
                <input
                  type="text"
                  placeholder={`Nama teman (mis. Teman ${idx + 1})`}
                  value={friend.name}
                  onChange={(e) => {
                    const newFriends = splitFriends.map((f) =>
                      f.id === friend.id ? { ...f, name: e.target.value } : f
                    );
                    setSplitFriends(newFriends);
                  }}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={`Nominal (${currency})`}
                  required
                  value={friend.amount}
                  onChange={(e) => {
                    if (splitMode === "equal") setSplitMode("custom");
                    const newFriends = splitFriends.map((f) =>
                      f.id === friend.id ? { ...f, amount: e.target.value } : f
                    );
                    setSplitFriends(newFriends);
                  }}
                />
                {splitFriends.length > 1 && (
                  <button
                    type="button"
                    className="split-friend-remove"
                    title="Hapus teman"
                    aria-label={`Hapus ${friend.name || `Teman ${idx + 1}`}`}
                    onClick={() => {
                      const newFriends = splitFriends.filter((f) => f.id !== friend.id);
                      setSplitFriends(splitMode === "equal" ? applyEqualSplit(amount, newFriends) : newFriends);
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="split-add-friend-btn"
            onClick={() => {
              const newFriends = [
                ...splitFriends,
                { id: `f-${Date.now()}-${splitFriends.length}`, name: "", amount: "" },
              ];
              setSplitFriends(splitMode === "equal" ? applyEqualSplit(amount, newFriends) : newFriends);
            }}
          >
            <Plus size={14} /> + Tambah teman
          </button>

          {splitBreakdown && (
            <div className="finance-hint" style={{ display: "grid", gap: "var(--space-1)", fontSize: "var(--text-xs)" }}>
              {splitBreakdown.warning ? (
                <span className="finance-error">{splitBreakdown.warning}</span>
              ) : (
                <div style={{ display: "grid", gap: "var(--space-1)" }}>
                  <div>• <strong>Total keluar dari rekening:</strong> {splitBreakdown.totalBayar}</div>
                  <div>• <strong>Masuk ke daftar talangan:</strong> {splitBreakdown.talangan}</div>
                  <div>• <strong>Pengeluaran murni pribadi Anda:</strong> {splitBreakdown.porsiPribadi}</div>
                  {splitBreakdown.perFriends.length > 1 && (
                    <div style={{ color: "var(--muted)", marginTop: "2px" }}>
                      Rincian: {splitBreakdown.perFriends.map((pf) => `${pf.name}: ${pf.amount}`).join(" · ")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(kind === "expense" || kind === "income") ? (
        <div className="field-grid">
          <InlineCatalogSelect
            label="Kategori (opsional)"
            catalog="transactionCategories"
            appliesTo={kind}
            value={categoryId}
            emptyLabel="Tanpa kategori"
            items={categories}
            onCreated={() => void reload()}
            onChange={setCategoryId}
          />
          <label className="field">
            <span>Catatan (opsional)</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Tambahkan keterangan bila perlu"
              maxLength={1000}
            />
          </label>
        </div>
      ) : (
        <label className="field">
          <span>Catatan (opsional)</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Tambahkan keterangan bila perlu"
            maxLength={1000}
          />
        </label>
      )}
      </>}
      {step === 3 && <>
        {kind === "transfer" && (
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
        )}
      {kind === "expense" && <OptionalChargesEditor enabled={chargesEnabled} onEnabledChange={setChargesEnabled}
        rows={charges} onChange={setCharges} chargeTypes={chargeTypes} maxRows={20} onChargeTypeCreated={() => void reload()} />}
      {kind === "repay" && (
        <label className="field">
          <span>Bunga pinjaman ({currency}, opsional)</span>
          <input
            inputMode="decimal"
            value={repayInterest}
            onChange={(event) => setRepayInterest(event.target.value)}
            placeholder="0"
          />
          <small className="finance-hint">Pokok mengurangi saldo utang; bunga pinjaman tercatat sebagai beban biaya.</small>
        </label>
      )}
      {!initial && kind === "expense" && !isCreditPurchase && (
        <small className="finance-hint">
          Catatan &amp; Split Bill dapat diatur langsung di langkah 2.
        </small>
      )}
      <section className="transaction-step-group" aria-label="Waktu transaksi">
        <label className="field">
          <span>Waktu transaksi</span>
          <input required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
        </label>
      </section>
      </>}
      {error && <p className="finance-error" role="alert">{error}</p>}
      <div className="finance-actions">
        {step === 1 ? (
          <button
            className="finance-secondary"
            type="button"
            onClick={() => dialog.current?.close()}
            disabled={pending}
          >
            Batal
          </button>
        ) : (
          <button
            className="finance-secondary"
            type="button"
            onClick={() => goTo((step - 1) as 1 | 2)}
            disabled={pending}
          >
            Kembali
          </button>
        )}
        {step === 2 && (
          <button
            className="finance-secondary"
            type="button"
            onClick={() => goTo(3)}
            disabled={pending}
          >
            Opsi lanjutan
          </button>
        )}
        {step > 1 && <button type="submit" className="button-primary" disabled={pending || !active.length} aria-busy={pending}>
          {pending ? <LoadingIndicator>{initial ? "Memperbarui..." : "Menyimpan..."}</LoadingIndicator> : "Simpan transaksi"}
        </button>}
      </div>
    </fieldset></form>}
  </dialog>;
}
