import type { FinanceActivity } from "./finance/types";
import type { InvestmentTrade } from "./investments/types";

/** Display values only; Transfer principal remains separate from its expense fee. */
export function activityValueMinor(item:Pick<FinanceActivity,"kind"|"baseAmountMinor"|"charges">) {
  return item.kind==="transfer"?item.baseAmountMinor:(BigInt(item.baseAmountMinor)+item.charges.reduce((total,charge)=>total+BigInt(charge.amountMinor),0n)).toString();
}
/** P4 cash movement, never an ordinary Income/Expense classification. */
export function investmentCashMinor(item:Pick<InvestmentTrade,"kind"|"grossMinor"|"feeMinor">) {
  return (BigInt(item.grossMinor)+(item.kind==="buy"?BigInt(item.feeMinor):-BigInt(item.feeMinor))).toString();
}
