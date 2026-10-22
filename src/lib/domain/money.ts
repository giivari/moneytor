/** Exact amounts. The exponent is currency metadata, never an assumed global scale. */
export type Money = Readonly<{ amountMinor: bigint; currency: string }>;
export type SerializedMoney = Readonly<{ amountMinor: string; currency: string }>;
export type Currency = Readonly<{ code: string; minorUnitExponent: number }>;

const MIN_STORED_MINOR = -(2n ** 63n);
const MAX_STORED_MINOR = 2n ** 63n - 1n;

export function assertCurrencyCode(code: string): string {
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Currency code must be three uppercase letters");
  return code;
}

export function defineCurrency(code: string, minorUnitExponent: number): Currency {
  assertCurrencyCode(code);
  if (!Number.isInteger(minorUnitExponent) || minorUnitExponent < 0 || minorUnitExponent > 9) {
    throw new Error("Currency exponent must be an integer from 0 to 9");
  }
  return { code, minorUnitExponent };
}

export function parseMinor(value: string): bigint {
  if (!/^(0|[1-9]\d*|-[1-9]\d*)$/.test(value)) {
    throw new Error("Minor units must be a canonical integer string");
  }
  return BigInt(value);
}

export function assertStoredMinor(value: bigint): bigint {
  if (typeof value !== "bigint" || value < MIN_STORED_MINOR || value > MAX_STORED_MINOR) {
    throw new Error("Amount is outside PostgreSQL BIGINT range");
  }
  return value;
}

export function money(amountMinor: bigint, currency: string): Money {
  if (typeof amountMinor !== "bigint") throw new Error("Money requires bigint minor units");
  return { amountMinor, currency: assertCurrencyCode(currency) };
}

export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) throw new Error("Currency mismatch");
  return money(left.amountMinor + right.amountMinor, left.currency);
}

export function serializeMoney(value: Money): SerializedMoney {
  return { amountMinor: value.amountMinor.toString(), currency: value.currency };
}

export function deserializeMoney(value: SerializedMoney): Money {
  return money(parseMinor(value.amountMinor), value.currency);
}

export function majorDecimal(value: Money, currency: Currency): string {
  if (value.currency !== currency.code) throw new Error("Currency mismatch");
  const sign = value.amountMinor < 0n ? "-" : "";
  const digits = (value.amountMinor < 0n ? -value.amountMinor : value.amountMinor).toString();
  if (currency.minorUnitExponent === 0) return sign + digits;
  const padded = digits.padStart(currency.minorUnitExponent + 1, "0");
  const split = padded.length - currency.minorUnitExponent;
  return `${sign}${padded.slice(0, split)}.${padded.slice(split)}`;
}
