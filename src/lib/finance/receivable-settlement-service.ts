import "server-only";
import { createHash } from "node:crypto";
import { requireOwnerSession } from "@/lib/auth/session";
import { inDatabaseTransaction } from "@/lib/db/pool";
import { assertUuid } from "@/lib/domain/catalog";
import { assertStoredMinor, parseMinor } from "@/lib/domain/money";
import { planReceivableSettlement, SETTLEMENT_MODES, type SettlementMode } from "@/lib/domain/receivable-settlement";
import { listAssets } from "@/lib/repositories/assets";
import { postActivityInTransaction } from "./service";
import { derivedKey } from "./split-bill-service";

export type ReceivableSettlementRequest = Readonly<{
  receivableAssetId: string;
  destinationAssetId: string;
  receivedAmountMinor: string;
  settlementMode: SettlementMode;
  occurredAt: string;
  note?: string;
}>;
export type ReceivableSettlementResult = Readonly<{
  transferActivityId: string;
  adjustmentActivityId: string | null;
  adjustmentKind: "income" | "expense" | null;
  settlementMode: SettlementMode;
}>;

type Prior = { request_hash: string; transfer_activity_id: string; adjustment_activity_id: string | null; adjustment_kind: "income" | "expense" | null; settlement_mode: SettlementMode };

/** Transfer receivable -> destination + optional rounding adjustment in ONE transaction under ONE idempotency key. */
export async function postReceivableSettlement(request: ReceivableSettlementRequest, key: string): Promise<ReceivableSettlementResult> {
  await requireOwnerSession();
  assertUuid(key); assertUuid(request.receivableAssetId); assertUuid(request.destinationAssetId);
  if (!SETTLEMENT_MODES.includes(request.settlementMode)) throw new Error("Mode pelunasan tidak dikenal.");
  if (request.receivableAssetId === request.destinationAssetId) throw new Error("Rekening tujuan harus berbeda dari akun piutang.");
  const receivedMinor = assertStoredMinor(parseMinor(request.receivedAmountMinor));
  if (receivedMinor <= 0n) throw new Error("Nominal diterima harus lebih dari nol.");
  const note = (request.note ?? "").trim();
  if (note.length > 1000) throw new Error("Catatan terlalu panjang");
  const payload = { ...request, receivedAmountMinor: receivedMinor.toString(), note };
  const requestHash = createHash("sha256").update(JSON.stringify({ operation: "settle-receivable", payload })).digest("hex");
  return inDatabaseTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const prior = (await client.query<Prior>("SELECT * FROM receivable_settlement_operations WHERE idempotency_key=$1", [key])).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) throw new Error("Kunci permintaan sudah digunakan untuk perubahan lain");
      return { transferActivityId: prior.transfer_activity_id, adjustmentActivityId: prior.adjustment_activity_id,
        adjustmentKind: prior.adjustment_kind, settlementMode: prior.settlement_mode };
    }
    const locked = await client.query<{ id: string; asset_class: string; is_active: boolean; currency_code: string; display_name: string }>(
      "SELECT id,asset_class,is_active,currency_code,display_name FROM assets WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [[request.receivableAssetId, request.destinationAssetId]]);
    const receivable = locked.rows.find((row) => row.id === request.receivableAssetId);
    const destination = locked.rows.find((row) => row.id === request.destinationAssetId);
    if (!receivable?.is_active || receivable.asset_class !== "receivable") throw new Error("Akun piutang harus akun piutang aktif.");
    if (!destination?.is_active || destination.asset_class !== "asset") throw new Error("Rekening tujuan harus akun aktif non-kredit dan non-piutang.");
    if (destination.currency_code !== receivable.currency_code) throw new Error("Rekening tujuan harus bermata uang sama dengan piutang.");
    const balance = (await listAssets(true, client)).find((asset) => asset.id === receivable.id)?.balanceMinor;
    const plan = planReceivableSettlement({ remainingMinor: BigInt(balance ?? "0"), receivedMinor, mode: request.settlementMode });
    const adjustmentNote = `Selisih pembulatan pelunasan · ${receivable.display_name}`.slice(0, 1000);
    const transferActivityId = await postActivityInTransaction(client, { kind: "transfer", amountMinor: plan.transferMinor.toString(),
      sourceAssetId: receivable.id, destinationAssetId: destination.id, occurredAt: request.occurredAt,
      note: note || `Pelunasan piutang · ${receivable.display_name}`.slice(0, 1000) }, derivedKey(key, "transfer"));
    let adjustmentActivityId: string | null = null;
    if (plan.adjustment) {
      const systemKey = plan.adjustment.kind === "income" ? "other_income" : "other_expense";
      const categoryId = (await client.query<{ id: string }>(
        "SELECT id FROM transaction_categories WHERE system_key=$1 AND is_active AND applies_to=$2", [systemKey, plan.adjustment.kind])).rows[0]?.id;
      adjustmentActivityId = await postActivityInTransaction(client, plan.adjustment.kind === "income"
        ? { kind: "income", amountMinor: plan.adjustment.amountMinor.toString(), destinationAssetId: destination.id, categoryId, occurredAt: request.occurredAt, note: adjustmentNote }
        : { kind: "expense", amountMinor: plan.adjustment.amountMinor.toString(), sourceAssetId: receivable.id, categoryId, occurredAt: request.occurredAt, note: adjustmentNote },
      derivedKey(key, "adjustment"));
    }
    await client.query(`INSERT INTO receivable_settlement_operations (idempotency_key,request_hash,receivable_asset_id,destination_asset_id,settlement_mode,transfer_activity_id,adjustment_activity_id,adjustment_kind)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [key, requestHash, receivable.id, destination.id, request.settlementMode, transferActivityId, adjustmentActivityId, plan.adjustment?.kind ?? null]);
    return { transferActivityId, adjustmentActivityId, adjustmentKind: plan.adjustment?.kind ?? null, settlementMode: request.settlementMode };
  });
}
