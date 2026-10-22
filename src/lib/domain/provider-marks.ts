export type ProviderTone = "blue" | "teal" | "amber" | "violet" | "cyan" | "coral" | "emerald";

export type CuratedProviderPreset = Readonly<{
  key: string;
  displayName: string;
  monogram: string;
  classification: "Bank" | "Dompet digital" | "Investasi";
  tone: ProviderTone;
  patterns: readonly RegExp[];
}>;

export type CuratedNetworkPreset = Readonly<{
  key: string;
  displayName: string;
  monogram: string;
  tone: ProviderTone;
  patterns: readonly RegExp[];
}>;

export const CURATED_PROVIDERS: readonly CuratedProviderPreset[] = [
  {
    key: "bca",
    displayName: "Bank Central Asia (BCA)",
    monogram: "BCA",
    classification: "Bank",
    tone: "blue",
    patterns: [/\bbca\b/i, /central\s+asia/i, /\bata\s*bca\b/i],
  },
  {
    key: "bni",
    displayName: "Bank Negara Indonesia (BNI)",
    monogram: "BNI",
    classification: "Bank",
    tone: "teal",
    patterns: [/\bbni\b/i, /negara\s+indonesia/i, /taplus/i],
  },
  {
    key: "mandiri",
    displayName: "Bank Mandiri",
    monogram: "MDR",
    classification: "Bank",
    tone: "amber",
    patterns: [/\bmandiri\b/i, /\blivin\b/i],
  },
  {
    key: "bri",
    displayName: "Bank Rakyat Indonesia (BRI)",
    monogram: "BRI",
    classification: "Bank",
    tone: "blue",
    patterns: [/\bbri\b/i, /rakyat\s+indonesia/i, /\bbrimo\b/i],
  },
  {
    key: "bsi",
    displayName: "Bank Syariah Indonesia (BSI)",
    monogram: "BSI",
    classification: "Bank",
    tone: "teal",
    patterns: [/\bbsi\b/i, /syariah\s+indonesia/i],
  },
  {
    key: "jago",
    displayName: "Bank Jago",
    monogram: "JGO",
    classification: "Bank",
    tone: "amber",
    patterns: [/\bjago\b/i],
  },
  {
    key: "seabank",
    displayName: "SeaBank",
    monogram: "SEA",
    classification: "Bank",
    tone: "coral",
    patterns: [/\bseabank\b/i],
  },
  {
    key: "blu",
    displayName: "blu by BCA Digital",
    monogram: "BLU",
    classification: "Bank",
    tone: "cyan",
    patterns: [/\bblu\b/i, /bca\s+digital/i],
  },
  {
    key: "gopay",
    displayName: "GoPay",
    monogram: "GPY",
    classification: "Dompet digital",
    tone: "cyan",
    patterns: [/\bgopay\b/i],
  },
  {
    key: "ovo",
    displayName: "OVO",
    monogram: "OVO",
    classification: "Dompet digital",
    tone: "violet",
    patterns: [/\bovo\b/i],
  },
  {
    key: "dana",
    displayName: "DANA",
    monogram: "DNA",
    classification: "Dompet digital",
    tone: "blue",
    patterns: [/\bdana\b/i],
  },
  {
    key: "shopeepay",
    displayName: "ShopeePay",
    monogram: "SPY",
    classification: "Dompet digital",
    tone: "coral",
    patterns: [/\bshopeepay\b/i, /\bspay\b/i],
  },
  {
    key: "linkaja",
    displayName: "LinkAja",
    monogram: "LNK",
    classification: "Dompet digital",
    tone: "coral",
    patterns: [/\blink\s*aja\b/i],
  },
  {
    key: "emoney",
    displayName: "e-Money / Flazz",
    monogram: "EMN",
    classification: "Dompet digital",
    tone: "amber",
    patterns: [/\be[\s-]*money\b/i, /\bflazz\b/i, /\bbrizzi\b/i, /\btapcash\b/i],
  },
  {
    key: "bibit",
    displayName: "Bibit",
    monogram: "BBT",
    classification: "Investasi",
    tone: "emerald",
    patterns: [/\bbibit\b/i],
  },
  {
    key: "ajaib",
    displayName: "Ajaib",
    monogram: "AJB",
    classification: "Investasi",
    tone: "blue",
    patterns: [/\bajaib\b/i],
  },
  {
    key: "stockbit",
    displayName: "Stockbit",
    monogram: "STB",
    classification: "Investasi",
    tone: "teal",
    patterns: [/\bstockbit\b/i],
  },
  {
    key: "bareksa",
    displayName: "Bareksa",
    monogram: "BRK",
    classification: "Investasi",
    tone: "emerald",
    patterns: [/\bbareksa\b/i],
  },
  {
    key: "pluang",
    displayName: "Pluang",
    monogram: "PLG",
    classification: "Investasi",
    tone: "violet",
    patterns: [/\bpluang\b/i],
  },
  {
    key: "pintu",
    displayName: "Pintu",
    monogram: "PNT",
    classification: "Investasi",
    tone: "violet",
    patterns: [/\bpintu\b/i],
  },
];

export const CURATED_PAYMENT_NETWORKS: readonly CuratedNetworkPreset[] = [
  { key: "gpn", displayName: "GPN (Gerbang Pembayaran Nasional)", monogram: "GPN", tone: "coral", patterns: [/\bgpn\b/i] },
  { key: "visa", displayName: "Visa", monogram: "VISA", tone: "blue", patterns: [/\bvisa\b/i] },
  { key: "mastercard", displayName: "Mastercard", monogram: "MC", tone: "amber", patterns: [/\bmaster\s*card\b/i] },
  { key: "qris", displayName: "QRIS", monogram: "QRIS", tone: "teal", patterns: [/\bqris\b/i] },
  { key: "jcb", displayName: "JCB", monogram: "JCB", tone: "cyan", patterns: [/\bjcb\b/i] },
];

export type ResolvedProviderMark = Readonly<{
  monogram: string;
  tone: ProviderTone;
  matchedKey: string | null;
  inferredProviderName: string | null;
}>;

function fallbackMonogram(label: string): string {
  const cleaned = label.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
  if (!cleaned) return "•";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  if (words[0].toLowerCase() === "bank" && words[1]) {
    return words[1].slice(0, 3).toUpperCase();
  }
  return words
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export function resolveProviderMark(
  providerName?: string | null,
  assetDisplayName?: string | null,
  fallbackTone: ProviderTone = "blue",
): ResolvedProviderMark {
  const candidates = [providerName ?? "", assetDisplayName ?? ""].filter(Boolean);
  for (const text of candidates) {
    for (const preset of CURATED_PROVIDERS) {
      if (preset.patterns.some((re) => re.test(text))) {
        return {
          monogram: preset.monogram,
          tone: preset.tone,
          matchedKey: preset.key,
          inferredProviderName: preset.displayName,
        };
      }
    }
    for (const net of CURATED_PAYMENT_NETWORKS) {
      if (net.patterns.some((re) => re.test(text))) {
        return {
          monogram: net.monogram,
          tone: net.tone,
          matchedKey: net.key,
          inferredProviderName: null,
        };
      }
    }
  }
  const combined = candidates.join(" ");
  if (/\b(cash|tunai|dompet\s+tunai)\b/i.test(combined)) {
    return { monogram: "KAS", tone: "teal", matchedKey: "cash", inferredProviderName: null };
  }
  if (/\b(rdpu|sbn|obligasi|reksa\s*dana|gold|emas|equity|saham|index)\b/i.test(combined)) {
    return {
      monogram: fallbackMonogram(assetDisplayName || providerName || "INV"),
      tone: "violet",
      matchedKey: "investment",
      inferredProviderName: null,
    };
  }
  return {
    monogram: fallbackMonogram(providerName || assetDisplayName || "A"),
    tone: fallbackTone,
    matchedKey: null,
    inferredProviderName: null,
  };
}

