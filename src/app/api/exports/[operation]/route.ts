import { NextRequest, NextResponse } from "next/server";
import { assertRequestOrigin } from "@/lib/auth/http";
import { currentOwnerSession } from "@/lib/auth/session";
import {
  commitWorkbookAccountMigration,
  exportDatasetFile,
  exportFullSnapshotJson,
  previewWorkbookAccountMigration,
  type ExportDatasetKind,
  type ExportFileFormat,
} from "@/lib/exports/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };
const validKinds = new Set<ExportDatasetKind>(["transactions", "assets", "investments", "planning"]);
const validFormats = new Set<ExportFileFormat>(["csv", "xlsx", "pdf"]);

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: noStoreHeaders });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ operation: string }> }) {
  if (!(await currentOwnerSession())) {
    return json({ error: "Sesi berakhir." }, 401);
  }
  const { operation } = await params;
  if (operation !== "download") {
    return json({ error: "Operasi tidak tersedia." }, 404);
  }
  const kindParam = request.nextUrl.searchParams.get("type") ?? "transactions";
  const formatParam = (request.nextUrl.searchParams.get("format") ?? "csv").toLowerCase();

  try {
    if (kindParam === "snapshot") {
      const snapshot = await exportFullSnapshotJson();
      return new NextResponse(JSON.stringify(snapshot.payload, null, 2), {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${snapshot.fileName}"`,
        },
      });
    }
    if (!validKinds.has(kindParam as ExportDatasetKind)) {
      return json({ error: "Jenis data ekspor tidak dikenal." }, 400);
    }
    const fileFormat: ExportFileFormat = validFormats.has(formatParam as ExportFileFormat)
      ? (formatParam as ExportFileFormat)
      : "csv";
    const exported = await exportDatasetFile(kindParam as ExportDatasetKind, fileFormat);
    const payload = typeof exported.body === "string" ? exported.body : new Uint8Array(exported.body);
    return new NextResponse(payload, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": exported.contentType,
        "Content-Disposition": `attachment; filename="${exported.fileName}"`,
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Gagal mengekspor data." }, 500);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ operation: string }> }) {
  try {
    assertRequestOrigin(request);
    if (!(await currentOwnerSession())) {
      return json({ error: "Sesi berakhir." }, 401);
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return json({ error: "Format permintaan tidak valid." }, 400);
    }
    const rawBody = await request.text();
    if (rawBody.length > 10 * 1024 * 1024) {
      return json({ error: "Ukuran file workbook terlalu besar." }, 413);
    }
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const { operation } = await params;

    if (operation === "migration-preview") {
      const preview = await previewWorkbookAccountMigration({
        fileName: typeof body.fileName === "string" ? body.fileName : "workbook.xlsx",
        contentBase64: typeof body.contentBase64 === "string" ? body.contentBase64 : "",
        sheetName: typeof body.sheetName === "string" && body.sheetName ? body.sheetName : undefined,
      });
      return json({ preview });
    }

    if (operation === "migration-commit") {
      const selectedRowNumbers = Array.isArray(body.selectedRowNumbers)
        ? body.selectedRowNumbers.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1)
        : [];
      const result = await commitWorkbookAccountMigration({
        fileName: typeof body.fileName === "string" ? body.fileName : "workbook.xlsx",
        contentBase64: typeof body.contentBase64 === "string" ? body.contentBase64 : "",
        sheetName: typeof body.sheetName === "string" && body.sheetName ? body.sheetName : undefined,
        selectedRowNumbers,
        openingEffectiveAt: typeof body.openingEffectiveAt === "string" ? body.openingEffectiveAt : undefined,
      });
      return json({ result });
    }

    return json({ error: "Operasi tidak tersedia." }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Permintaan migrasi gagal diproses." }, 400);
  }
}
