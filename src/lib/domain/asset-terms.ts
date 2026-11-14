const ANY_META_TAG_RE = /^(?:\[(?:CREDIT|ACCT)(?::[^\]]*)?\]\s*)+/i;
const ACCT_TAG_RE = /\[ACCT(?::([^\]]*))?\]/i;

export type InterestCycle = "monthly" | "daily" | "maturity";

export type AssetTerms = Readonly<{
  hasTerms: boolean;
  adminFeeMinor: bigint;
  adminDay: number; // 0 = akhir bulan, 1..28 = tanggal bulanan
  autoPostAdminFee: boolean;
  interestRateBps: number; // 100 bps = 1.00% p.a.
  interestTaxBps: number; // default 2000 = 20.00%
  interestCycle: InterestCycle;
  interestDay: number; // 0 = akhir bulan, 1..28 = tanggal cair
  adminRuleId: string | null;
  cleanNote: string;
}>;

export type AssetMonthlyYieldEstimate = Readonly<{
  grossMonthlyMinor: bigint;
  taxMonthlyMinor: bigint;
  netInterestMonthlyMinor: bigint;
  netInterestAnnualMinor: bigint;
  netAfterAdminMonthlyMinor: bigint;
}>;

function clampMonthDay(n: number, fallback: number): number {
  if (n === 0) return 0;
  return Number.isInteger(n) && n >= 1 && n <= 28 ? n : fallback;
}

function clampBps(n: number, max = 100000): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(max, Math.round(n));
}

function parseNonNegativeBigInt(raw?: string | null): bigint {
  if (!raw) return 0n;
  try {
    const val = BigInt(raw);
    return val > 0n ? val : 0n;
  } catch {
    return 0n;
  }
}

export function stripAssetMetaTags(note?: string | null): string {
  const raw = (note ?? "").trim();
  return raw.replace(ANY_META_TAG_RE, "").trim();
}

export function parseBpsInput(raw: string, maxPercent = 100): number {
  const cleaned = raw.trim().replace(",", ".");
  if (!cleaned) return 0;
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    throw new Error("Persentase maksimal 2 angka desimal (mis. 3,5 atau 6).");
  }
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0 || num > maxPercent) {
    throw new Error(`Persentase harus di antara 0 dan ${maxPercent}%.`);
  }
  return Math.round(num * 100);
}

export function bpsToInput(bps: number): string {
  if (!bps || bps <= 0) return "";
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return String(whole);
  if (frac % 10 === 0) return `${whole},${frac / 10}`;
  return `${whole},${String(frac).padStart(2, "0")}`;
}

export function formatBpsRate(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return `${whole}%`;
  if (frac % 10 === 0) return `${whole},${frac / 10}%`;
  return `${whole},${String(frac).padStart(2, "0")}%`;
}

export function parseAssetTerms(note?: string | null): AssetTerms {
  const raw = (note ?? "").trim();
  const cleanNote = stripAssetMetaTags(raw);
  const prefixSlice = raw.slice(0, raw.length - cleanNote.length);
  const match = prefixSlice.match(ACCT_TAG_RE);

  if (!match) {
    return {
      hasTerms: false,
      adminFeeMinor: 0n,
      adminDay: 0,
      autoPostAdminFee: false,
      interestRateBps: 0,
      interestTaxBps: 2000,
      interestCycle: "monthly",
      interestDay: 0,
      adminRuleId: null,
      cleanNote,
    };
  }

  const params = new Map<string, string>();
  for (const part of (match[1] ?? "").split(",")) {
    const [k, v] = part.split("=");
    if (k && v !== undefined) {
      params.set(k.trim().toLowerCase(), v.trim());
    }
  }

  const adminFeeMinor = parseNonNegativeBigInt(params.get("adm"));
  const adminDay = clampMonthDay(Number(params.get("aday") ?? 0), 0);
  const autoPostAdminFee = params.get("aauto") === "1";
  const interestRateBps = clampBps(Number(params.get("rate") ?? 0), 100000);
  const rawTax = params.get("tax");
  const interestTaxBps = rawTax !== undefined ? clampBps(Number(rawTax), 10000) : 2000;
  const rawCycle = params.get("icyc");
  const interestCycle: InterestCycle =
    rawCycle === "daily" || rawCycle === "maturity" ? rawCycle : "monthly";
  const interestDay = clampMonthDay(Number(params.get("iday") ?? 0), 0);
  const rawRuleId = params.get("arule") ?? "";
  const adminRuleId = /^[0-9a-f-]{36}$/i.test(rawRuleId) ? rawRuleId : null;

  return {
    hasTerms: adminFeeMinor > 0n || interestRateBps > 0 || adminRuleId !== null,
    adminFeeMinor,
    adminDay,
    autoPostAdminFee,
    interestRateBps,
    interestTaxBps,
    interestCycle,
    interestDay,
    adminRuleId,
    cleanNote,
  };
}

export function encodeAssetTermsNote(
  cleanNote: string,
  options?: {
    adminFeeMinor?: bigint;
    adminDay?: number;
    autoPostAdminFee?: boolean;
    interestRateBps?: number;
    interestTaxBps?: number;
    interestCycle?: InterestCycle;
    interestDay?: number;
    adminRuleId?: string | null;
  },
): string | undefined {
  const stripped = stripAssetMetaTags(cleanNote);
  const adm = options?.adminFeeMinor && options.adminFeeMinor > 0n ? options.adminFeeMinor : 0n;
  const rate = clampBps(options?.interestRateBps ?? 0, 100000);
  const arule = options?.adminRuleId && /^[0-9a-f-]{36}$/i.test(options.adminRuleId) ? options.adminRuleId : null;

  if (adm === 0n && rate === 0 && !arule) {
    return stripped || undefined;
  }

  const aday = clampMonthDay(options?.adminDay ?? 0, 0);
  const aauto = adm > 0n && options?.autoPostAdminFee ? 1 : 0;
  const tax = clampBps(options?.interestTaxBps ?? 2000, 10000);
  const icyc: InterestCycle =
    options?.interestCycle === "daily" || options?.interestCycle === "maturity"
      ? options.interestCycle
      : "monthly";
  const iday = clampMonthDay(options?.interestDay ?? 0, 0);

  const kv: string[] = [];
  if (adm > 0n) {
    kv.push(`adm=${adm.toString()}`, `aday=${aday}`, `aauto=${aauto}`);
  }
  if (rate > 0) {
    kv.push(`rate=${rate}`, `tax=${tax}`, `icyc=${icyc}`);
    if (icyc === "monthly") kv.push(`iday=${iday}`);
  }
  if (arule) kv.push(`arule=${arule}`);

  const prefix = `[ACCT:${kv.join(",")}]`;
  return stripped ? `${prefix} ${stripped}` : prefix;
}

export function estimateAssetMonthlyYield(
  balanceMinor: bigint,
  terms: Pick<AssetTerms, "adminFeeMinor" | "interestRateBps" | "interestTaxBps">,
): AssetMonthlyYieldEstimate {
  const positiveBalance = balanceMinor > 0n ? balanceMinor : 0n;
  const rateBps = BigInt(Math.max(0, terms.interestRateBps));
  const taxBps = BigInt(Math.max(0, Math.min(10000, terms.interestTaxBps)));

  const grossAnnualMinor = (positiveBalance * rateBps) / 10000n;
  const taxAnnualMinor = (grossAnnualMinor * taxBps) / 10000n;
  const netInterestAnnualMinor = grossAnnualMinor - taxAnnualMinor;

  // Monthly figures derive from the annual ones, so 12 x monthly net never drifts above the annual net.
  const grossMonthlyMinor = grossAnnualMinor / 12n;
  const netInterestMonthlyMinor = netInterestAnnualMinor / 12n;
  const taxMonthlyMinor = grossMonthlyMinor - netInterestMonthlyMinor;
  const netAfterAdminMonthlyMinor = netInterestMonthlyMinor - terms.adminFeeMinor;

  return {
    grossMonthlyMinor,
    taxMonthlyMinor,
    netInterestMonthlyMinor,
    netInterestAnnualMinor,
    netAfterAdminMonthlyMinor,
  };
}

export function formatAdminScheduleLabel(day: number): string {
  return day === 0 ? "Akhir bulan" : `Tgl ${day}`;
}

export function formatInterestCycleLabel(cycle: InterestCycle, day: number): string {
  if (cycle === "daily") return "Cair harian";
  if (cycle === "maturity") return "Saat jatuh tempo";
  return day === 0 ? "Bulanan (akhir bulan)" : `Bulanan (tgl ${day})`;
}

