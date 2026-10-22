import { NextRequest, NextResponse } from "next/server";
import { currentOwnerSession } from "@/lib/auth/session";
import { assertRequestOrigin, boundedBody } from "@/lib/auth/http";
import { mutatePlanning, PlanningError } from "@/lib/planning/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(value: unknown, status = 200) { return NextResponse.json(value,{ status,headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: NextRequest) {
  try {
    assertRequestOrigin(request);
    if (!await currentOwnerSession()) return json({ error: "Sesi berakhir." },401);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new PlanningError("Data tidak valid.");
    const body: unknown = JSON.parse(await boundedBody(request));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new PlanningError("Data tidak valid.");
    const input = body as Record<string, unknown>;
    if (typeof input.action !== "string" || typeof input.idempotencyKey !== "string") throw new PlanningError("Data tidak valid.");
    const { action, idempotencyKey, ...payload } = input;
    return json({ id: await mutatePlanning(action,payload,idempotencyKey) });
  } catch (error) {
    if (error instanceof PlanningError) return json({ error: error.message },error.status);
    return json({ error: "Perubahan belum dapat disimpan. Periksa data dan coba lagi." },500);
  }
}
