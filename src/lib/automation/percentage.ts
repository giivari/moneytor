/** Exact percentage of a posted Income's base amount, in minor units. */
export function percentageOfIncome(amountMinor: string, percentageBps: number): string {
  if (!/^[1-9]\d*$/.test(amountMinor) || !Number.isInteger(percentageBps) || percentageBps < 1 || percentageBps > 10000) {
    throw new Error("Nominal pemasukan atau persentase tidak valid.");
  }
  const result = BigInt(amountMinor) * BigInt(percentageBps) / 10000n;
  if (result === 0n || result > 9223372036854775807n) throw new Error("Hasil persentase harus setidaknya satu unit terkecil.");
  return result.toString();
}
