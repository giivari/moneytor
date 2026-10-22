import { assertStoredMinor, parseMinor } from '../domain/money.ts';

export class AllocationError extends Error {}
export type AllocationStorage = 'income_event' | 'general';
export type AllocationState = 'additional' | 'aligned' | 'excess' | 'blocked';
export type AllocationSummary = {
  assessmentId: string; proposalId: string | null; storage: AllocationStorage; instanceId: string;
  state: AllocationState; currency: string; exponent: number; percentageBps: number;
  sourceMinor: string; targetMinor: string; recognizedMinor: string; differenceMinor: string;
  sourceVoided: boolean; reason: string | null; actionKind: 'expense' | 'income' | 'transfer';
  conditionsMatched?: boolean;
  sourceName: string | null; destinationName: string | null; originalMinor: string;
  adjustmentMinor: string; sourceAt: string; proposalStatus: string | null;
  confirmedFees: { transferFeeMinor?: string; charges: {typeId:string;amountMinor:string}[] } | null;
};
export function allocationDifference(sourceMinor: string, bps: number, principal: readonly string[], voided = false) {
  if (!Number.isInteger(bps) || bps < 1 || bps > 10000) throw new AllocationError('Persentase tersimpan tidak valid.');
  const source = assertStoredMinor(parseMinor(sourceMinor));
  if (source < 0n) throw new AllocationError('Nominal sumber tidak valid.');
  let recognized = 0n;
  for (const raw of principal) {
    const value = assertStoredMinor(parseMinor(raw));
    if (value < 0n) throw new AllocationError('Pokok hasil tidak valid.');
    recognized = assertStoredMinor(recognized + value);
  }
  const target = voided ? 0n : assertStoredMinor(source * BigInt(bps) / 10000n);
  const difference = assertStoredMinor(target - recognized);
  return { targetMinor: target.toString(), recognizedMinor: recognized.toString(), differenceMinor: difference.toString(),
    state: (difference > 0n ? 'additional' : difference < 0n ? 'excess' : 'aligned') as AllocationState };
}
