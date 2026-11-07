import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { requireOwnerSession } from "@/lib/auth/session";
import { inDatabaseTransaction } from "@/lib/db/pool";
import { assertUuid } from "@/lib/domain/catalog";
import { assertStoredMinor, parseMinor } from "@/lib/domain/money";
import { planSplitBill } from "@/lib/domain/split-bill";
import { insertAssetOnClient } from "@/lib/repositories/assets";
import { postActivityInTransaction } from "./service";

export type SplitBillRequest = Readonly<{
  sourceAssetId: string;
  /** Principal paid from the source account (personal share + fronted share), without charges. */
  totalMinor: string;
  reimbursedMinor: string;
  occurredAt: string;
  categoryId?: string;
  charges?: readonly { typeId: string; amountMinor: string }[];
  person?: string;
  note?: string;
  /** Existing receivable account; when omitted one is reused or created for the currency. */
  receivableAssetId?: string;
}>;
export type SplitBillResult = Readonly<{
  personalActivityId: string | null;
  transferActivityId: string;
  receivableAssetId: string;
  receivableCreated: boolean;
}>;

/** Deterministic UUID per sub-operation so each posting has its own idempotency record under one master key. */
function derivedKey(key: string, part: string): string {
  const h = createHash("sha256").update(`${key}:${part}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function receivableFor(client: PoolClient, request: SplitBillRequest, source: { currency: string; asset_type_id: string; asset_group_id: string | null }): Promise<{ id: string; created: boolean }> {
  if (request.receivableAssetId) {
    assertUuid(request.receivableAssetId);
    const row = (await client.query<{ asset_class: string; is_active: boolean; currency_code: string }>(
      "SELECT asset_class,is_active,currency_code FROM assets WHERE id=$1 FOR SHARE", [request.receivableAssetId])).rows[0];
    if (!row || !row.is_active || row.asset_class !== "receivable" || row.currency_code !== source.currency || request.receivableAssetId === request.sourceAssetId) {
      throw new Error("Akun piutang harus akun piutang aktif dengan mata uang yang sama.");
    }
    return { id: request.receivableAssetId, created: false };
  }
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM assets WHERE asset_class='receivable' AND is_active AND currency_code=$1 AND id<>$2 ORDER BY created_at,id LIMIT 1",
    [source.currency, request.sourceAssetId]);
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
  const id = await insertAssetOnClient(client, {
    displayName: source.currency === "IDR" ? "Piutang & Talangan" : `Piutang & Talangan (${source.currency})`,
    currency: source.currency, assetTypeId: source.asset_type_id, assetGroupId: source.asset_group_id ?? undefined,
    normallyLiquid: false, normallySpendable: false, openingAmountMinor: 0n, openingEffectiveAt: new Date(),
    note: "Akun penampung uang talangan / split bill yang belum diganti.", assetClass: "receivable",
  });
  return { id, created: true };
}

/** Personal expense + fronted-share transfer + receivable account in ONE transaction under ONE idempotency key. */
export async function postSplitBill(request: SplitBillRequest, key: string): Promise<SplitBillResult> {
  await requireOwnerSession();
  assertUuid(key); assertUuid(request.sourceAssetId);
  const charges = (request.charges ?? []).map((c) => ({ typeId: c.typeId, amountMinor: assertStoredMinor(parseMinor(c.amountMinor)).toString() }));
  const plan = planSplitBill({ totalMinor: assertStoredMinor(parseMinor(request.totalMinor)), reimbursedMinor: assertStoredMinor(parseMinor(request.reimbursedMinor)),
    chargesMinor: charges.reduce((sum, c) => sum + BigInt(c.amountMinor), 0n) });
  const person = (request.person ?? "").trim(), note = (request.note ?? "").trim();
  const payload = { ...request, charges, totalMinor: request.totalMinor, person, note };
  const requestHash = createHash("sha256").update(JSON.stringify({ operation: "split-bill", payload })).digest("hex");
  return inDatabaseTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const prior = (await client.query<{ request_hash: string; personal_activity_id: string | null; transfer_activity_id: string; receivable_asset_id: string; receivable_created: boolean }>(
      "SELECT * FROM split_bill_operations WHERE idempotency_key=$1", [key])).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) throw new Error("Kunci permintaan sudah digunakan untuk perubahan lain");
      return { personalActivityId: prior.personal_activity_id, transferActivityId: prior.transfer_activity_id,
        receivableAssetId: prior.receivable_asset_id, receivableCreated: prior.receivable_created };
    }
    const source = (await client.query<{ currency: string; asset_type_id: string; asset_group_id: string | null; is_active: boolean }>(
      "SELECT currency_code AS currency,asset_type_id,asset_group_id,is_active FROM assets WHERE id=$1 FOR UPDATE", [request.sourceAssetId])).rows[0];
    if (!source?.is_active) throw new Error("Akun sumber tidak ditemukan atau tidak aktif");
    const receivable = await receivableFor(client, request, source);
    const transferNote = `Talangan${person ? ` ${person}` : ""}${note ? ` · ${note}` : ""}`.slice(0, 1000);
    let personalActivityId: string | null = null;
    if (plan.personalMinor > 0n) {
      personalActivityId = await postActivityInTransaction(client, { kind: "expense", amountMinor: plan.personalMinor.toString(),
        sourceAssetId: request.sourceAssetId, categoryId: request.categoryId, charges, occurredAt: request.occurredAt, note: note || undefined },
      derivedKey(key, "personal"));
    }
    const transferActivityId = await postActivityInTransaction(client, { kind: "transfer", amountMinor: plan.reimbursedMinor.toString(),
      sourceAssetId: request.sourceAssetId, destinationAssetId: receivable.id, occurredAt: request.occurredAt, note: transferNote },
    derivedKey(key, "transfer"));
    await client.query(`INSERT INTO split_bill_operations (idempotency_key,request_hash,personal_activity_id,transfer_activity_id,receivable_asset_id,receivable_created)
      VALUES ($1,$2,$3,$4,$5,$6)`, [key, requestHash, personalActivityId, transferActivityId, receivable.id, receivable.created]);
    return { personalActivityId, transferActivityId, receivableAssetId: receivable.id, receivableCreated: receivable.created };
  });
}
