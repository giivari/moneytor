import type { ActivityDraft, AdjustmentReason, AnyActivityKind, FinanceAsset } from "@/lib/finance/types";
import { isCreditAsset, isReceivableAsset } from "./credit.ts";

/** Values the transaction editor opens with. Amounts are plain input text (not minor units), e.g. "1500000". */
export type TransactionPreset = Readonly<{
  kind?: AnyActivityKind;
  accountId?: string;
  destinationId?: string;
  amount?: string;
  note?: string;
  refundOfActivityId?: string;
}>;

export type EditorDraftInput = Readonly<{
  kind: AnyActivityKind;
  amountMinor: string;
  occurredAt: string;
  note?: string;
  primaryAssetId: string;
  destinationAssetId?: string;
  categoryId?: string;
  transferFeeMinor?: string;
  expenseCharges?: { typeId: string; amountMinor: string }[];
  repayInterestMinor?: string;
  loanInterestChargeTypeId?: string;
  refundOfActivityId?: string;
  adjustmentReason?: AdjustmentReason;
  adjustmentDirection?: "increase" | "decrease";
}>;

/** Builds the ActivityDraft sent by TransactionEditor to POST /api/finance/post or replace (docs/CONTRACT.md). */
export function buildEditorDraft(input: EditorDraftInput): ActivityDraft {
  const { kind, amountMinor, occurredAt, note, primaryAssetId } = input;
  const usesDestinationAsPrimary =
    kind === "income" ||
    kind === "refund" ||
    (kind === "adjustment" && input.adjustmentReason === "reconciliation" && input.adjustmentDirection === "increase");
  const repayCharges =
    kind === "repay" && input.repayInterestMinor && BigInt(input.repayInterestMinor) > 0n && input.loanInterestChargeTypeId
      ? [{ typeId: input.loanInterestChargeTypeId, amountMinor: input.repayInterestMinor }]
      : undefined;
  return {
    kind,
    amountMinor,
    occurredAt,
    note,
    ...(usesDestinationAsPrimary ? { destinationAssetId: primaryAssetId } : { sourceAssetId: primaryAssetId }),
    ...(kind === "transfer"
      ? {
          destinationAssetId: input.destinationAssetId!,
          transferFeeMinor: input.transferFeeMinor,
        }
      : {}),
    ...(kind === "borrow" || kind === "repay"
      ? {
          destinationAssetId: input.destinationAssetId!,
        }
      : {}),
    ...(kind === "refund"
      ? {
          refundOfActivityId: input.refundOfActivityId,
        }
      : {}),
    ...(kind === "adjustment"
      ? {
          adjustmentReason: input.adjustmentReason ?? "reconciliation",
        }
      : {}),
    ...(kind === "expense" || kind === "income" ? { categoryId: input.categoryId || undefined } : {}),
    ...(kind === "expense" ? { charges: input.expenseCharges ?? [] } : {}),
    ...(kind === "repay" && repayCharges ? { charges: repayCharges } : {}),
  };
}

/**
 * The account a transfer into `destinationId` most likely comes from: an active, spendable, non-credit,
 * non-receivable account in the same currency, else any such account. Never the destination itself.
 */
export function pickTransferSource(assets: readonly FinanceAsset[], destinationId: string): FinanceAsset | undefined {
  const destination = assets.find((asset) => asset.id === destinationId);
  if (!destination) return undefined;
  const candidates = assets.filter((asset) => asset.id !== destinationId && asset.currency === destination.currency
    && asset.isActive && !isCreditAsset(asset) && !isReceivableAsset(asset));
  return candidates.find((asset) => asset.normallySpendable) ?? candidates[0];
}
