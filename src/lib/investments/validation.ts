import { assertUuid, validateCatalogName } from "@/lib/domain/catalog";
import { decimal, decimalString, storedMoney, InvestmentError } from "@/lib/investments/math";
import type { OpeningDraft, TradeDraft } from "./types";
export function text(raw: unknown, max = 120): string {
  if (typeof raw !== "string" || raw.length > max) throw new InvestmentError("Teks tidak valid.");
  return raw.trim();
}
export function optionalText(raw: unknown, max = 1000): string | null {
  return raw === undefined || raw === null || raw === "" ? null : text(raw, max) || null;
}
export function timestamp(raw: unknown): string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) throw new InvestmentError("Waktu tidak valid.");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== raw) throw new InvestmentError("Waktu tidak valid.");
  return raw;
}
export function uuid(raw: unknown): string { return assertUuid(text(raw, 36)); }
export function name(raw: unknown): string { return validateCatalogName(text(raw)); }
function eventTimestamp(raw: unknown): string {
  const value = timestamp(raw);
  if (value > new Date().toISOString()) throw new InvestmentError("Posisi dan transaksi tidak boleh bertanggal masa depan.");
  return value;
}
export function tradeDraft(raw: TradeDraft): TradeDraft {
  if (!raw || !["buy", "sell"].includes(raw.kind)) throw new InvestmentError("Jenis transaksi investasi tidak valid.");
  return { kind: raw.kind, portfolioId: uuid(raw.portfolioId), instrumentId: uuid(raw.instrumentId), cashAssetId: uuid(raw.cashAssetId),
    quantity: decimalString(decimal(raw.quantity)), unitPrice: decimalString(decimal(raw.unitPrice)),
    feeMinor: storedMoney(raw.feeMinor).toString(), occurredAt: eventTimestamp(raw.occurredAt), note: optionalText(raw.note) ?? undefined };
}
export function openingDraft(raw: OpeningDraft): OpeningDraft {
  if (!raw) throw new InvestmentError("Posisi awal tidak valid.");
  return { portfolioId: uuid(raw.portfolioId), instrumentId: uuid(raw.instrumentId), quantity: decimalString(decimal(raw.quantity)),
    costBasisMinor: storedMoney(raw.costBasisMinor).toString(), occurredAt: eventTimestamp(raw.occurredAt),
    initialPrice: raw.initialPrice ? decimalString(decimal(raw.initialPrice)) : undefined };
}
