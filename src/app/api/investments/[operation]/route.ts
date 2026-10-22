import { NextRequest, NextResponse } from "next/server";
import { assertRequestOrigin, boundedBody } from "@/lib/auth/http";
import { currentOwnerSession } from "@/lib/auth/session";
import { restoreInvestment, deleteInvestment, correctManualPrice, correctInvestmentOpening, archiveInvestment, createInstrument, createInstrumentType, createOpeningPosition, createPortfolio, postInvestmentTrade, refreshMarketPrice, replaceInvestmentTrade, saveMarketPrice, updateInvestmentMetadata, voidInvestmentTrade } from "@/lib/investments/service";
import { text } from "@/lib/investments/validation";
import type { OpeningDraft, TradeDraft } from "@/lib/investments/types";
import { LifecycleError } from "@/lib/repositories/lifecycle";
import { InvestmentError } from "@/lib/investments/math";
import { investmentOpeningHistory } from "@/lib/investments/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: Promise<{ operation: string }> }) {
  const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  if ((await params).operation !== "opening-history") return json({ error: "Tidak tersedia." }, 404);
  if (!await currentOwnerSession()) return json({ error: "Sesi berakhir. Buka ulang dengan passkey." }, 401);
  try { return json({ corrections: await investmentOpeningHistory(text(request.nextUrl.searchParams.get("id"), 36)) }); }
  catch { return json({ error: "Riwayat koreksi belum dapat dimuat." }, 400); }
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ operation: string }> }) {
  const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  try {
    assertRequestOrigin(request);
    if (!await currentOwnerSession()) return json({ error: "Sesi berakhir. Buka ulang dengan passkey." }, 401);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Invalid content type");
    const body = JSON.parse(await boundedBody(request));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
    const { operation } = await params;
    let id: string;
    switch (operation) {
      case "portfolio-create": id = await createPortfolio(body); break;
      case "instrument-create": id = await createInstrument(body); break;
      case "type-create": id = await createInstrumentType(body.displayName); break;
      case "rename": id = await updateInvestmentMetadata(body.kind, text(body.id, 36), body.displayName, body.kind === "instrument" && ("symbol" in body || "market" in body || "priceSymbol" in body) ? { symbol: body.symbol, market: body.market, priceSymbol: body.priceSymbol } : undefined); break;
      case "restore": id = await restoreInvestment(body.kind, text(body.id, 36)); break;
      case "delete": id = await deleteInvestment(body.kind, text(body.id, 36)); break;
      case "price-correct": id = await correctManualPrice(text(body.id, 36), text(body.price, 100), text(body.idempotencyKey, 36)); break;
      case "archive": id = await archiveInvestment(body.kind, text(body.id, 36)); break;
      case "opening": id = await createOpeningPosition(body.draft as OpeningDraft, text(body.idempotencyKey, 36)); break;
      case "opening-correct": id = await correctInvestmentOpening(body.draft, text(body.idempotencyKey, 36)); break;
      case "trade": id = await postInvestmentTrade(body.draft as TradeDraft, text(body.idempotencyKey, 36)); break;
      case "replace": id = await replaceInvestmentTrade(text(body.id, 36), body.draft as TradeDraft, text(body.idempotencyKey, 36)); break;
      case "void": id = await voidInvestmentTrade(text(body.id, 36), text(body.idempotencyKey, 36)); break;
      case "price": id = await saveMarketPrice(body.draft, text(body.idempotencyKey, 36)); break;
      case "price-refresh": id = await refreshMarketPrice(text(body.instrumentId, 36), text(body.idempotencyKey, 36)); break;
      default: return json({ error: "Tidak tersedia." }, 404);
    }
    return json({ id });
  } catch (error) { return json({ error: (error instanceof InvestmentError || error instanceof LifecycleError) ? error.message : "Perubahan belum dapat disimpan. Periksa unit, mata uang, dan urutan riwayat lalu coba lagi." }, 400); }
}
