"use client";

import { useEffect, useRef, useState } from "react";
import {
  Calculator,
  CreditCard,
  Info,
  Plus,
  Users,
  X,
} from "@phosphor-icons/react";
import { OptionalChargesEditor, type ChargeEditorRow } from "./optional-charges-editor";
import { InlineCatalogSelect } from "./inline-catalog-select";
import { financeRequest, requestJson } from "@/lib/finance/client";
import { FinanceOptionsStatus, useFinanceDialog, useFinanceOptions } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import {
  editableInstallmentCharges,
  installmentEditDefaults,
  installmentPurchaseRequest,
  installmentTopUpRequest,
} from "@/lib/domain/credit-purchase";
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
import { buildEditorDraft, pickTransferSource, type TransactionPreset } from "@/lib/domain/transaction-preset";
import type {
  ActivityDraft,
  AdjustmentReason,
  AnyActivityKind,
  FinanceActivity,
} from "@/lib/finance/types";

export type ModalScenarioTab = "pengeluaran" | "transfer" | "splitbill" | "pemasukan" | "pelunasan";

function localDate(iso?: string) {
  const date = iso ? new Date(iso) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function resolveInitialTab(initial?: FinanceActivity, preset?: TransactionPreset): ModalScenarioTab {
  if (preset?.scenarioTab) return preset.scenarioTab;
  const k = initial?.kind ?? preset?.kind;
  if (!k) return "pengeluaran";
  if (k === "expense") return "pengeluaran";
  if (k === "transfer") return "transfer";
  if (k === "income" || k === "refund") return "pemasukan";
  if (k === "repay" || k === "borrow" || k === "adjustment") return "pelunasan";
  return "pengeluaran";
}

export function TransactionEditor({
  onClose,
  initial,
  preset,
}: {
  onClose: () => void;
  initial?: FinanceActivity;
  preset?: TransactionPreset;
}) {
  const { refresh, notify } = useFinanceFeedback();
  const dialog = useFinanceDialog(onClose);
  const replay = useRef<{ payload: string; key: string } | null>(null);
  const splitReplay = useRef<{
    payload: string;
    key: string;
    personalKey: string;
    transferKey: string;
    receivableId?: string;
  } | null>(null);
  const { options, optionsError, retry } = useFinanceOptions();
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const { pending, begin, finish } = useMutationPending();

  const [activeTab, setActiveTab] = useState<ModalScenarioTab>(resolveInitialTab(initial, preset));
  const [layoutMode, setLayoutMode] = useState<"modal" | "slideover">("modal");

  // Kind mapped from activeTab
  const kind: AnyActivityKind =
    activeTab === "pengeluaran"
      ? "expense"
      : activeTab === "transfer"
      ? "transfer"
      : activeTab === "splitbill"
      ? "expense"
      : activeTab === "pemasukan"
      ? (initial?.kind === "refund" ? "refund" : "income")
      : (initial?.kind ?? preset?.kind ?? "repay");

  const [inflowType, setInflowType] = useState<"active" | "passive" | "refund">(
    initial?.kind === "refund" ? "refund" : "active"
  );
  const [settleSubMode, setSettleSubMode] = useState<"pay_credit" | "receive_friend" | "borrow_adjust">(
    initial?.kind === "borrow" || initial?.kind === "adjustment"
      ? "borrow_adjust"
      : "pay_credit"
  );

  const [amount, setAmount] = useState(
    initial ? minorToInput(initial.baseAmountMinor, initial.exponent) : preset?.amount ?? ""
  );
  const [accountId, setAccountId] = useState(
    initial?.sourceAssetId ?? initial?.destinationAssetId ?? preset?.accountId ?? ""
  );
  const [destinationId, setDestinationId] = useState(
    initial?.destinationAssetId ?? preset?.destinationId ?? ""
  );
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [occurredAt, setOccurredAt] = useState(localDate(initial?.occurredAt));
  const [note, setNote] = useState(initial?.note ?? preset?.note ?? "");
  const [refundOfActivityId, setRefundOfActivityId] = useState(
    initial?.refundOfActivityId ?? preset?.refundOfActivityId ?? ""
  );
  const [adjustmentReason, setAdjustmentReason] = useState<AdjustmentReason>(
    initial?.adjustmentReason ?? "reconciliation"
  );
  const [adjustmentDirection, setAdjustmentDirection] = useState<"increase" | "decrease">(
    initial?.kind === "adjustment" && initial.sourceAssetId ? "decrease" : "increase"
  );
  const [repayInterest, setRepayInterest] = useState(
    initial?.kind === "repay" && initial.charges[0]
      ? minorToInput(initial.charges[0].amountMinor, initial.exponent)
      : ""
  );
  const [refundExpenses, setRefundExpenses] = useState<FinanceActivity[]>([]);
  const [, setRefundExpensesLoading] = useState(false);

  // Installment edit defaults
  const initialInstallment =
    initial?.kind === "expense" || initial?.kind === "transfer" ? installmentEditDefaults(initial.creditInstallments)
      : initial?.creditInstallments
      ? installmentEditDefaults(initial.creditInstallments)
      : null;
  const storedTopUpInterest = initialInstallment && initial?.kind === "transfer" ? BigInt(initialInstallment.interestFlatMinor) * BigInt(initialInstallment.tenorMonths) : 0n;
  const storedOwnFee = initial?.kind === "transfer" && initial.charges[0] ? BigInt(initial.charges[0].amountMinor) - storedTopUpInterest : 0n;

  const [tenorMonths, setTenorMonths] = useState<number>(initialInstallment?.tenorMonths ?? 1);
  const [interestMode, setInterestMode] = useState<"percent" | "flat_minor">(
    initialInstallment?.interestMode ?? "percent"
  );
  const [interestValue, setInterestValue] = useState<string>(
    initialInstallment && initial
      ? minorToInput(initialInstallment.interestFlatMinor, initial.exponent)
      : ""
  );
  const [cycleOverride, setCycleOverride] = useState<"auto" | "current" | "next">("auto");
  const [charges, setCharges] = useState<ChargeEditorRow[]>(
    initial?.kind === "expense"
      ? (initialInstallment ? editableInstallmentCharges(initial.charges) : initial.charges).map(
          (charge) => ({
            id: charge.id,
            typeId: charge.typeId,
            amount: minorToInput(charge.amountMinor, initial.exponent),
          })
        )
      : []
  );
  const [fee, setFee] = useState(
    initial?.kind === "transfer" && storedOwnFee > 0n
      ? minorToInput(storedOwnFee.toString(), initial.exponent)
      : ""
  );
  const [chargesEnabled, setChargesEnabled] = useState(
    initial?.kind === "expense" &&
      (initialInstallment ? editableInstallmentCharges(initial.charges) : initial.charges).length > 0
  );
  const [feeEnabled, setFeeEnabled] = useState(
    (initial?.kind === "transfer" && storedOwnFee > 0n) || true
  );
  const [feeMode, setFeeMode] = useState<"addon" | "deducted" | "both">("addon");
  const [deductedFee, setDeductedFee] = useState("");

  // Split bill states
  const [splitMethod, setSplitMethod] = useState<"equal" | "custom">("equal");
  const [reimburseAmount, setReimburseAmount] = useState("");
  const [reimbursePerson, setReimbursePerson] = useState("");
  const [receivableAssetId, setReceivableAssetId] = useState("");

  // Passive tax withheld
  const [taxWithheld, setTaxWithheld] = useState("");

  const active = options?.assets ?? [];
  const requiresLiabilityPrimary =
    kind === "borrow" || (kind === "adjustment" && adjustmentReason === "opening_debt");
  const primaryPool = requiresLiabilityPrimary
    ? active.filter((item) => item.assetClass === "liability")
    : kind === "repay"
    ? active.filter((item) => item.assetClass !== "liability")
    : active;
  const effectivePrimaryPool = primaryPool.length ? primaryPool : active;

  const account =
    (accountId ? effectivePrimaryPool.find((item) => item.id === accountId) : undefined) ??
    ((kind === "transfer" || kind === "repay") && destinationId
      ? pickTransferSource(active, destinationId)
      : undefined) ??
    effectivePrimaryPool[0];

  const currency = account?.currency ?? "IDR";
  const exponent = account?.exponent ?? 0;

  const rawDestinationOptions = active.filter(
    (item) => item.id !== account?.id && item.currency === currency
  );
  const destinationOptions =
    kind === "repay"
      ? rawDestinationOptions.filter((item) => item.assetClass === "liability")
      : kind === "borrow"
      ? rawDestinationOptions.filter((item) => item.assetClass !== "liability")
      : rawDestinationOptions;
  const effectiveDestinationOptions = destinationOptions.length
    ? destinationOptions
    : rawDestinationOptions;

  const destination =
    (destinationId ? effectiveDestinationOptions.find((item) => item.id === destinationId) : undefined) ??
    (kind === "transfer" && account && isReceivableAsset(account)
      ? pickTransferSource(active, account.id)
      : undefined) ??
    effectiveDestinationOptions[0];

  const categories =
    options?.catalogs.transactionCategories.filter(
      (item) =>
        item.appliesTo === (activeTab === "pemasukan" ? "income" : "expense") &&
        (!isDedicatedCategory(item) || item.id === initial?.categoryId)
    ) ?? [];

  useEffect(() => {
    if (activeTab !== "pemasukan" || inflowType !== "refund") return;
    let activeRequest = true;
    setRefundExpensesLoading(true);
    requestJson<{ items: FinanceActivity[] }>("/api/finance/activities?kind=expense", {
      cache: "no-store",
    })
      .catch(() => null)
      .then((activitiesPage) => {
        if (!activeRequest) return;
        const list = (activitiesPage?.items ?? []).filter(
          (item) =>
            item.currency === currency &&
            (item.id === initial?.refundOfActivityId ||
              item.id === preset?.refundOfActivityId ||
              BigInt(item.netMinor ?? item.baseAmountMinor) > 0n)
        );
        setRefundExpenses(list);
        setRefundOfActivityId((prev) =>
          prev && list.some((item) => item.id === prev) ? prev : list[0]?.id ?? ""
        );
        setRefundExpensesLoading(false);
      });
    return () => {
      activeRequest = false;
    };
  }, [activeTab, inflowType, currency, initial?.refundOfActivityId, preset?.refundOfActivityId]);

  const isDebtScheduleApplicable =
    kind === "borrow" || (kind === "adjustment" && adjustmentReason === "opening_debt");
  const isCreditPurchase =
    (!initial || Boolean(initialInstallment)) &&
    (kind === "expense" ||
      (kind === "transfer" && Boolean(destination && !isCreditAsset(destination)))) &&
    Boolean(account && isCreditAsset(account));
  const creditMeta = parseCreditMeta(account?.note);
  const dueDay = creditMeta.dueDay;
  const cutoffDay = creditMeta.cutoffDay;

  const autoAfterCutoff = isAfterCutoffDay(new Date(occurredAt).toISOString(), cutoffDay, dueDay);
  const targetCycle: "current" | "next" =
    cycleOverride === "auto" ? (autoAfterCutoff ? "next" : "current") : cycleOverride;

  const currentDueShort = formatShortDueIso(nextMonthlyDueDayIso(dueDay, 0));
  const nextDueShort = formatShortDueIso(nextMonthlyDueDayIso(dueDay, 1));

  // Installment plan calculation
  let creditPlan: ReturnType<typeof calculateCreditInstallmentPlan> | null = null;
  if ((isCreditPurchase || isDebtScheduleApplicable) && amount.trim()) {
    try {
      const parsedPercent =
        !isDebtScheduleApplicable && interestMode === "percent" && interestValue.trim()
          ? Number(interestValue.trim().replace(",", "."))
          : 0;
      const parsedFlatMinor =
        !isDebtScheduleApplicable && interestMode === "flat_minor" && interestValue.trim()
          ? inputToMinor(interestValue.trim(), exponent)
          : "0";
      creditPlan = calculateCreditInstallmentPlan({
        principalMinorStr: inputToMinor(amount.trim(), exponent),
        tenorMonths,
        interestMode: isDebtScheduleApplicable ? "flat_minor" : interestMode,
        interestRatePercent: parsedPercent,
        interestFlatMinorStr: parsedFlatMinor,
      });
    } catch {
      creditPlan = null;
    }
  }

  // Live previews
  const numPrincipalMinor = amount.trim() ? inputToMinor(amount.trim(), exponent) : "0";
  const numPrincipalBig = BigInt(numPrincipalMinor);

  // Tab 1 (Expense) Live Preview
  const totalExtraChargesBig = chargesEnabled
    ? charges.reduce((sum, c) => sum + (c.amount.trim() ? BigInt(inputToMinor(c.amount.trim(), exponent)) : 0n), 0n)
    : 0n;
  const creditInterestBig = creditPlan && BigInt(creditPlan.grandTotalMinor) > numPrincipalBig
    ? BigInt(creditPlan.grandTotalMinor) - numPrincipalBig
    : 0n;
  const totalExpMutationBig = numPrincipalBig + totalExtraChargesBig + creditInterestBig;

  // Tab 2 (Transfer) Live Preview
  const addonFeeBig =
    (feeMode === "addon" || feeMode === "both") && feeEnabled && fee.trim()
      ? BigInt(inputToMinor(fee.trim(), exponent))
      : 0n;
  const deductedFeeBig =
    feeEnabled
      ? feeMode === "deducted"
        ? fee.trim()
          ? BigInt(inputToMinor(fee.trim(), exponent))
          : 0n
        : feeMode === "both"
        ? deductedFee.trim()
          ? BigInt(inputToMinor(deductedFee.trim(), exponent))
          : 0n
        : 0n
      : 0n;
  const transferPaylaterFeeBig =
    isCreditPurchase && creditPlan
      ? BigInt(installmentTopUpRequest(creditPlan, tenorMonths).transferFeeMinor)
      : 0n;
  const totalBurnedFeeBig = addonFeeBig + deductedFeeBig + transferPaylaterFeeBig;
  const trfSourceOutBig = numPrincipalBig + addonFeeBig + transferPaylaterFeeBig;
  const trfTargetInBig = numPrincipalBig > deductedFeeBig ? numPrincipalBig - deductedFeeBig : 0n;

  // Tab 3 (Split Bill) Live Preview
  const talanganBig = reimburseAmount.trim() ? BigInt(inputToMinor(reimburseAmount.trim(), exponent)) : 0n;
  const porsiPribadiBig = numPrincipalBig > talanganBig ? numPrincipalBig - talanganBig : 0n;

  // Tab 4 (Income / Passive) Live Preview
  const taxWithheldBig = taxWithheld.trim() ? BigInt(inputToMinor(taxWithheld.trim(), exponent)) : 0n;
  const netInflowBig = numPrincipalBig > taxWithheldBig ? numPrincipalBig - taxWithheldBig : numPrincipalBig;

  // Handle equal split calculation
  const handleEqualSplit = (totalStr: string) => {
    if (!totalStr.trim()) return;
    try {
      const tot = BigInt(inputToMinor(totalStr.trim(), exponent));
      const half = tot / 2n;
      setReimburseAmount(minorToInput(half.toString(), exponent));
    } catch {
      // ignore parse errors
    }
  };

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!begin()) return;
    setError("");

    try {
      if (!account) throw new Error("Pilih akun terlebih dahulu.");

      // Tab 3: Split Bill submission
      if (activeTab === "splitbill") {
        if (!amount.trim()) throw new Error("Isi total bayar di struk.");
        if (!reimburseAmount.trim()) throw new Error("Isi nominal talangan teman.");
        const rawPrincipalMinor = inputToMinor(amount, exponent);
        const splitCharges = (chargesEnabled ? charges : []).map((charge) => ({
          typeId: charge.typeId,
          amountMinor: inputToMinor(charge.amount, exponent),
        }));
        const split = planSplitBill({
          totalMinor: BigInt(rawPrincipalMinor),
          reimbursedMinor: BigInt(inputToMinor(reimburseAmount.trim(), exponent)),
          chargesMinor: splitCharges.reduce((sum, charge) => sum + BigInt(charge.amountMinor), 0n),
        });

        const splitPayload = JSON.stringify({
          amount,
          reimburseAmount,
          reimbursePerson,
          receivableAssetId,
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
        const splitResult = await financeRequest<{
          personalActivityId: string | null;
          transferActivityId: string;
          receivableAssetId: string;
          receivableCreated: boolean;
        }>("split-bill", {
          idempotencyKey: splitKeys.key,
          sourceAssetId: account.id,
          totalMinor: rawPrincipalMinor,
          reimbursedMinor: split.reimbursedMinor.toString(),
          occurredAt: new Date(occurredAt).toISOString(),
          categoryId: categoryId || undefined,
          charges: splitCharges.length ? splitCharges : undefined,
          person: reimbursePerson.trim() || undefined,
          note: note.trim() || undefined,
          receivableAssetId: receivableAssetId || splitKeys.receivableId || undefined,
        });
        splitKeys.receivableId = splitResult.receivableAssetId;

        refresh();
        notify(
          splitResult.receivableCreated
            ? "Transaksi berhasil dicatat (Akun Piutang dibuat otomatis)."
            : "Transaksi berhasil dicatat (Porsi talangan dialihkan ke akun Piutang)."
        );
        onClose();
        return;
      }

      // Standard submission
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
      const hasDebtSchedule = isDebtScheduleApplicable && tenorMonths > 1;
      const plan = creditPlan;

      let finalAmountMinor = rawPrincipalMinor;
      let finalTransferFeeMinor: string | undefined = undefined;

      const isInstallmentTopUp = kind === "transfer" && isCreditPurchase && Boolean(plan) && tenorMonths > 1;

      if (kind === "transfer") {
        if (deductedFeeBig > 0n && deductedFeeBig >= BigInt(rawPrincipalMinor)) {
          throw new Error("Biaya potong di tujuan tidak boleh melebihi atau sama dengan nominal transaksi.");
        }
        finalAmountMinor = (BigInt(rawPrincipalMinor) - deductedFeeBig).toString();
        const creditInterest = isCreditPurchase && plan ? BigInt(installmentTopUpRequest(plan, tenorMonths).transferFeeMinor) : 0n;
        const totalFee = addonFeeBig + deductedFeeBig + creditInterest;
        if (totalFee > 0n) {
          finalTransferFeeMinor = totalFee.toString();
        }
      }

      const interestChargeTypeId = options?.catalogs.chargeTypes.find(
        (item) => item.systemKey === "installment_interest"
      )?.id;
      const loanInterestChargeTypeId = options?.catalogs.chargeTypes.find(
        (item) => item.systemKey === "loan_interest"
      )?.id;
      const purchase =
        kind === "expense" && isCreditPurchase && plan && tenorMonths > 1
          ? installmentPurchaseRequest(plan, tenorMonths, interestChargeTypeId)
          : null;
      if (kind === "expense") {
        finalAmountMinor = purchase ? purchase.amountMinor : plan ? plan.firstMonthTotalMinor : rawPrincipalMinor;
      }

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
              ...(chargesEnabled
                ? purchase
                  ? editableInstallmentCharges(charges, interestChargeTypeId)
                  : charges
                : []
              ).map((charge) => ({
                typeId: charge.typeId,
                amountMinor: inputToMinor(charge.amount, exponent),
              })),
              ...(purchase?.charges ?? []),
            ]
          : undefined;

      const effectiveKind =
        activeTab === "pemasukan" && inflowType === "refund" ? "refund" : kind;

      const draft: ActivityDraft = buildEditorDraft({
        kind: effectiveKind,
        amountMinor: finalAmountMinor,
        occurredAt: new Date(occurredAt).toISOString(),
        note: effectiveNote,
        primaryAssetId: account.id,
        destinationAssetId: destination?.id,
        categoryId: categoryId || undefined,
        transferFeeMinor: finalTransferFeeMinor,
        expenseCharges,
        repayInterestMinor,
        loanInterestChargeTypeId,
        refundOfActivityId: effectiveKind === "refund" ? refundOfActivityId : undefined,
        adjustmentReason,
        adjustmentDirection,
      });

      const payload = JSON.stringify({
        id: initial?.id,
        draft,
        tenorMonths: isCreditPurchase || hasDebtSchedule ? tenorMonths : 1,
        targetCycle,
      });
      if (replay.current?.payload !== payload) replay.current = { payload, key: crypto.randomUUID() };

      await financeRequest(initial ? "replace" : "post", {
        id: initial?.id,
        draft,
        idempotencyKey: replay.current.key,
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

      if (!initial && isCreditPurchase && plan && plan.futureInstallmentsMinor.length > 0) {
        const startOffset = targetCycle === "next" ? 2 : 1;
        const labelBase =
          note.trim() || categories.find((c) => c.id === categoryId)?.displayName || account.displayName;
        const installments = plan.futureInstallmentsMinor.map((amt, idx) => ({
          title: `Cicilan ${idx + 2}/${tenorMonths} · ${account.displayName} (${labelBase})`.slice(0, 120),
          amountMinor: amt,
          dueOn: nextMonthlyDueDayIso(dueDay, idx + startOffset),
          note: `${CREDIT_REMINDER_NOTE_PREFIX} cicilan ini sudah termasuk tagihan ${
            account.displayName
          } jatuh tempo ${formatShortDueIso(nextMonthlyDueDayIso(dueDay, idx + startOffset))}. Total ${
            tenorMonths
          }x = ${formatMinor(plan.grandTotalMinor, currency, exponent)}.`.slice(0, 500),
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
            ? `Cicilan 1/${tenorMonths} masuk tagihan ${
                targetCycle === "next" ? nextDueShort : currentDueShort
              } & ${tenorMonths - 1} cicilan berikutnya dijadwalkan.`
            : `Transaksi masuk ke tagihan jatuh tempo ${
                targetCycle === "next" ? nextDueShort : currentDueShort
              }.`
          : "Transaksi berhasil dicatat."
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transaksi gagal disimpan.");
    } finally {
      finish();
    }
  }

  const scenarioTabs = [
    { id: "pengeluaran" as const, num: "1", label: "1. Pengeluaran" },
    { id: "transfer" as const, num: "2", label: "2. Top-Up & Transfer" },
    { id: "splitbill" as const, num: "3", label: "3. Split Bill" },
    { id: "pemasukan" as const, num: "4", label: "4. Pemasukan & Refund" },
    { id: "pelunasan" as const, num: "5", label: "5. Bayar / Ganti" },
  ];

  return (
    <dialog
      ref={dialog}
      className="finance-dialog transaction-modal"
      data-mode={layoutMode}
      aria-labelledby="tx-modal-title"
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      {/* 1. Window Header Bar */}
      <div className="tx-modal-header">
        <div className="tx-header-left">
          <div className="tx-brand-m" aria-hidden="true">
            M
          </div>
          <h2 id="tx-modal-title" className="tx-modal-title">
            {initial ? "Koreksi Transaksi" : "Catat Transaksi Baru"}
          </h2>
        </div>

        <div className="tx-header-right">
          <button
            type="button"
            onClick={() => setLayoutMode(layoutMode === "modal" ? "slideover" : "modal")}
            className="tx-mode-toggle"
            title="Ganti tampilan Dialog / Slide-Over"
          >
            {layoutMode === "modal" ? "Mode Slide-Over Kanan ⇥" : "Mode Dialog Tengah ⊡"}
          </button>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="icon-button tx-close-btn"
            aria-label="Tutup formulir"
            disabled={pending}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 2. 5-Scenario Fluent 2 Pivot Tabs */}
      <div className="tx-pivot-tabs" role="tablist" aria-label="Skenario pencatatan transaksi">
        {scenarioTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setActiveTab(tab.id);
                setError("");
              }}
              className="tx-pivot-tab"
              data-active={isActive}
            >
              <span>{tab.label}</span>
              {isActive && <span className="tx-tab-indicator" />}
            </button>
          );
        })}
      </div>

      {/* Error alert */}
      {error && (
        <div className="tx-error-banner" role="alert">
          {error}
        </div>
      )}

      {/* 3. Form Scrollable Workspace */}
      <div className="tx-modal-body">
        {!options ? (
          <FinanceOptionsStatus error={optionsError} retry={retry} />
        ) : (
          <form ref={formRef} id="tx-form" onSubmit={save} aria-busy={pending}>
            <fieldset className="finance-fieldset" disabled={pending}>
              {/* TAB 1: PENGELUARAN */}
              {activeTab === "pengeluaran" && (
                <div className="tx-tab-pane">
                  <div className="tx-field-row tx-two-col">
                    <div className="field">
                      <label htmlFor="exp-source">Pilih Akun Sumber</label>
                      <select
                        id="exp-source"
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        required
                      >
                        {primaryPool.map((item) => (
                          <option key={item.id} value={item.id}>
                            {isCreditAsset(item)
                              ? `[Kredit/PayLater] ${item.displayName} (Tagihan ${formatMinor(
                                  computeCreditBills(item).totalUnpaidMinor.toString(),
                                  item.currency,
                                  item.exponent
                                )})`
                              : `${item.displayName} · ${formatMinor(
                                  item.balanceMinor,
                                  item.currency,
                                  item.exponent
                                )}`}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field">
                      <label htmlFor="exp-merchant">Merchant / Penerima Pembayaran</label>
                      <input
                        id="exp-merchant"
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Contoh: Kopi Kenangan, Supermarket, PLN..."
                      />
                    </div>
                  </div>

                  {/* Auto-detect Credit / PayLater Box */}
                  {isCreditAsset(account) && (
                    <div className="tx-credit-box">
                      <div className="tx-credit-header">
                        <div className="tx-credit-title">
                          <CreditCard size={16} weight="bold" />
                          <span>Skema Kredit Otomatis — {account.displayName}</span>
                        </div>
                        <span className="tx-credit-cutoff">
                          Cutoff tgl {cutoffDay} → Jatuh Tempo tgl {dueDay}
                        </span>
                      </div>

                      <div className="tx-credit-grid">
                        <div className="field">
                          <label htmlFor="exp-tenor">Tenor Pembayaran</label>
                          <select
                            id="exp-tenor"
                            value={tenorMonths}
                            onChange={(e) => setTenorMonths(Number(e.target.value))}
                          >
                            <option value={1}>Bayar Penuh 1x</option>
                            <option value={3}>Cicilan 3x</option>
                            <option value={6}>Cicilan 6x</option>
                            <option value={12}>Cicilan 12x</option>
                          </select>
                        </div>

                        <div className="field">
                          <label htmlFor="exp-cycle">Periode Tagihan Statement</label>
                          <select
                            id="exp-cycle"
                            value={cycleOverride}
                            onChange={(e) =>
                              setCycleOverride(e.target.value as "auto" | "current" | "next")
                            }
                          >
                            <option value="auto">
                              Otomatis sesuai Cutoff tgl {cutoffDay} (Masuk{" "}
                              {targetCycle === "next" ? nextDueShort : currentDueShort})
                            </option>
                            <option value="current">Periode berjalan (Masuk {currentDueShort})</option>
                            <option value="next">Periode berikutnya (Masuk {nextDueShort})</option>
                          </select>
                        </div>

                        <div className="field">
                          <label htmlFor="exp-interest">Bunga / Biaya Kredit ({currency})</label>
                          <input
                            id="exp-interest"
                            type="text"
                            inputMode="decimal"
                            value={interestValue}
                            onChange={(e) => {
                              setInterestMode("flat_minor");
                              setInterestValue(e.target.value);
                            }}
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="tx-field-row tx-three-col">
                    <div className="field">
                      <label htmlFor="exp-amount">Nominal Pokok Belanja ({currency})</label>
                      <input
                        id="exp-amount"
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0"
                        required
                        className="tx-input-strong"
                      />
                    </div>

                    <div className="field">
                      <InlineCatalogSelect
                        label="Kategori Pengeluaran"
                        catalog="transactionCategories"
                        appliesTo="expense"
                        value={categoryId}
                        onChange={setCategoryId}
                        items={categories}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="exp-date">Tanggal &amp; Waktu</label>
                      <input
                        id="exp-date"
                        type="datetime-local"
                        value={occurredAt}
                        onChange={(e) => setOccurredAt(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {/* Optional Charges Section */}
                  <div className="tx-section-card">
                    <div className="tx-charges-header">
                      <label className="tx-checkbox-label">
                        <input
                          type="checkbox"
                          checked={chargesEnabled}
                          onChange={(e) => setChargesEnabled(e.target.checked)}
                        />
                        <span>Rincian Biaya Tambahan (Pajak PB1, Biaya Layanan, Ongkir)</span>
                      </label>
                      {amount.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            setChargesEnabled(true);
                            const pb1Amount = Math.round(Number(amount) * 0.1);
                            const pb1Charge = options?.catalogs.chargeTypes.find(
                              (c) => c.systemKey === "restaurant_tax" || c.displayName.toLowerCase().includes("pajak")
                            );
                            if (pb1Charge) {
                              setCharges((prev) => [
                                ...prev.filter((c) => c.typeId !== pb1Charge.id),
                                { id: crypto.randomUUID(), typeId: pb1Charge.id, amount: String(pb1Amount) },
                              ]);
                            }
                          }}
                          className="tx-btn-link"
                        >
                          + Hitung Otomatis PB1 10%
                        </button>
                      )}
                    </div>

                    {chargesEnabled && (
                      <div className="tx-charges-body">
                        <OptionalChargesEditor
                          enabled={chargesEnabled}
                          onEnabledChange={setChargesEnabled}
                          rows={charges}
                          onChange={setCharges}
                          chargeTypes={options.catalogs.chargeTypes.filter((c) => c.systemKey !== "transfer_fee")}
                        />
                      </div>
                    )}
                  </div>

                  {/* Preview Box */}
                  <div className="tx-preview-box">
                    <div>
                      <div className="tx-preview-title">Pratinjau Jurnal Pengeluaran</div>
                      <div className="tx-preview-subtitle">
                        Pokok: <strong>{formatMinor(numPrincipalMinor, currency, exponent)}</strong>
                        {totalExtraChargesBig + creditInterestBig > 0n && (
                          <>
                            {" + Biaya/Bunga: "}
                            <strong className="text-warning">
                              {formatMinor(
                                (totalExtraChargesBig + creditInterestBig).toString(),
                                currency,
                                exponent
                              )}
                            </strong>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="tx-preview-amount-block">
                      <span className="tx-preview-amount-label">Total Beban Mutasi</span>
                      <span className="tx-preview-amount-val text-out">
                        -{formatMinor(totalExpMutationBig.toString(), currency, exponent)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: TOP-UP & TRANSFER */}
              {activeTab === "transfer" && (
                <div className="tx-tab-pane">
                  <div className="tx-field-row tx-three-col">
                    <div className="field">
                      <label htmlFor="trf-source">Akun Sumber (Pengirim)</label>
                      <select
                        id="trf-source"
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        required
                      >
                        {primaryPool.map((item) => (
                          <option key={item.id} value={item.id}>
                            {isCreditAsset(item)
                              ? `[PayLater] ${item.displayName}`
                              : `${item.displayName} (${formatMinor(
                                  item.balanceMinor,
                                  item.currency,
                                  item.exponent
                                )})`}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field">
                      <label htmlFor="trf-dest">Akun Tujuan (Penerima)</label>
                      <select
                        id="trf-dest"
                        value={destination?.id ?? ""}
                        onChange={(e) => setDestinationId(e.target.value)}
                        required
                      >
                        {effectiveDestinationOptions.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.displayName} ({formatMinor(item.balanceMinor, item.currency, item.exponent)})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field">
                      <label htmlFor="trf-amount">Nominal Top-Up / Transfer ({currency})</label>
                      <input
                        id="trf-amount"
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0"
                        required
                        className="tx-input-strong"
                      />
                    </div>
                  </div>

                  {/* PayLater Source Top-Up Options */}
                  {isCreditPurchase && (
                    <div className="tx-credit-box">
                      <div className="tx-credit-header">
                        <span className="tx-credit-title">
                          <CreditCard size={16} weight="bold" />
                          Top-Up via {account.displayName} (Cutoff tgl {cutoffDay})
                        </span>
                      </div>
                      <div className="tx-credit-grid">
                        <div className="field">
                          <label htmlFor="trf-tenor">Tenor Top-Up</label>
                          <select
                            id="trf-tenor"
                            value={tenorMonths}
                            onChange={(e) => setTenorMonths(Number(e.target.value))}
                          >
                            <option value={1}>Bayar Penuh 1x</option>
                            <option value={3}>Cicilan 3x</option>
                            <option value={6}>Cicilan 6x</option>
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="trf-interest">Bunga / Biaya Layanan ({currency})</label>
                          <input
                            id="trf-interest"
                            type="text"
                            inputMode="decimal"
                            value={interestValue}
                            onChange={(e) => {
                              setInterestMode("flat_minor");
                              setInterestValue(e.target.value);
                            }}
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 3 Radio Admin Fee Modes */}
                  <div className="tx-section-card">
                    <div className="tx-card-title">
                      <Calculator size={16} weight="bold" className="text-primary" />
                      <span>Skema Potongan Biaya Admin:</span>
                    </div>

                    <div className="tx-radio-grid">
                      <label
                        className="tx-radio-card"
                        data-checked={feeMode === "addon"}
                        onClick={() => {
                          setFeeEnabled(true);
                          setFeeMode("addon");
                        }}
                      >
                        <input
                          type="radio"
                          name="feeMode"
                          checked={feeMode === "addon"}
                          onChange={() => {
                            setFeeEnabled(true);
                            setFeeMode("addon");
                          }}
                        />
                        <div>
                          <div className="tx-radio-name">Tambah di luar nominal (Add-on)</div>
                          <div className="tx-radio-desc">
                            Biaya admin ditambahkan ke pengeluaran akun sumber.
                          </div>
                        </div>
                      </label>

                      <label
                        className="tx-radio-card"
                        data-checked={feeMode === "deducted"}
                        onClick={() => {
                          setFeeEnabled(true);
                          setFeeMode("deducted");
                        }}
                      >
                        <input
                          type="radio"
                          name="feeMode"
                          checked={feeMode === "deducted"}
                          onChange={() => {
                            setFeeEnabled(true);
                            setFeeMode("deducted");
                          }}
                        />
                        <div>
                          <div className="tx-radio-name">Potong di dalam / di jalan (Deducted)</div>
                          <div className="tx-radio-desc">
                            Penerima menerima nominal dikurangi biaya potongan.
                          </div>
                        </div>
                      </label>

                      <label
                        className="tx-radio-card"
                        data-checked={feeMode === "both"}
                        onClick={() => {
                          setFeeEnabled(true);
                          setFeeMode("both");
                        }}
                      >
                        <input
                          type="radio"
                          name="feeMode"
                          checked={feeMode === "both"}
                          onChange={() => {
                            setFeeEnabled(true);
                            setFeeMode("both");
                          }}
                        />
                        <div>
                          <div className="tx-radio-name">Biaya Ganda (Sumber + Tujuan)</div>
                          <div className="tx-radio-desc">
                            Admin di Bank Sumber + potongan di E-Wallet Tujuan.
                          </div>
                        </div>
                      </label>
                    </div>

                    <div className="tx-fee-inputs">
                      {feeMode === "both" ? (
                        <div className="tx-field-row tx-two-col">
                          <div className="field">
                            <label htmlFor="trf-src-fee">Biaya Admin di Sumber ({currency})</label>
                            <input
                              id="trf-src-fee"
                              type="text"
                              inputMode="decimal"
                              value={fee}
                              onChange={(e) => setFee(e.target.value)}
                              placeholder="2500"
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="trf-dest-fee">Potongan di Tujuan ({currency})</label>
                            <input
                              id="trf-dest-fee"
                              type="text"
                              inputMode="decimal"
                              value={deductedFee}
                              onChange={(e) => setDeductedFee(e.target.value)}
                              placeholder="1000"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="field" style={{ maxWidth: 300 }}>
                          <label htmlFor="trf-single-fee">
                            {feeMode === "addon"
                              ? `Biaya Admin Tambahan (${currency})`
                              : `Potongan Biaya di Tujuan (${currency})`}
                          </label>
                          <input
                            id="trf-single-fee"
                            type="text"
                            inputMode="decimal"
                            value={fee}
                            onChange={(e) => setFee(e.target.value)}
                            placeholder="2000"
                          />
                        </div>
                      )}
                    </div>

                    {/* Preview Box */}
                    <div className="tx-preview-box">
                      <div>
                        <div className="tx-preview-title">Preview Kalkulasi Otomatis:</div>
                        <div className="tx-preview-subtitle">
                          Keluar dari Sumber:{" "}
                          <strong className="text-out">
                            -{formatMinor(trfSourceOutBig.toString(), currency, exponent)}
                          </strong>
                          {" · "}
                          Masuk Bersih ke Tujuan:{" "}
                          <strong className="text-in">
                            +{formatMinor(trfTargetInBig.toString(), currency, exponent)}
                          </strong>
                          {" · "}
                          Total Biaya Admin:{" "}
                          <strong className="text-warning">
                            {formatMinor(totalBurnedFeeBig.toString(), currency, exponent)}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="tx-field-row tx-two-col">
                    <div className="field">
                      <label htmlFor="trf-note">Catatan</label>
                      <input
                        id="trf-note"
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Catatan transfer..."
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="trf-date">Tanggal &amp; Waktu</label>
                      <input
                        id="trf-date"
                        type="datetime-local"
                        value={occurredAt}
                        onChange={(e) => setOccurredAt(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: SPLIT BILL / TALANGAN */}
              {activeTab === "splitbill" && (
                <div className="tx-tab-pane">
                  <div className="tx-field-row tx-four-col">
                    <div className="field">
                      <label htmlFor="sb-title">Nama Acara / Merchant</label>
                      <input
                        id="sb-title"
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Contoh: Kopi & Makan Siang"
                        required
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="sb-payer">Akun Pembayar</label>
                      <select
                        id="sb-payer"
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        required
                      >
                        {primaryPool.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.displayName} ({formatMinor(item.balanceMinor, item.currency, item.exponent)})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field">
                      <InlineCatalogSelect
                        label="Kategori Porsi Pribadi"
                        catalog="transactionCategories"
                        appliesTo="expense"
                        value={categoryId}
                        onChange={setCategoryId}
                        items={categories}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="sb-total">Total Bayar di Struk ({currency})</label>
                      <input
                        id="sb-total"
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          if (splitMethod === "equal") handleEqualSplit(e.target.value);
                        }}
                        placeholder="0"
                        required
                        className="tx-input-strong"
                      />
                    </div>
                  </div>

                  {/* Split Method Bar */}
                  <div className="tx-split-method-bar">
                    <div className="tx-split-method-options">
                      <span className="tx-split-method-label">Metode Bagi:</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSplitMethod("equal");
                          handleEqualSplit(amount);
                        }}
                        className="tx-method-btn"
                        data-active={splitMethod === "equal"}
                      >
                        Bagi Rata (50:50)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSplitMethod("custom")}
                        className="tx-method-btn"
                        data-active={splitMethod === "custom"}
                      >
                        Per Orang / Kustom
                      </button>
                    </div>
                  </div>

                  {/* Participants Table */}
                  <div className="tx-participants-card">
                    {/* Participant 1: You */}
                    <div className="tx-participant-row tx-participant-mine">
                      <div className="tx-participant-identity">
                        <span className="tx-badge-idx">1</span>
                        <div>
                          <div className="tx-participant-name">Anda (Porsi Pribadi)</div>
                          <div className="tx-participant-desc">
                            Hanya porsi ini yang masuk ke Pengeluaran &amp; Anggaran!
                          </div>
                        </div>
                      </div>
                      <div className="tx-participant-input">
                        <span>Rp</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={minorToInput(porsiPribadiBig.toString(), exponent)}
                          readOnly
                          className="tx-porsi-input"
                        />
                      </div>
                    </div>

                    {/* Participant 2: Friend */}
                    <div className="tx-participant-row">
                      <div className="tx-participant-identity">
                        <span className="tx-badge-idx secondary">2</span>
                        <div className="tx-participant-inputs">
                          <input
                            type="text"
                            value={reimbursePerson}
                            onChange={(e) => setReimbursePerson(e.target.value)}
                            placeholder="Nama Teman (misal: Budi / Siti)"
                            required
                            className="tx-friend-name"
                          />
                          <select
                            value={receivableAssetId}
                            onChange={(e) => setReceivableAssetId(e.target.value)}
                            className="tx-receivable-select"
                          >
                            <option value="">(Otomatis buat akun Piutang baru)</option>
                            {active
                              .filter((a) => a.assetClass === "receivable")
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  Gunakan akun: {a.displayName}
                                </option>
                              ))}
                          </select>
                        </div>
                      </div>

                      <div className="tx-participant-input">
                        <span>Rp</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={reimburseAmount}
                          onChange={(e) => {
                            setSplitMethod("custom");
                            setReimburseAmount(e.target.value);
                          }}
                          placeholder="Nominal talangan"
                          required
                          className="tx-talangan-input"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Summary Box */}
                  <div className="tx-preview-box">
                    <div>
                      <div className="tx-preview-title">Alokasi Beban Transaksi:</div>
                      <div className="tx-preview-subtitle">
                        Total Struk:{" "}
                        <strong>{formatMinor(numPrincipalMinor, currency, exponent)}</strong>
                        {" · "}
                        Porsi Pribadi Anda:{" "}
                        <strong className="text-out">
                          {formatMinor(porsiPribadiBig.toString(), currency, exponent)}
                        </strong>
                        {" · "}
                        Masuk ke Piutang Talangan:{" "}
                        <strong className="text-warning">
                          {formatMinor(talanganBig.toString(), currency, exponent)}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: PEMASUKAN & REFUND */}
              {activeTab === "pemasukan" && (
                <div className="tx-tab-pane">
                  <div className="tx-section-card">
                    <div className="tx-card-title">Pilihan Sifat Uang Masuk (Jenis Inflow):</div>
                    <div className="tx-radio-grid">
                      <label
                        className="tx-radio-card"
                        data-checked={inflowType === "active"}
                        onClick={() => setInflowType("active")}
                      >
                        <input
                          type="radio"
                          name="inflowType"
                          checked={inflowType === "active"}
                          onChange={() => setInflowType("active")}
                        />
                        <div>
                          <div className="tx-radio-name text-in">
                            Penghasilan Aktif (Gaji / Bonus / Usaha)
                          </div>
                          <div className="tx-radio-desc">
                            Masuk ke grafik Income &amp; menambah tabungan.
                          </div>
                        </div>
                      </label>

                      <label
                        className="tx-radio-card"
                        data-checked={inflowType === "passive"}
                        onClick={() => setInflowType("passive")}
                      >
                        <input
                          type="radio"
                          name="inflowType"
                          checked={inflowType === "passive"}
                          onChange={() => setInflowType("passive")}
                        />
                        <div>
                          <div className="tx-radio-name text-primary">
                            Penghasilan Pasif (Bunga Tabungan / Dividen)
                          </div>
                          <div className="tx-radio-desc">
                            Mencatat hasil investasi beserta potongan Pajak PPh.
                          </div>
                        </div>
                      </label>

                      <label
                        className="tx-radio-card"
                        data-checked={inflowType === "refund"}
                        onClick={() => setInflowType("refund")}
                      >
                        <input
                          type="radio"
                          name="inflowType"
                          checked={inflowType === "refund"}
                          onChange={() => setInflowType("refund")}
                        />
                        <div>
                          <div className="tx-radio-name text-warning">
                            Refund Batal Belanja / Cashback
                          </div>
                          <div className="tx-radio-desc">
                            Mengurangi pengeluaran kategori asal (Net-Off).
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="tx-field-row tx-three-col">
                    <div className="field">
                      <label htmlFor="inc-dest">Rekening Penerima</label>
                      <select
                        id="inc-dest"
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        required
                      >
                        {primaryPool.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.displayName} ({formatMinor(item.balanceMinor, item.currency, item.exponent)})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field">
                      <label htmlFor="inc-source">Sumber Pemberi / Keterangan</label>
                      <input
                        id="inc-source"
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Contoh: PT Perusahaan, Bunga SeaBank..."
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="inc-amount">Nominal Uang Masuk ({currency})</label>
                      <input
                        id="inc-amount"
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0"
                        required
                        className="tx-input-strong text-in"
                      />
                    </div>
                  </div>

                  {inflowType === "passive" && (
                    <div className="tx-section-card">
                      <div className="tx-field-row tx-two-col">
                        <div className="field">
                          <label htmlFor="inc-tax">Potongan Pajak PPh 20% ({currency})</label>
                          <input
                            id="inc-tax"
                            type="text"
                            inputMode="decimal"
                            value={taxWithheld}
                            onChange={(e) => setTaxWithheld(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        <div className="tx-calc-summary-col">
                          <span className="tx-calc-label">Masuk Bersih ke Rekening:</span>
                          <span className="tx-calc-val text-in">
                            +{formatMinor(netInflowBig.toString(), currency, exponent)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {inflowType === "refund" && (
                    <div className="tx-section-card tx-refund-box">
                      <label htmlFor="refund-origin" className="tx-card-title text-warning">
                        Pilih Transaksi Pengeluaran Asal yang Di-Refund:
                      </label>
                      <select
                        id="refund-origin"
                        value={refundOfActivityId}
                        onChange={(e) => setRefundOfActivityId(e.target.value)}
                        required
                      >
                        <option value="">-- Pilih transaksi belanja asal --</option>
                        {refundExpenses.map((exp) => (
                          <option key={exp.id} value={exp.id}>
                            {exp.occurredAt.slice(0, 10)} · {exp.categoryName ?? "Pengeluaran"} ·{" "}
                            {formatMinor(exp.baseAmountMinor, exp.currency, exp.exponent)} (
                            {exp.note ?? exp.sourceName})
                          </option>
                        ))}
                      </select>
                      <p className="tx-hint-text">
                        Pengembalian dana akan mengurangi grafik belanja kategori asal (Net-Off) agar
                        laporan konsumsi tetap akurat.
                      </p>
                    </div>
                  )}

                  <div className="tx-field-row tx-two-col">
                    <div className="field">
                      <InlineCatalogSelect
                        label="Kategori Pemasukan"
                        catalog="transactionCategories"
                        appliesTo="income"
                        value={categoryId}
                        onChange={setCategoryId}
                        items={categories}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="inc-date">Tanggal &amp; Waktu</label>
                      <input
                        id="inc-date"
                        type="datetime-local"
                        value={occurredAt}
                        onChange={(e) => setOccurredAt(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: BAYAR TAGIHAN / TERIMA GANTI */}
              {activeTab === "pelunasan" && (
                <div className="tx-tab-pane">
                  {/* Sub-mode selector */}
                  <div className="tx-submode-tabs">
                    <button
                      type="button"
                      onClick={() => setSettleSubMode("pay_credit")}
                      className="tx-submode-btn"
                      data-active={settleSubMode === "pay_credit"}
                    >
                      <CreditCard size={15} weight="bold" />
                      <span>Melunasi Tagihan Kartu Kredit / PayLater</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettleSubMode("receive_friend")}
                      className="tx-submode-btn"
                      data-active={settleSubMode === "receive_friend"}
                    >
                      <Users size={15} weight="bold" />
                      <span>Mencatat Pelunasan Piutang Teman</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettleSubMode("borrow_adjust")}
                      className="tx-submode-btn"
                      data-active={settleSubMode === "borrow_adjust"}
                    >
                      <Calculator size={15} weight="bold" />
                      <span>Pinjaman Cair / Koreksi Saldo</span>
                    </button>
                  </div>

                  {settleSubMode === "pay_credit" && (
                    <div className="tx-settle-content">
                      <div className="field" style={{ maxWidth: 360 }}>
                        <label htmlFor="pay-src">Rekening Sumber Pembayaran</label>
                        <select
                          id="pay-src"
                          value={accountId}
                          onChange={(e) => setAccountId(e.target.value)}
                        >
                          {active
                            .filter((a) => a.assetClass === "asset")
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.displayName} — Saldo {formatMinor(a.balanceMinor, a.currency, a.exponent)}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div className="tx-cards-list">
                        {active
                          .filter((a) => isCreditAsset(a))
                          .map((cr) => {
                            const bills = computeCreditBills(cr);
                            const unpaid = bills.totalUnpaidMinor;
                            return (
                              <div key={cr.id} className="tx-settle-card">
                                <div>
                                  <div className="tx-settle-card-title">
                                    <span className="tx-settle-name">{cr.displayName}</span>
                                    <span className="tx-badge-red">
                                      Tagihan {formatMinor(unpaid.toString(), cr.currency, cr.exponent)}
                                    </span>
                                  </div>
                                  <div className="tx-settle-meta">
                                    {bills.availableLimitMinor !== null
                                      ? `Sisa limit ${formatMinor(bills.availableLimitMinor.toString(), cr.currency, cr.exponent)}`
                                      : "Kredit operasional"}
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setDestinationId(cr.id);
                                    setAmount(minorToInput(unpaid.toString(), cr.exponent));
                                    setNote(`Pelunasan tagihan ${cr.displayName}`);
                                  }}
                                  className="tx-btn-1click"
                                >
                                  Pilih 1-Klik ({formatMinor(unpaid.toString(), cr.currency, cr.exponent)})
                                </button>
                              </div>
                            );
                          })}
                      </div>

                      <div className="tx-field-row tx-three-col" style={{ marginTop: 12 }}>
                        <div className="field">
                          <label htmlFor="pay-amt">Nominal Pembayaran ({currency})</label>
                          <input
                            id="pay-amt"
                            type="text"
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0"
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="pay-interest">Bunga / Biaya ({currency})</label>
                          <input
                            id="pay-interest"
                            type="text"
                            inputMode="decimal"
                            value={repayInterest}
                            onChange={(e) => setRepayInterest(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="pay-date">Tanggal Pembayaran</label>
                          <input
                            id="pay-date"
                            type="datetime-local"
                            value={occurredAt}
                            onChange={(e) => setOccurredAt(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {settleSubMode === "receive_friend" && (
                    <div className="tx-settle-content">
                      <div className="field" style={{ maxWidth: 360 }}>
                        <label htmlFor="rec-dest">Rekening Penerima Uang Pelunasan</label>
                        <select
                          id="rec-dest"
                          value={destination?.id ?? ""}
                          onChange={(e) => setDestinationId(e.target.value)}
                        >
                          {active
                            .filter((a) => a.assetClass === "asset")
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.displayName} — Saldo {formatMinor(a.balanceMinor, a.currency, a.exponent)}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div className="tx-cards-list">
                        {active
                          .filter((a) => isReceivableAsset(a))
                          .map((rec) => (
                            <div key={rec.id} className="tx-settle-card">
                              <div>
                                <div className="tx-settle-card-title">
                                  <span className="tx-settle-name">{rec.displayName}</span>
                                  <span className="tx-badge-amber">
                                    Piutang {formatMinor(rec.balanceMinor, rec.currency, rec.exponent)}
                                  </span>
                                </div>
                                <div className="tx-settle-meta">Uang talangan menunggu pelunasan</div>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  setAccountId(rec.id);
                                  setAmount(minorToInput(rec.balanceMinor, rec.exponent));
                                  setNote(`Pelunasan piutang ${rec.displayName}`);
                                }}
                                className="tx-btn-1click receive"
                              >
                                Terima Lunas 1-Klik ({formatMinor(rec.balanceMinor, rec.currency, rec.exponent)})
                              </button>
                            </div>
                          ))}
                      </div>

                      <div className="tx-field-row tx-two-col" style={{ marginTop: 12 }}>
                        <div className="field">
                          <label htmlFor="rec-amt">Nominal Pelunasan ({currency})</label>
                          <input
                            id="rec-amt"
                            type="text"
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0"
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="rec-date">Tanggal Pelunasan</label>
                          <input
                            id="rec-date"
                            type="datetime-local"
                            value={occurredAt}
                            onChange={(e) => setOccurredAt(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {settleSubMode === "borrow_adjust" && (
                    <div className="tx-settle-content">
                      <div className="tx-field-row tx-two-col">
                        <div className="field">
                          <label htmlFor="borrow-src">Akun Sumber</label>
                          <select
                            id="borrow-src"
                            value={accountId}
                            onChange={(e) => setAccountId(e.target.value)}
                          >
                            {primaryPool.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.displayName} ({formatMinor(a.balanceMinor, a.currency, a.exponent)})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="borrow-dest">Akun Tujuan (Jika transfer/pinjaman)</label>
                          <select
                            id="borrow-dest"
                            value={destination?.id ?? ""}
                            onChange={(e) => setDestinationId(e.target.value)}
                          >
                            {effectiveDestinationOptions.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.displayName}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="tx-field-row tx-three-col">
                        <div className="field">
                          <label htmlFor="borrow-amt">Nominal ({currency})</label>
                          <input
                            id="borrow-amt"
                            type="text"
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0"
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="borrow-reason">Alasan Koreksi</label>
                          <select
                            id="borrow-reason"
                            value={adjustmentReason}
                            onChange={(e) =>
                              setAdjustmentReason(e.target.value as AdjustmentReason)
                            }
                          >
                            <option value="reconciliation">Rekonsiliasi Selisih</option>
                            <option value="opening_balance">Saldo Awal</option>
                            <option value="opening_debt">Hutang Awal</option>
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="borrow-dir">Arah Penyesuaian</label>
                          <select
                            id="borrow-dir"
                            value={adjustmentDirection}
                            onChange={(e) =>
                              setAdjustmentDirection(e.target.value as "increase" | "decrease")
                            }
                          >
                            <option value="increase">Menambah Saldo (+)</option>
                            <option value="decrease">Mengurangi Saldo (-)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </fieldset>
          </form>
        )}
      </div>

      {/* 4. Modal Footer Bar */}
      <div className="tx-modal-footer">
        <div className="tx-footer-note">
          <Info size={15} weight="bold" className="text-primary" />
          <span>Jurnal ganda otomatis memperbarui Buku Mutasi, Saldo &amp; Anggaran.</span>
        </div>

        <div className="tx-footer-actions">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="tx-btn-cancel"
            disabled={pending}
          >
            Batal
          </button>
          <button
            type="submit"
            form="tx-form"
            className="button-primary tx-btn-save"
            disabled={pending}
          >
            {pending ? (
              <LoadingIndicator>Menyimpan…</LoadingIndicator>
            ) : (
              <>
                <Plus size={15} weight="bold" />
                <span>Simpan Transaksi</span>
              </>
            )}
          </button>
        </div>
      </div>
    </dialog>
  );
}
