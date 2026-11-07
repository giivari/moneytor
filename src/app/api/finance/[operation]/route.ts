import { NextRequest, NextResponse } from "next/server";
import { assertRequestOrigin, boundedBody } from "@/lib/auth/http";
import { currentOwnerSession } from "@/lib/auth/session";
import { assertStoredMinor, parseMinor } from "@/lib/domain/money";
import { insertAssetWithOpening, updateAsset, archiveAsset, restoreAsset, listAssets, assetOpeningHistory, readAssetDetail, correctAssetOpening, changeAssetClass, OpeningCorrectionError } from "@/lib/repositories/assets";
import { setCategoryNature, CATEGORY_NATURES, deleteCustomCatalogItem, restoreCustomCatalogItem, archiveCustomCatalogItem, insertCustomCatalogItem, insertCustomCategory, listCatalog, renameCustomCatalogItem, type Catalog } from "@/lib/repositories/catalogs";
import { postActivity, replaceActivity, voidActivity } from "@/lib/finance/service";
import { postSplitBill } from "@/lib/finance/split-bill-service";
import { LifecycleError } from "@/lib/repositories/lifecycle";
import type { ActivityDraft, AssetClass } from "@/lib/finance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const catalogs = new Set<Catalog>(["providers", "paymentNetworks", "assetTypes", "assetGroups", "transactionCategories", "chargeTypes", "instrumentTypes"]);
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid input");
  return value as Record<string, unknown>;
}
function str(value: unknown, max = 120): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid text");
  return value;
}
function installmentTerms(value: unknown): { count: number; principalMinor: string; interestMinor: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new Error("Invalid installments");
  const item = value as Record<string, unknown>;
  if (typeof item.count !== "number") throw new Error("Invalid installments");
  return { count: item.count, principalMinor: str(item.principalMinor, 24), interestMinor: str(item.interestMinor, 24) };
}
function optional(value: unknown, max = 120): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : str(value, max);
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid boolean");
  return value;
}
function catalog(value: unknown): Catalog {
  const name = str(value, 40) as Catalog;
  if (!catalogs.has(name)) throw new Error("Invalid catalog");
  return name;
}
function assetFields(body: Record<string, unknown>) {
  return {
    displayName: str(body.displayName), assetTypeId: str(body.assetTypeId, 36),
    assetGroupId: optional(body.assetGroupId, 36), providerId: optional(body.providerId, 36),
    paymentNetworkId: optional(body.paymentNetworkId, 36), normallyLiquid: bool(body.normallyLiquid),
    normallySpendable: bool(body.normallySpendable), safeSuffix: optional(body.safeSuffix, 4), note: optional(body.note, 1000),
    assetClass: body.assetClass === undefined ? undefined : str(body.assetClass, 20) as AssetClass,
  };
}
function splitBillRequest(body: Record<string, unknown>) {
  if (body.charges !== undefined && !Array.isArray(body.charges)) throw new Error("Invalid charges");
  const charges = (body.charges as unknown[] | undefined)?.map((item) => {
    const charge = object(item);
    return { typeId: str(charge.typeId, 36), amountMinor: str(charge.amountMinor, 24) };
  });
  return { sourceAssetId: str(body.sourceAssetId, 36), totalMinor: str(body.totalMinor, 24), reimbursedMinor: str(body.reimbursedMinor, 24),
    occurredAt: str(body.occurredAt, 40), categoryId: optional(body.categoryId, 36), charges, person: optional(body.person, 120),
    note: optional(body.note, 1000), receivableAssetId: optional(body.receivableAssetId, 36) };
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ operation: string }> }) {
  const operation = (await params).operation;
  if (operation !== "options" && operation !== "asset-opening" && operation !== "asset-detail") {
    return json({ error: "Tidak tersedia" }, 404);
  }
  if (!await currentOwnerSession()) return json({ error: "Sesi berakhir" }, 401);
  try {
    if (operation === "asset-opening") return json(await assetOpeningHistory(str(request.nextUrl.searchParams.get("id"), 36)));
    if (operation === "asset-detail") return json(await readAssetDetail(str(request.nextUrl.searchParams.get("id"), 36)));
    const [assets, currencies, providers, paymentNetworks, assetTypes, assetGroups, transactionCategories, chargeTypes] = await Promise.all([
      listAssets(false),
      import("@/lib/db/pool").then(({ database }) => database().query<{ code: string; minor_unit_exponent: number }>(
        "SELECT code,minor_unit_exponent FROM currencies WHERE is_active ORDER BY code")),
      listCatalog("providers"), listCatalog("paymentNetworks"), listCatalog("assetTypes"),
      listCatalog("assetGroups"), listCatalog("transactionCategories"), listCatalog("chargeTypes"),
    ]);
    return json({ assets, currencies: currencies.rows.map((row) => ({ code: row.code, exponent: row.minor_unit_exponent })),
      catalogs: { providers, paymentNetworks, assetTypes, assetGroups, transactionCategories, chargeTypes } });
  } catch (error) { return json({ error: error instanceof OpeningCorrectionError ? error.message : "Data belum dapat dimuat" }, 500); }
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ operation: string }> }) {
  try {
    assertRequestOrigin(request);
    if (!await currentOwnerSession()) return json({ error: "Sesi berakhir" }, 401);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Invalid content type");
    const body = object(JSON.parse(await boundedBody(request)));
    const { operation } = await params;
    if (operation === "asset-create") {
      const opening = assertStoredMinor(parseMinor(str(body.openingAmountMinor, 25)));
      if (opening < 0n) throw new Error("Negative opening");
      const fields = assetFields(body);
      const id = await insertAssetWithOpening({ ...fields, assetClass: fields.assetClass ?? "asset", currency: str(body.currency, 3),
        openingAmountMinor: opening, openingEffectiveAt: new Date(str(body.openingEffectiveAt, 40)) });
      return json({ id });
    }
    if (operation === "asset-update") {
      await updateAsset(str(body.id, 36), assetFields(body)); return json({ ok: true });
    }
    if (operation === "asset-opening-correct") {
      const id = await correctAssetOpening({ assetId: str(body.assetId, 36), expectedMinor: str(body.expectedMinor, 25),
        correctedMinor: str(body.correctedMinor, 25), note: optional(body.note, 1000), idempotencyKey: str(body.idempotencyKey, 36) });
      return json({ id });
    }
    if (operation === "asset-class-change") return json(await changeAssetClass(str(body.id, 36), body.assetClass, str(body.idempotencyKey, 36)));
    if (operation === "split-bill") return json(await postSplitBill(splitBillRequest(body), str(body.idempotencyKey, 36)));
    if (operation === "asset-restore") {
      await restoreAsset(str(body.id, 36)); return json({ ok: true });
    }
    if (operation === "asset-archive") {
      await archiveAsset(str(body.id, 36)); return json({ ok: true });
    }
    if (operation === "catalog-create") {
      const which = catalog(body.catalog);
      const item = which === "transactionCategories"
        ? await insertCustomCategory(str(body.displayName), str(body.appliesTo, 7) as "income" | "expense", optional(body.parentId, 36))
        : await insertCustomCatalogItem(which, str(body.displayName));
      return json({ item });
    }
    if (operation === "category-nature") {
      const nature = body.nature === null ? null : str(body.nature, 12);
      if (nature !== null && !(CATEGORY_NATURES as readonly string[]).includes(nature)) throw new Error("Invalid nature");
      await setCategoryNature(str(body.id, 36), nature as Parameters<typeof setCategoryNature>[1]); return json({ ok: true });
    }
    if (operation === "catalog-rename") {
      await renameCustomCatalogItem(catalog(body.catalog), str(body.id, 36), str(body.displayName)); return json({ ok: true });
    }
    if (operation === "catalog-restore" || operation === "catalog-delete") {
      await (operation === "catalog-restore" ? restoreCustomCatalogItem : deleteCustomCatalogItem)(catalog(body.catalog), str(body.id, 36)); return json({ ok: true });
    }
    if (operation === "catalog-archive") {
      await archiveCustomCatalogItem(catalog(body.catalog), str(body.id, 36)); return json({ ok: true });
    }
    if (operation === "post") return json({ id: await postActivity(body.draft as ActivityDraft, str(body.idempotencyKey, 36),
      {
        creditCycle: body.creditCycle === "next" || body.creditCycle === "current" ? body.creditCycle : undefined,
        creditInstallments: installmentTerms(body.creditInstallments),
      }) });
    if (operation === "replace") return json({ id: await replaceActivity(str(body.id, 36), body.draft as ActivityDraft, str(body.idempotencyKey, 36),
      {
        creditCycle: body.creditCycle === "next" || body.creditCycle === "current" ? body.creditCycle : undefined,
        creditInstallments: installmentTerms(body.creditInstallments),
      }) });
    if (operation === "void") return json({ id: await voidActivity(str(body.id, 36), str(body.idempotencyKey, 36)) });
    return json({ error: "Tidak tersedia" }, 404);
  } catch (error) {
    if (error instanceof LifecycleError || error instanceof OpeningCorrectionError) return json({ error: error.message }, 400);
    return json({ error: "Perubahan tidak dapat disimpan. Periksa data dan coba lagi." }, 400);
  }
}
