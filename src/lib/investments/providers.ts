import "server-only";
import { decimal, decimalString, InvestmentError, roundRatio, SCALE } from "@/lib/investments/math";
import { name, text, timestamp } from "@/lib/investments/validation";
import type { Instrument } from "./types";

export type MarketQuote = { instrumentId: string; price: string; currency: string; asOf: string; sourceId: string };
export interface MarketPriceProvider { id: string; fetchQuote(instrument: Instrument): Promise<MarketQuote> }

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const providers = new Map<string, MarketPriceProvider>();
let customFetch: FetchLike | null = null;

export function setMarketPriceFetchForTest(fn: FetchLike | null) {
  customFetch = fn;
}

function activeFetch(): FetchLike {
  const fn = customFetch ?? globalThis.fetch;
  if (typeof fn !== "function") throw new InvestmentError("Layanan jaringan penyedia harga tidak tersedia.");
  return fn;
}

function timeoutSignal(): AbortSignal {
  const raw = Number(process.env.MONETA_PRICE_TIMEOUT_MS ?? "8000");
  const ms = Number.isFinite(raw) && raw >= 500 && raw <= 30000 ? Math.trunc(raw) : 8000;
  return AbortSignal.timeout(ms);
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  let response: Response;
  try {
    response = await activeFetch()(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      cache: "no-store",
      signal: timeoutSignal(),
    });
  } catch {
    throw new InvestmentError("Gagal menghubungi penyedia harga pasar. Gunakan harga manual atau coba lagi.");
  }
  if (!response.ok) {
    throw new InvestmentError(`Penyedia harga menolak permintaan (HTTP ${response.status}). Gunakan harga manual.`);
  }
  try {
    return await response.json();
  } catch {
    throw new InvestmentError("Format respons penyedia harga tidak valid.");
  }
}

function plainDecimalString(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) throw new InvestmentError("Harga dari penyedia tidak valid.");
    // Shortest round-trip form ("0.1"), not the binary expansion toFixed(18) would store; exponent forms are expanded.
    const plain = String(raw);
    const fixed = /e/i.test(plain) ? raw.toFixed(18).replace(/\.?0+$/, "") : plain;
    return fixed || "0";
  }
  throw new InvestmentError("Harga dari penyedia tidak tersedia.");
}

function clampNotFuture(iso: string): string {
  const now = new Date().toISOString();
  // Remote provider clocks within 60 seconds ahead of local clock are clamped to now; further future timestamps are rejected.
  if (iso > now) {
    const diffMs = new Date(iso).getTime() - new Date(now).getTime();
    if (diffMs <= 60_000) return now;
    throw new InvestmentError("Harga saat ini tidak boleh berasal dari masa depan.");
  }
  return iso;
}

export function normalizeQuote(
  instrument: Instrument,
  raw: { price: unknown; currency?: unknown; asOf?: unknown; sourceId: string },
): MarketQuote {
  const sourceId = name(raw.sourceId);
  if (!/^[a-z][a-z0-9_-]{0,79}$/.test(sourceId)) throw new InvestmentError("Identitas penyedia harga tidak valid.");
  const price = decimalString(decimal(plainDecimalString(raw.price)));
  const currency = raw.currency !== undefined && raw.currency !== null && String(raw.currency).trim() !== ""
    ? text(String(raw.currency).trim().toUpperCase(), 3)
    : instrument.currency;
  if (currency !== instrument.currency) {
    throw new InvestmentError(`Mata uang kuotasi (${currency}) tidak sesuai dengan instrumen (${instrument.currency}).`);
  }
  let asOf: string;
  if (raw.asOf === undefined || raw.asOf === null || String(raw.asOf).trim() === "") {
    asOf = new Date().toISOString();
  } else if (typeof raw.asOf === "number" && Number.isFinite(raw.asOf) && raw.asOf > 0) {
    const ms = raw.asOf < 1e12 ? Math.trunc(raw.asOf * 1000) : Math.trunc(raw.asOf);
    asOf = clampNotFuture(timestamp(new Date(ms).toISOString()));
  } else {
    const str = String(raw.asOf).trim();
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(str) ? `${str}T00:00:00.000Z` : str;
    asOf = clampNotFuture(timestamp(normalized));
  }
  return { instrumentId: instrument.id, price, currency, asOf, sourceId };
}

function extractReference(instrument: Instrument, expectedPrefix?: string): string {
  const raw = (instrument.priceSymbol ?? instrument.symbol ?? "").trim();
  if (!raw) throw new InvestmentError("Instrumen belum memiliki simbol atau referensi penyedia harga.");
  if (expectedPrefix && raw.toLowerCase().startsWith(`${expectedPrefix.toLowerCase()}:`)) {
    const stripped = raw.slice(expectedPrefix.length + 1).trim();
    if (!stripped) throw new InvestmentError("Referensi simbol penyedia harga kosong.");
    return stripped;
  }
  return raw;
}

const coingeckoProvider: MarketPriceProvider = {
  id: "coingecko",
  async fetchQuote(instrument: Instrument): Promise<MarketQuote> {
    const coinId = extractReference(instrument, "coingecko").toLowerCase();
    const vsCurrency = instrument.currency.toLowerCase();
    const baseUrl = (process.env.MONETA_COINGECKO_BASE_URL ?? "https://api.coingecko.com/api/v3").replace(/\/+$/, "");
    const headers: Record<string, string> = {};
    if (process.env.MONETA_COINGECKO_API_KEY) {
      headers["x-cg-demo-api-key"] = process.env.MONETA_COINGECKO_API_KEY.trim();
    }
    const url = `${baseUrl}/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=${encodeURIComponent(vsCurrency)}&include_last_updated_at=true&precision=full`;
    const data = await fetchJson(url, headers) as Record<string, Record<string, unknown> | undefined>;
    const entry = data?.[coinId];
    if (!entry || entry[vsCurrency] === undefined) {
      throw new InvestmentError(`Kuotasi CoinGecko untuk '${coinId}' (${instrument.currency}) tidak ditemukan.`);
    }
    return normalizeQuote(instrument, {
      price: entry[vsCurrency],
      currency: instrument.currency,
      asOf: entry.last_updated_at,
      sourceId: "coingecko",
    });
  },
};

const twelveDataProvider: MarketPriceProvider = {
  id: "twelvedata",
  async fetchQuote(instrument: Instrument): Promise<MarketQuote> {
    const apiKey = (process.env.MONETA_TWELVEDATA_API_KEY ?? process.env.MONETA_PRICE_API_KEY ?? "").trim();
    if (!apiKey) throw new InvestmentError("API key Twelve Data belum dikonfigurasi di server.");
    const symbol = extractReference(instrument, "twelvedata");
    const ticker = !symbol.includes(":") && instrument.market ? `${symbol}:${instrument.market}` : symbol;
    const baseUrl = (process.env.MONETA_TWELVEDATA_BASE_URL ?? "https://api.twelvedata.com").replace(/\/+$/, "");
    const url = `${baseUrl}/quote?symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(apiKey)}`;
    const data = await fetchJson(url) as Record<string, unknown>;
    if (data?.status === "error" || (!data?.close && !data?.price)) {
      throw new InvestmentError(`Kuotasi Twelve Data untuk '${ticker}' tidak tersedia.`);
    }
    return normalizeQuote(instrument, {
      price: data.close ?? data.price,
      currency: data.currency ?? instrument.currency,
      asOf: typeof data.timestamp === "number" ? data.timestamp : data.datetime,
      sourceId: "twelvedata",
    });
  },
};

const alphaVantageProvider: MarketPriceProvider = {
  id: "alphavantage",
  async fetchQuote(instrument: Instrument): Promise<MarketQuote> {
    const apiKey = (process.env.MONETA_ALPHAVANTAGE_API_KEY ?? process.env.MONETA_PRICE_API_KEY ?? "").trim();
    if (!apiKey) throw new InvestmentError("API key Alpha Vantage belum dikonfigurasi di server.");
    const symbol = extractReference(instrument, "alphavantage");
    const baseUrl = (process.env.MONETA_ALPHAVANTAGE_BASE_URL ?? "https://www.alphavantage.co").replace(/\/+$/, "");
    const url = `${baseUrl}/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
    const data = await fetchJson(url) as { "Global Quote"?: Record<string, string> };
    const quote = data?.["Global Quote"];
    const price = quote?.["05. price"];
    if (!price) throw new InvestmentError(`Kuotasi Alpha Vantage untuk '${symbol}' tidak tersedia.`);
    return normalizeQuote(instrument, {
      price,
      currency: instrument.currency,
      asOf: quote?.["07. latest trading day"],
      sourceId: "alphavantage",
    });
  },
};

const httpJsonProvider: MarketPriceProvider = {
  id: "http-json",
  async fetchQuote(instrument: Instrument): Promise<MarketQuote> {
    const endpoint = (process.env.MONETA_PRICE_PROVIDER_URL ?? "").trim();
    if (!endpoint) throw new InvestmentError("URL penyedia harga HTTP JSON belum dikonfigurasi.");
    const rawRef = extractReference(instrument);
    const symbol = rawRef.replace(/^(?:http-json|http):/i, "").trim();
    if (!symbol) throw new InvestmentError("Referensi simbol penyedia harga kosong.");
    const target = new URL(endpoint);
    target.searchParams.set("symbol", symbol);
    target.searchParams.set("currency", instrument.currency);
    target.searchParams.set("instrumentId", instrument.id);
    if (instrument.market) target.searchParams.set("market", instrument.market);
    const headers: Record<string, string> = {};
    if (process.env.MONETA_PRICE_PROVIDER_TOKEN) {
      headers.Authorization = `Bearer ${process.env.MONETA_PRICE_PROVIDER_TOKEN.trim()}`;
    }
    const data = await fetchJson(target.toString(), headers) as Record<string, unknown>;
    if (!data || typeof data !== "object" || data.price === undefined) {
      throw new InvestmentError("Respons penyedia harga HTTP JSON tidak memiliki nilai price.");
    }
    return normalizeQuote(instrument, {
      price: data.price,
      currency: data.currency ?? instrument.currency,
      asOf: data.asOf ?? data.timestamp,
      sourceId: "http-json",
    });
  },
};

const SUBUNIT_CURRENCIES = new Set(["GBX", "ILA", "ZAC"]);
const TROY_OUNCE_GRAMS_E7 = 311034768n; // 31.1034768 gram per troy ounce, skala 1e7

function yahooBaseUrl(): string {
  return (process.env.MONETA_YAHOO_BASE_URL ?? "https://query1.finance.yahoo.com").replace(/\/+$/, "");
}

type YahooMeta = { price: string; currency: string | undefined; time: number | undefined };

async function yahooMeta(symbol: string): Promise<YahooMeta> {
  if (!/^[A-Za-z0-9.^=_-]{1,32}$/.test(symbol)) throw new InvestmentError("Simbol Yahoo tidak valid.");
  const url = `${yahooBaseUrl()}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const data = await fetchJson(url, { "User-Agent": "Mozilla/5.0 (compatible; moneytor-price-refresh/1.0)" }) as
    { chart?: { result?: { meta?: Record<string, unknown> }[] | null; error?: unknown } };
  const meta = data?.chart?.result?.[0]?.meta;
  if (data?.chart?.error || !meta) throw new InvestmentError(`Kuotasi Yahoo untuk '${symbol}' tidak tersedia.`);
  const raw = meta.regularMarketPrice;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) throw new InvestmentError(`Kuotasi Yahoo untuk '${symbol}' tidak tersedia.`);
  const hint = typeof meta.priceHint === "number" && Number.isInteger(meta.priceHint) && meta.priceHint >= 0 && meta.priceHint <= 8 ? meta.priceHint : 8;
  // Buang noise float (182.52999877929688) sesuai presisi kuotasi bursa.
  const price = raw.toFixed(hint);
  if (!(Number(price) > 0)) throw new InvestmentError(`Kuotasi Yahoo untuk '${symbol}' tidak tersedia.`);
  const currency = typeof meta.currency === "string" && meta.currency.trim() ? meta.currency.trim() : undefined;
  const time = typeof meta.regularMarketTime === "number" && meta.regularMarketTime > 0 ? meta.regularMarketTime : undefined;
  return { price, currency, time };
}

const reksadanaProvider: MarketPriceProvider = {
  id: "reksadana",
  async fetchQuote(instrument: Instrument): Promise<MarketQuote> {
    const fundId = extractReference(instrument, "reksadana").toUpperCase();
    if (!/^(RD|BRK|KTN|MKR)\d{1,10}$/.test(fundId)) throw new InvestmentError("ID reksa dana tidak valid (contoh: reksadana:RD1669).");
    const baseUrl = (process.env.MONETA_REKSADANA_BASE_URL ?? "https://reksadana.risanb.com").replace(/\/+$/, "");
    const data = await fetchJson(`${baseUrl}/api/funds/${fundId}.json`) as {
      fund?: Record<string, unknown>;
      nav?: { date?: unknown; nav?: unknown }[];
      history?: { nav?: { date?: unknown; value?: unknown }[] };
    };
    // `fund` hanya data statis. NAB terbaru ada di history.nav (gabungan sumber, paling segar) dan nav (Bibit); ambil tanggal terbaru.
    const points: { date: string; value: number }[] = [];
    const collect = (date: unknown, value: unknown) => {
      if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof value === "number" && Number.isFinite(value) && value > 0) points.push({ date, value });
    };
    for (const p of Array.isArray(data?.history?.nav) ? data.history.nav : []) collect(p?.date, p?.value);
    for (const p of Array.isArray(data?.nav) ? data.nav : []) collect(p?.date, p?.nav);
    let latest: { date: string; value: number } | undefined;
    for (const p of points) if (!latest || p.date > latest.date) latest = p;
    if (!latest) throw new InvestmentError(`NAB reksa dana '${fundId}' belum tersedia.`);
    return normalizeQuote(instrument, {
      price: latest.value,
      currency: data.fund?.currency ?? instrument.currency,
      asOf: latest.date,
      sourceId: "reksadana",
    });
  },
};

const yahooProvider: MarketPriceProvider = {
  id: "yahoo",
  async fetchQuote(instrument: Instrument): Promise<MarketQuote> {
    const symbol = extractReference(instrument, "yahoo");
    const meta = await yahooMeta(symbol);
    if (meta.currency && (meta.currency !== meta.currency.toUpperCase() || SUBUNIT_CURRENCIES.has(meta.currency.toUpperCase()))) {
      throw new InvestmentError(`Yahoo menyajikan '${symbol}' dalam satuan sen/subunit (${meta.currency}); gunakan harga manual.`);
    }
    return normalizeQuote(instrument, { price: meta.price, currency: meta.currency ?? instrument.currency, asOf: meta.time, sourceId: "yahoo" });
  },
};

const goldProvider: MarketPriceProvider = {
  id: "gold",
  async fetchQuote(instrument: Instrument): Promise<MarketQuote> {
    const ref = extractReference(instrument, "gold").toUpperCase();
    const target = ref === "GRAM" ? instrument.currency : ref;
    if (target !== "IDR" && target !== "USD") throw new InvestmentError("Referensi emas harus gold:gram, gold:IDR, atau gold:USD.");
    // GC=F = futures COMEX (USD per troy ounce), dipakai sebagai proksi harga spot.
    const xau = await yahooMeta("GC=F");
    let fxScaled = SCALE;
    let asOf = xau.time;
    if (target === "IDR") {
      const fx = await yahooMeta("USDIDR=X");
      fxScaled = decimal(fx.price);
      if (fx.time !== undefined) asOf = asOf === undefined ? fx.time : Math.min(asOf, fx.time);
    }
    // Harga per gram dengan 6 desimal: xau * kurs / 31,1034768.
    const perGram6 = roundRatio(decimal(xau.price) * fxScaled * 10n ** 13n, TROY_OUNCE_GRAMS_E7 * SCALE * SCALE);
    if (perGram6 <= 0n) throw new InvestmentError("Harga emas per gram tidak valid.");
    return normalizeQuote(instrument, { price: decimalString(perGram6 * 10n ** 12n), currency: target, asOf, sourceId: "gold" });
  },
};

const compositeProvider: MarketPriceProvider = {
  id: "composite",
  async fetchQuote(instrument: Instrument): Promise<MarketQuote> {
    const rawRef = (instrument.priceSymbol ?? "").trim();
    const prefixMatch = /^([a-z][a-z0-9_-]{0,79}):(.+)$/i.exec(rawRef);
    let adapterId: string;
    if (prefixMatch) {
      const candidate = prefixMatch[1].toLowerCase();
      adapterId = candidate === "http" ? "http-json" : candidate;
    } else {
      const fallback = (process.env.MONETA_PRICE_DEFAULT_ADAPTER ?? "").trim().toLowerCase();
      if (!fallback || fallback === "composite") {
        throw new InvestmentError("Tambahkan prefix penyedia pada referensi harga instrumen (mis. reksadana:RD1669, yahoo:BBCA.JK, coingecko:bitcoin, gold:gram, twelvedata:BBCA, atau http:SIMBOL).");
      }
      adapterId = fallback === "http" ? "http-json" : fallback;
    }
    if (adapterId === "composite") throw new InvestmentError("Delegasi penyedia harga komposit tidak valid.");
    const delegate = providers.get(adapterId);
    if (!delegate) throw new InvestmentError(`Penyedia harga '${adapterId}' tidak terdaftar.`);
    const quote = await delegate.fetchQuote(instrument);
    if (quote.instrumentId !== instrument.id || quote.sourceId !== delegate.id) {
      throw new InvestmentError("Referensi harga tidak sesuai.");
    }
    return quote;
  },
};

function registerBuiltInProviders() {
  for (const builtin of [coingeckoProvider, twelveDataProvider, alphaVantageProvider, httpJsonProvider, reksadanaProvider, yahooProvider, goldProvider, compositeProvider]) {
    providers.set(builtin.id, builtin);
  }
}
registerBuiltInProviders();

export function registerMarketPriceProvider(provider: MarketPriceProvider) {
  if (!/^[a-z][a-z0-9_-]{0,79}$/.test(provider.id) || providers.has(provider.id)) throw new Error("Invalid price provider");
  providers.set(provider.id, provider);
}

export function isRegisteredPriceProvider(id: string): boolean {
  return providers.has(id);
}

export function configuredPriceProvider(): MarketPriceProvider | null {
  const configured = (process.env.MONETA_PRICE_PROVIDER ?? "").trim();
  return providers.get(configured) ?? null;
}
