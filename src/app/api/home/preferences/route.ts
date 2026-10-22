import { NextResponse } from "next/server";
import { currentOwnerSession } from "@/lib/auth/session";
import { assertRequestOrigin } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** Authenticated tombstone for stale clients. Historical rows are neither read nor written. */
export async function GET() {
  try {
    if (!await currentOwnerSession()) return reply("Sesi berakhir.", 401);
    return reply("Pengaturan tampilan Home telah dihentikan. Home menyesuaikan perangkat secara otomatis.", 410);
  } catch { return reply("Permintaan belum dapat diproses.", 503); }
}
export async function POST(request: Request) {
  try { assertRequestOrigin(request); }
  catch { return reply("Permintaan tampilan tidak diizinkan.", 403); }
  return GET();
}
