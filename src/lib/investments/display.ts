/** Presentation only. The exact decimal string remains authoritative for calculations. */
export function formatQuantity(raw: string): string {
  if (!/^-?\d+(?:\.\d{1,18})?$/.test(raw)) throw new Error("Invalid decimal display value");
  const [whole, fraction = ""] = raw.split(".");
  const grouped = new Intl.NumberFormat("id-ID").format(BigInt(whole));
  const digits = fraction.replace(/0+$/, "");
  return grouped + (digits ? `,${digits}` : "");
}

export function formatInvestmentPrice(raw: string, currency: string, exponent: number): string {
  if (!/^\d+(?:\.\d{1,18})?$/.test(raw)) throw new Error("Invalid price display value");
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 9) throw new Error("Invalid currency exponent");
  const [whole, fraction = ""] = raw.split(".");
  const scaled = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0") || "0");
  const basePrecision = Math.max(2, exponent + 2);
  let precision = basePrecision;
  // A sub-cent average must not be rendered as zero. Preserve enough digits to show it.
  while (precision < 18 && scaled > 0n && (scaled + 10n ** BigInt(18 - precision) / 2n) / 10n ** BigInt(18 - precision) === 0n) precision++;
  const divisor = 10n ** BigInt(18 - precision);
  const rounded = (scaled + divisor / 2n) / divisor;
  const formattedWhole = new Intl.NumberFormat("id-ID").format(rounded / 10n ** BigInt(precision));
  const formattedFraction = (rounded % 10n ** BigInt(precision)).toString().padStart(precision, "0");
  return `${currency === "IDR" ? "Rp" : `${currency} `}${formattedWhole},${formattedFraction}`;
}
