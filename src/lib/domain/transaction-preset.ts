import type { ActivityKind, FinanceAsset } from "@/lib/finance/types";
import { isCreditAsset, isReceivableAsset } from "./credit.ts";

/** Values the transaction editor opens with. Amounts are plain input text (not minor units), e.g. "1500000". */
export type TransactionPreset = Readonly<{
  kind?: ActivityKind;
  accountId?: string;
  destinationId?: string;
  amount?: string;
  note?: string;
}>;

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
