import { NextRequest, NextResponse } from "next/server";
import { assertRequestOrigin } from "@/lib/auth/http";
import { currentOwnerSession } from "@/lib/auth/session";
import { ImportValidationError } from "@/lib/imports/parser";
import { commitImportBatch, listImportBatches, previewImportFile } from "@/lib/imports/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function boundedImportBody(request: NextRequest, maxBytes = 8 * 1024 * 1024): Promise<string> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new ImportValidationError("Ukuran permintaan impor melebihi batas 8 MB.");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new ImportValidationError("Ukuran permintaan impor melebihi batas 8 MB.");
  return text;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ operation: string }> }) {
  const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  if ((await params).operation !== "history") return json({ error: "Tidak tersedia." }, 404);
  if (!await currentOwnerSession()) return json({ error: "Sesi berakhir. Buka ulang dengan passkey." }, 401);
  try {
    return json({ batches: await listImportBatches() });
  } catch {
    return json({ error: "Riwayat impor belum dapat dimuat." }, 400);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ operation: string }> }) {
  const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  try {
    assertRequestOrigin(request);
    if (!await currentOwnerSession()) return json({ error: "Sesi berakhir. Buka ulang dengan passkey." }, 401);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Invalid content type");
    const body = JSON.parse(await boundedImportBody(request));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
    const { operation } = await params;

    if (operation === "preview") {
      const preview = await previewImportFile({
        fileName: String(body.fileName ?? ""),
        contentBase64: String(body.contentBase64 ?? ""),
        sheetName: typeof body.sheetName === "string" && body.sheetName ? body.sheetName : undefined,
        columnMapping: body.columnMapping && typeof body.columnMapping === "object" ? body.columnMapping : undefined,
        accountMap: body.accountMap && typeof body.accountMap === "object" ? body.accountMap : undefined,
        categoryMap: body.categoryMap && typeof body.categoryMap === "object" ? body.categoryMap : undefined,
        autoCreateCategories: typeof body.autoCreateCategories === "boolean" ? body.autoCreateCategories : true,
      });
      return json({ preview });
    }

    if (operation === "commit") {
      const result = await commitImportBatch({
        fileName: String(body.fileName ?? ""),
        contentBase64: String(body.contentBase64 ?? ""),
        sheetName: typeof body.sheetName === "string" && body.sheetName ? body.sheetName : undefined,
        columnMapping: body.columnMapping && typeof body.columnMapping === "object" ? body.columnMapping : undefined,
        accountMap: body.accountMap && typeof body.accountMap === "object" ? body.accountMap : undefined,
        categoryMap: body.categoryMap && typeof body.categoryMap === "object" ? body.categoryMap : undefined,
        autoCreateCategories: typeof body.autoCreateCategories === "boolean" ? body.autoCreateCategories : true,
        selectedRowNumbers: Array.isArray(body.selectedRowNumbers) ? body.selectedRowNumbers : [],
        idempotencyKey: String(body.idempotencyKey ?? ""),
      });
      return json({ result });
    }

    return json({ error: "Tidak tersedia." }, 404);
  } catch (error) {
    return json(
      { error: error instanceof ImportValidationError ? error.message : (error instanceof Error ? error.message : "Permintaan impor gagal diproses.") },
      400,
    );
  }
}
