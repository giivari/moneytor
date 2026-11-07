/** Kinds known to automation, recurring templates, imports and the current UI. */
export type ActivityKind = "income" | "expense" | "transfer";
/** Debt and correction kinds (docs/CONTRACT.md). Not income, expense or transfer in any report. */
export type DebtActivityKind = "borrow" | "repay" | "refund" | "adjustment";
export type AnyActivityKind = ActivityKind | DebtActivityKind;
export type AdjustmentReason = "reconciliation" | "opening_debt";
export type ActivityDraft = {
  kind: AnyActivityKind;
  amountMinor: string;
  sourceAssetId?: string;
  destinationAssetId?: string;
  categoryId?: string;
  charges?: { typeId: string; amountMinor: string }[];
  transferFeeMinor?: string;
  occurredAt: string;
  note?: string;
  /** refund only: the posted expense being refunded (its category is copied). */
  refundOfActivityId?: string;
  /** adjustment only: destination = increase, source = decrease; opening_debt needs a liability source. */
  adjustmentReason?: AdjustmentReason;
};
/** What an account is in net worth: something owned, a debt (credit line, loan), or money owed to the owner. */
export type AssetClass = "asset" | "liability" | "receivable";
export const ASSET_CLASSES: readonly AssetClass[] = ["asset", "liability", "receivable"];
/** One month of an installment purchase on a credit account (table credit_installments). */
export type CreditInstallment = {
  activityId: string; seq: number;
  /** Due month, YYYY-MM. */
  period: string;
  principalMinor: string; interestMinor: string;
  status: "scheduled" | "cancelled";
  cancelledByActivityId?: string;
};
export type FinanceAsset = {
  id: string; displayName: string; currency: string; exponent: number;
  assetTypeId: string; assetTypeName: string; assetGroupId: string | null; assetGroupName: string | null;
  providerId: string | null; providerName: string | null; paymentNetworkId: string | null;
  normallyLiquid: boolean; normallySpendable: boolean; safeSuffix: string | null;
  note: string | null; isActive: boolean; openingMinor: string; balanceMinor: string;
  assetClass: AssetClass;
  /** Scheduled installment rows of a credit account from the current month on. */
  creditInstallments?: readonly CreditInstallment[];
};
export type FinanceActivity = {
  cursorTime?: string;
  id: string; kind: ActivityKind; baseAmountMinor: string; currency: string; exponent: number;
  sourceAssetId: string | null; sourceName: string | null;
  destinationAssetId: string | null; destinationName: string | null;
  categoryId: string | null; categoryName: string | null;
  occurredAt: string; note: string | null; status: "posted" | "voided" | "superseded";
  replacesActivityId: string | null;
  refundOfActivityId?: string | null;
  adjustmentReason?: AdjustmentReason | null;
  recurringRuleName?: string;
  eventInstanceId?: string;
  eventSourceIncomeId?: string;
  eventSourceAmountMinor?: string;
  eventSourceCurrency?: string;
  eventSourceOccurredAt?: string;
  eventSourceExponent?: number;
  automationInstanceId?: string;
  allocationAdjustmentId?: string;
  allocationAssessmentId?: string;
  originalAutomationResultId?: string;
  automationSourceActivityId?: string;
  automationSourceKind?: ActivityKind;
  charges: { id: string; typeId: string; typeName: string; systemKey?: string | null; amountMinor: string }[];
  /** Installment terms of an installment purchase (from credit_installments), so a correction can keep them. */
  creditInstallments?: InstallmentTerms;
};
/** Per-month terms of an installment purchase; month 1 also takes the principal remainder. */
export type InstallmentTerms = { count: number; principalMinor: string; interestMinor: string };
