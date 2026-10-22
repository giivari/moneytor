export type CurrencyOption = { code: string; minorUnitExponent: number };

export function formatMinor(value: string | bigint, currency: string, exponent = 0): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const scale = 10n ** BigInt(exponent);
  const whole = new Intl.NumberFormat("id-ID").format(absolute / scale);
  const fraction = exponent ? `,${(absolute % scale).toString().padStart(exponent, "0")}` : "";
  return `${negative ? "−" : ""}${currency === "IDR" ? "Rp" : currency + " "}${whole}${fraction}`;
}

export function inputToMinor(raw: string, exponent: number): string {
  const cleaned = raw.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) throw new Error("Masukkan jumlah yang valid.");
  const [whole, fraction = ""] = cleaned.split(".");
  if (fraction.length > exponent) throw new Error(`Maksimal ${exponent} angka desimal untuk mata uang ini.`);
  return (BigInt(whole) * 10n ** BigInt(exponent) + BigInt(fraction.padEnd(exponent, "0") || "0")).toString();
}

export function minorToInput(raw: string, exponent: number): string {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(exponent);
  return exponent ? `${value / scale}.${(value % scale).toString().padStart(exponent, "0")}` : value.toString();
}
