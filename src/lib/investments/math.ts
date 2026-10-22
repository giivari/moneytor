/** Exact fixed-scale decimal arithmetic. Money settles with half-away-from-zero rounding. */
export const SCALE = 10n ** 18n;
export class InvestmentError extends Error {}
const MAX_MINOR = 2n ** 63n - 1n;
export function decimal(raw: unknown, allowZero = false): bigint {
  if (typeof raw !== "string" || !/^\d{1,30}(\.\d{1,18})?$/.test(raw)) throw new InvestmentError("Gunakan angka desimal, maksimal 18 angka di belakang titik.");
  const [whole, fraction = ""] = raw.split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
  if (result < 0n || (!allowZero && result === 0n)) throw new InvestmentError("Jumlah unit dan harga harus lebih dari nol.");
  return result;
}
export function decimalString(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return sign + (absolute / SCALE).toString() + (fraction ? `.${fraction}` : "");
}
export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new InvestmentError("Pembagi tidak valid.");
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((absolute + denominator / 2n) / denominator);
}
export function storedMoney(raw: unknown, allowZero = true): bigint {
  if (typeof raw !== "string" || !/^(0|[1-9]\d*)$/.test(raw)) throw new InvestmentError("Jumlah uang tidak valid.");
  const result = BigInt(raw);
  if (result > MAX_MINOR || (!allowZero && result === 0n)) throw new InvestmentError("Jumlah uang di luar batas.");
  return result;
}
function roundedValue(quantity: string, price: string, exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 9) throw new InvestmentError("Mata uang tidak valid.");
  return roundRatio(decimal(quantity) * decimal(price) * 10n ** BigInt(exponent), SCALE * SCALE);
}
export function settle(quantity: string, price: string, exponent: number): bigint {
  const result = roundedValue(quantity, price, exponent);
  if (result > MAX_MINOR) throw new InvestmentError("Nilai transaksi di luar batas.");
  return result;
}
export function tradeCash(kind: "buy" | "sell", quantity: string, price: string, feeMinor: string, exponent: number) {
  const gross = settle(quantity, price, exponent);
  const fee = storedMoney(feeMinor);
  if (!gross) throw new InvestmentError("Nilai transaksi setelah pembulatan harus lebih dari nol.");
  if (kind === "sell" && fee > gross) throw new InvestmentError("Biaya tidak boleh melebihi hasil penjualan.");
  const cash = kind === "buy" ? gross + fee : gross - fee;
  if (cash > MAX_MINOR) throw new InvestmentError("Jumlah uang di luar batas.");
  return { gross, fee, cash };
}
export type Opening = { quantity: string; costBasisMinor: string; occurredAt: string };
export type ReplayTrade = { id: string; kind: "buy" | "sell"; quantity: string; grossMinor: string; feeMinor: string; occurredAt: string; order: string };
export function replayPosition(opening: Opening | undefined, events: readonly ReplayTrade[], exponent: number) {
  let quantity = opening ? decimal(opening.quantity) : 0n;
  let basis = opening ? storedMoney(opening.costBasisMinor) : 0n;
  let realized = 0n;
  const sells: Record<string, { removedMinor: string; realizedMinor: string }> = {};
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || (BigInt(a.order) < BigInt(b.order) ? -1 : BigInt(a.order) > BigInt(b.order) ? 1 : 0));
  for (const event of ordered) {
    if (opening && event.occurredAt < opening.occurredAt) throw new InvestmentError("Transaksi tidak boleh mendahului posisi awal.");
    const units = decimal(event.quantity);
    const gross = storedMoney(event.grossMinor, false);
    const fee = storedMoney(event.feeMinor);
    if (event.kind === "buy") {
      quantity += units; basis += gross + fee;
      if (quantity >= 10n ** 48n) throw new InvestmentError("Jumlah unit posisi di luar batas.");
    }
    else {
      if (units > quantity) throw new InvestmentError(`Unit tidak mencukupi pada waktu transaksi ini. Tersedia hanya ${decimalString(quantity)} unit. Kurangi jumlah penjualan atau periksa transaksi sebelumnya.`);
      if (fee > gross) throw new InvestmentError("Biaya melebihi hasil penjualan.");
      const removed = units === quantity ? basis : roundRatio(basis * units, quantity);
      const gain = gross - fee - removed;
      quantity -= units; basis -= removed; realized += gain;
      sells[event.id] = { removedMinor: removed.toString(), realizedMinor: gain.toString() };
    }
  }
  const averageCost = quantity ? decimalString(roundRatio(basis * SCALE * SCALE, quantity * 10n ** BigInt(exponent))) : "0";
  return { quantity: decimalString(quantity), costBasisMinor: basis.toString(), averageCost, realizedMinor: realized.toString(), sells };
}
export function valuation(quantity: string, costBasisMinor: string, price: string | null, exponent: number) {
  if (price === null) return { marketMinor: null, unrealizedMinor: null, unrealizedPercent: null };
  // Valuation is a derived aggregate, not a stored settlement BIGINT.
  const market = quantity === "0" ? 0n : roundedValue(quantity, price, exponent);
  const basis = BigInt(costBasisMinor);
  const gain = market - basis;
  const percent = basis ? roundRatio(gain * 10000n, basis) : null;
  return { marketMinor: market.toString(), unrealizedMinor: gain.toString(), unrealizedPercent: percent === null ? null : `${percent < 0n ? "-" : ""}${(percent < 0n ? -percent : percent) / 100n}.${((percent < 0n ? -percent : percent) % 100n).toString().padStart(2, "0")}` };
}
