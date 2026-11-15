import { NextResponse } from "next/server";
import { cronAuthorization } from "@/lib/investments/cron-auth";
import { InvestmentError } from "@/lib/investments/math";
import { configuredPriceProvider } from "@/lib/investments/providers";
import { refreshAllMarketPrices } from "@/lib/investments/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const headers = { "Cache-Control": "no-store" };

/** Vercel Cron harian. Tanpa sesi passkey: diotorisasi Bearer CRON_SECRET (timing-safe); hanya menambah titik harga. */
export async function GET(request: Request) {
  const auth = cronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === 503) return NextResponse.json({ error: "CRON_SECRET belum dikonfigurasi." }, { status: 503, headers });
  if (auth === 401) return NextResponse.json({ error: "Tidak berwenang." }, { status: 401, headers });
  if (!configuredPriceProvider()) return NextResponse.json({ error: "Penyedia harga otomatis belum dikonfigurasi." }, { status: 503, headers });
  try {
    const token = request.headers.get("authorization")!.replace(/^Bearer /i, "").trim();
    return NextResponse.json(await refreshAllMarketPrices(token), { headers });
  } catch (error) {
    const message = error instanceof InvestmentError ? error.message : "Pembaruan harga terjadwal gagal.";
    return NextResponse.json({ error: message }, { status: 500, headers });
  }
}
