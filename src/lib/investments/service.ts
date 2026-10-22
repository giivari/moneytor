import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { requireOwnerSession } from "@/lib/auth/session";
import { inDatabaseTransaction } from "@/lib/db/pool";
import { hasOpeningCorrections } from "@/lib/db/opening-capability";
import { decimal, decimalString, replayPosition, storedMoney, tradeCash, InvestmentError } from "@/lib/investments/math";
import { investmentSnapshot } from "@/lib/investments/read";
import { configuredPriceProvider, isRegisteredPriceProvider } from "@/lib/investments/providers";
import { name, openingDraft, optionalText, text, timestamp, tradeDraft, uuid } from "@/lib/investments/validation";
import { deleteUnused } from "@/lib/repositories/lifecycle";
import type { OpeningDraft, TradeDraft } from "./types";

async function locked<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
  await requireOwnerSession();
  return inDatabaseTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('moneytor_investment_posting'))");
    return action(client);
  });
}
type Operation = "opening" | "trade" | "replace" | "void" | "price";
async function idempotent(operation: Operation, key: string, payload: unknown, action: (client: PoolClient) => Promise<string>): Promise<string> {
  uuid(key);
  const hash = createHash("sha256").update(JSON.stringify({ operation, payload })).digest("hex");
  return locked(async (client) => {
    const prior = await client.query("SELECT * FROM investment_operations WHERE idempotency_key=$1", [key]);
    if (prior.rows[0]) {
      if (prior.rows[0].operation !== operation || prior.rows[0].request_hash !== hash) throw new InvestmentError("Kunci permintaan telah digunakan untuk perubahan lain.");
      return prior.rows[0].opening_id ?? prior.rows[0].transaction_id ?? prior.rows[0].price_id;
    }
    const id = await action(client);
    await client.query(`INSERT INTO investment_operations (idempotency_key,operation,request_hash,opening_id,transaction_id,price_id)
      VALUES ($1,$2,$3,$4,$5,$6)`, [key, operation, hash, operation === "opening" ? id : null,
      ["trade", "replace", "void"].includes(operation) ? id : null, operation === "price" ? id : null]);
    return id;
  });
}
async function activeCurrency(client: PoolClient, code: string) {
  const row = (await client.query("SELECT code FROM currencies WHERE code=$1 AND is_active FOR SHARE", [code])).rows[0];
  if (!row) throw new InvestmentError("Mata uang tidak tersedia.");
}
export async function createPortfolio(raw: { displayName: string; currency: string; providerId?: string; note?: string }) {
  const displayName = name(raw.displayName), currency = text(raw.currency, 3), providerId = raw.providerId ? uuid(raw.providerId) : null, note = optionalText(raw.note);
  return locked(async (client) => {
    await activeCurrency(client, currency);
    if (providerId && !(await client.query("SELECT id FROM financial_providers WHERE id=$1 AND is_active FOR SHARE", [providerId])).rowCount) throw new InvestmentError("Penyedia tidak aktif.");
    const id = randomUUID();
    await client.query("INSERT INTO investment_portfolios (id,display_name,currency_code,provider_id,note) VALUES ($1,$2,$3,$4,$5)", [id, displayName, currency, providerId, note]);
    return id;
  });
}
export async function createInstrumentType(displayName: string) {
  const label = name(displayName);
  return locked(async (client) => {
    const id = randomUUID();
    await client.query("INSERT INTO investment_instrument_types (id,display_name) VALUES ($1,$2)", [id, label]); return id;
  });
}
export async function createInstrument(raw: { displayName: string; typeId: string; currency: string; symbol?: string; market?: string; priceSymbol?: string }) {
  const displayName = name(raw.displayName), typeId = uuid(raw.typeId), currency = text(raw.currency, 3);
  const symbol = optionalText(raw.symbol, 80), market = optionalText(raw.market, 80), priceSymbol = optionalText(raw.priceSymbol, 120);
  return locked(async (client) => {
    await activeCurrency(client, currency);
    if (!(await client.query("SELECT id FROM investment_instrument_types WHERE id=$1 AND is_active FOR SHARE", [typeId])).rowCount) throw new InvestmentError("Jenis instrumen tidak aktif.");
    const id = randomUUID();
    await client.query("INSERT INTO investment_instruments (id,display_name,instrument_type_id,currency_code,symbol,market,price_symbol) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, displayName, typeId, currency, symbol, market, priceSymbol]);
    return id;
  });
}
export async function updateInvestmentMetadata(
  kind: "portfolio" | "instrument",
  id: string,
  displayName: string,
  details?: { symbol?: string; market?: string; priceSymbol?: string },
) {
  if (!["portfolio", "instrument"].includes(kind)) throw new InvestmentError("Jenis tidak valid.");
  uuid(id); const label = name(displayName);
  const hasInstrumentDetails = kind === "instrument" && details !== undefined;
  const symbol = hasInstrumentDetails ? optionalText(details.symbol, 80) : null;
  const market = hasInstrumentDetails ? optionalText(details.market, 80) : null;
  const priceSymbol = hasInstrumentDetails ? optionalText(details.priceSymbol, 120) : null;
  return locked(async (client) => {
    if (hasInstrumentDetails) {
      if (!(await client.query("UPDATE investment_instruments SET display_name=$2,symbol=$3,market=$4,price_symbol=$5 WHERE id=$1 RETURNING id", [id, label, symbol, market, priceSymbol])).rowCount) throw new InvestmentError("Data tidak ditemukan.");
      return id;
    }
    const table = kind === "portfolio" ? "investment_portfolios" : "investment_instruments";
    if (!(await client.query(`UPDATE ${table} SET display_name=$2 WHERE id=$1 RETURNING id`, [id, label])).rowCount) throw new InvestmentError("Data tidak ditemukan.");
    return id;
  });
}
export async function archiveInvestment(kind: "portfolio" | "instrument", id: string) {
  if (!["portfolio", "instrument"].includes(kind)) throw new InvestmentError("Jenis tidak valid.");
  uuid(id);
  return locked(async (client) => {
    const table = kind === "portfolio" ? "investment_portfolios" : "investment_instruments";
    if (!(await client.query(`UPDATE ${table} SET is_active=false WHERE id=$1 AND is_active RETURNING id`, [id])).rowCount) throw new InvestmentError("Data aktif tidak ditemukan.");
    return id;
  });
}
async function activePair(client: PoolClient, portfolioId: string, instrumentId: string) {
  const row = (await client.query(`SELECT p.currency_code,c.minor_unit_exponent AS exponent
    FROM investment_portfolios p JOIN investment_instruments i ON i.id=$2
    JOIN currencies c ON c.code=p.currency_code
    WHERE p.id=$1 AND p.is_active AND i.is_active AND c.is_active AND p.currency_code=i.currency_code FOR SHARE OF p,i,c`, [portfolioId, instrumentId])).rows[0];
  if (!row) throw new InvestmentError("Pilih portofolio dan instrumen aktif dengan mata uang yang sama.");
  return { currency: row.currency_code as string, exponent: row.exponent as number };
}
async function validateReplay(client: PoolClient, portfolioId: string, instrumentId: string, exponent: number) {
  const ready = await hasOpeningCorrections(client);
  const opening = (await client.query(`SELECT ${ready ? "COALESCE(c.corrected_quantity,o.quantity)" : "o.quantity"}::text AS quantity,
    ${ready ? "COALESCE(c.corrected_cost_basis_minor,o.cost_basis_minor)" : "o.cost_basis_minor"}::text AS cost_basis_minor,o.occurred_at
    FROM investment_opening_positions o ${ready ? `LEFT JOIN LATERAL
    (SELECT corrected_quantity,corrected_cost_basis_minor FROM investment_opening_corrections WHERE opening_id=o.id ORDER BY correction_order DESC LIMIT 1) c ON true` : ""}
    WHERE o.portfolio_id=$1 AND o.instrument_id=$2`, [portfolioId, instrumentId])).rows[0];
  const rows = await client.query(`SELECT t.id,t.kind,t.quantity::text,t.gross_minor::text,COALESCE(f.amount_minor,0)::text AS fee_minor,
    t.occurred_at,COALESCE(t.chronology_order,t.event_order)::text AS replay_order FROM investment_transactions t
    LEFT JOIN investment_trade_fees f ON f.transaction_id=t.id WHERE t.portfolio_id=$1 AND t.instrument_id=$2 AND t.status='posted'`, [portfolioId, instrumentId]);
  return replayPosition(opening ? { quantity: opening.quantity, costBasisMinor: opening.cost_basis_minor, occurredAt: opening.occurred_at.toISOString() } : undefined,
    rows.rows.map((r) => ({ id: r.id, kind: r.kind, quantity: r.quantity, grossMinor: r.gross_minor, feeMinor: r.fee_minor,
      occurredAt: r.occurred_at.toISOString(), order: r.replay_order })), exponent);
}
async function insertPrice(client: PoolClient, instrumentId: string, currency: string, price: string, asOf: string, sourceId: string | null) {
  const id = randomUUID();
  await client.query("INSERT INTO investment_price_points (id,instrument_id,currency_code,price,as_of,source_type,source_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, instrumentId, currency, price, asOf, sourceId ? "provider" : "manual", sourceId]);
  return id;
}
export async function createOpeningPosition(raw: OpeningDraft, key: string) {
  const draft = openingDraft(raw);
  return idempotent("opening", key, draft, async (client) => {
    const pair = await activePair(client, draft.portfolioId, draft.instrumentId);
    const id = randomUUID();
    await client.query("INSERT INTO investment_opening_positions (id,portfolio_id,instrument_id,currency_code,quantity,cost_basis_minor,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, draft.portfolioId, draft.instrumentId, pair.currency, draft.quantity, draft.costBasisMinor, draft.occurredAt]);
    await validateReplay(client, draft.portfolioId, draft.instrumentId, pair.exponent);
    if (draft.initialPrice) await insertPrice(client, draft.instrumentId, pair.currency, draft.initialPrice, draft.occurredAt, null);
    return id;
  });
}

/** Reconcile the effective opening, then replay the entire posted chronology before commit. */
export async function correctInvestmentOpening(raw: { openingId: string; expectedQuantity: string; expectedCostBasisMinor: string;
  quantity: string; costBasisMinor: string; note?: string }, key: string): Promise<string> {
  const draft = { openingId: uuid(raw.openingId), expectedQuantity: decimalString(decimal(raw.expectedQuantity)),
    expectedCostBasisMinor: storedMoney(raw.expectedCostBasisMinor).toString(),
    quantity: decimalString(decimal(raw.quantity)), costBasisMinor: storedMoney(raw.costBasisMinor).toString(), note: optionalText(raw.note) };
  uuid(key);
  const hash = createHash("sha256").update(JSON.stringify(draft)).digest("hex");
  return locked(async (client) => {
    if (!await hasOpeningCorrections(client)) throw new InvestmentError("Koreksi posisi awal belum tersedia di database lokal.");
    const prior = (await client.query("SELECT id,request_hash FROM investment_opening_corrections WHERE idempotency_key=$1", [key])).rows[0];
    if (prior) {
      if (prior.request_hash !== hash) throw new InvestmentError("Kunci permintaan telah digunakan untuk koreksi lain.");
      return prior.id as string;
    }
    const opening = (await client.query(`SELECT o.id,o.portfolio_id,o.instrument_id,o.quantity::text AS original_quantity,
      o.cost_basis_minor::text AS original_cost_basis_minor FROM investment_opening_positions o WHERE id=$1 FOR UPDATE`, [draft.openingId])).rows[0];
    if (!opening) throw new InvestmentError("Posisi awal tidak ditemukan.");
    const pair = await activePair(client, opening.portfolio_id, opening.instrument_id);
    const latest = (await client.query(`SELECT corrected_quantity::text,corrected_cost_basis_minor::text
      FROM investment_opening_corrections WHERE opening_id=$1 ORDER BY correction_order DESC LIMIT 1`, [draft.openingId])).rows[0];
    const currentQuantity = latest?.corrected_quantity ?? opening.original_quantity;
    const currentCost = latest?.corrected_cost_basis_minor ?? opening.original_cost_basis_minor;
    if (decimalString(decimal(currentQuantity)) !== draft.expectedQuantity || currentCost !== draft.expectedCostBasisMinor)
      throw new InvestmentError("Posisi awal sudah berubah. Muat ulang lalu periksa nilainya.");
    if (draft.quantity === draft.expectedQuantity && draft.costBasisMinor === draft.expectedCostBasisMinor)
      throw new InvestmentError("Masukkan unit atau biaya perolehan yang berbeda.");
    const id = randomUUID();
    await client.query(`INSERT INTO investment_opening_corrections
      (id,opening_id,previous_quantity,corrected_quantity,previous_cost_basis_minor,corrected_cost_basis_minor,note,idempotency_key,request_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id,draft.openingId,currentQuantity,draft.quantity,currentCost,draft.costBasisMinor,draft.note ?? null,key,hash]);
    await validateReplay(client, opening.portfolio_id, opening.instrument_id, pair.exponent);
    return id;
  });
}
async function insertTrade(client: PoolClient, draft: TradeDraft, replacesId: string | null = null, chronologyOrder: string | null = null) {
  const pair = await activePair(client, draft.portfolioId, draft.instrumentId);
  const asset = (await client.query("SELECT currency_code FROM assets WHERE id=$1 AND is_active FOR SHARE", [draft.cashAssetId])).rows[0];
  if (!asset || asset.currency_code !== pair.currency) throw new InvestmentError("Aset kas harus aktif dan memiliki mata uang yang sama.");
  const { gross, fee } = tradeCash(draft.kind, draft.quantity, draft.unitPrice, draft.feeMinor, pair.exponent);
  const id = randomUUID();
  await client.query(`INSERT INTO investment_transactions (id,portfolio_id,instrument_id,currency_code,cash_asset_id,kind,quantity,unit_price,gross_minor,occurred_at,note,replaces_id,chronology_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id, draft.portfolioId, draft.instrumentId, pair.currency, draft.cashAssetId,
    draft.kind, draft.quantity, draft.unitPrice, gross.toString(), draft.occurredAt, draft.note ?? null, replacesId, chronologyOrder]);
  await client.query(`INSERT INTO ledger_movements (id,investment_transaction_id,asset_id,currency_code,component,amount_minor)
    VALUES ($1,$2,$3,$4,'investment_principal',$5)`, [randomUUID(), id, draft.cashAssetId, pair.currency, (draft.kind === "buy" ? -gross : gross).toString()]);
  if (fee) {
    const feeId = randomUUID();
    await client.query("INSERT INTO investment_trade_fees (id,transaction_id,amount_minor) VALUES ($1,$2,$3)", [feeId, id, fee.toString()]);
    await client.query(`INSERT INTO ledger_movements (id,investment_transaction_id,investment_fee_id,asset_id,currency_code,component,amount_minor)
      VALUES ($1,$2,$3,$4,$5,'investment_fee',$6)`, [randomUUID(), id, feeId, draft.cashAssetId, pair.currency, (-fee).toString()]);
  }
  await validateReplay(client, draft.portfolioId, draft.instrumentId, pair.exponent);
  return id;
}
export async function postInvestmentTrade(raw: TradeDraft, key: string) {
  const draft = tradeDraft(raw);
  return idempotent("trade", key, draft, (client) => insertTrade(client, draft));
}
async function reverseTrade(client: PoolClient, id: string, status: "voided" | "superseded") {
  const original = (await client.query(`SELECT t.*,COALESCE(t.chronology_order,t.event_order)::text AS replay_order,c.minor_unit_exponent AS exponent
    FROM investment_transactions t JOIN currencies c ON c.code=t.currency_code WHERE t.id=$1 FOR UPDATE OF t`, [id])).rows[0];
  if (!original || original.status !== "posted") throw new InvestmentError("Transaksi investasi ini sudah tidak aktif.");
  const movements = await client.query("SELECT id,asset_id,currency_code,amount_minor::text FROM ledger_movements WHERE investment_transaction_id=$1 AND component<>'reversal'", [id]);
  if (!movements.rowCount) throw new InvestmentError("Ledger investasi tidak lengkap.");
  for (const movement of movements.rows) await client.query(`INSERT INTO ledger_movements (id,investment_transaction_id,asset_id,currency_code,component,amount_minor,reverses_movement_id)
    VALUES ($1,$2,$3,$4,'reversal',$5,$6)`, [randomUUID(), id, movement.asset_id, movement.currency_code, (-BigInt(movement.amount_minor)).toString(), movement.id]);
  await client.query("UPDATE investment_transactions SET status=$2,voided_at=now() WHERE id=$1", [id, status]);
  return original;
}
export async function replaceInvestmentTrade(id: string, raw: TradeDraft, key: string) {
  uuid(id); const draft = tradeDraft(raw);
  return idempotent("replace", key, { id, draft }, async (client) => {
    const old = await reverseTrade(client, id, "superseded");
    const replacement = await insertTrade(client, draft, id, old.replay_order);
    // Also replay the original pair if the replacement moves to another position.
    await validateReplay(client, old.portfolio_id, old.instrument_id, old.exponent);
    return replacement;
  });
}
export async function voidInvestmentTrade(id: string, key: string) {
  uuid(id);
  return idempotent("void", key, { id }, async (client) => {
    const old = await reverseTrade(client, id, "voided");
    await validateReplay(client, old.portfolio_id, old.instrument_id, old.exponent); return id;
  });
}
export async function saveMarketPrice(raw: { instrumentId: string; price: string; asOf: string }, key: string, provider?: { id: string; currency: string }) {
  const draft = { instrumentId: uuid(raw.instrumentId), price: decimalString(decimal(raw.price)), asOf: timestamp(raw.asOf),
    sourceId: provider ? name(provider.id) : null, currency: provider ? text(provider.currency, 3) : null };
  if (draft.asOf > new Date().toISOString()) throw new InvestmentError("Harga saat ini tidak boleh berasal dari masa depan.");
  return idempotent("price", key, draft, async (client) => {
    const instrument = (await client.query("SELECT currency_code FROM investment_instruments WHERE id=$1 AND is_active FOR SHARE", [draft.instrumentId])).rows[0];
    if (!instrument || (draft.currency && instrument.currency_code !== draft.currency)) throw new InvestmentError("Instrumen atau mata uang harga tidak valid.");
    return insertPrice(client, draft.instrumentId, instrument.currency_code, draft.price, draft.asOf, draft.sourceId);
  });
}
export async function refreshMarketPrice(instrumentId: string, key: string) {
  await requireOwnerSession(); uuid(instrumentId); uuid(key);
  const provider = configuredPriceProvider();
  if (!provider) throw new InvestmentError("Penyedia harga otomatis belum dikonfigurasi. Gunakan harga manual.");
  const instrument = (await investmentSnapshot()).instruments.find((i) => i.id === instrumentId && i.isActive);
  if (!instrument) throw new InvestmentError("Instrumen tidak aktif.");
  const quote = await provider.fetchQuote(instrument);
  const validSource = provider.id === "composite"
    ? quote.sourceId !== "composite" && isRegisteredPriceProvider(quote.sourceId)
    : quote.sourceId === provider.id;
  if (quote.instrumentId !== instrumentId || !validSource) throw new InvestmentError("Referensi harga tidak sesuai.");
  return saveMarketPrice({ instrumentId, price: quote.price, asOf: quote.asOf }, key, { id: quote.sourceId, currency: quote.currency });
}

export async function restoreInvestment(kind: "portfolio" | "instrument", id: string) {
  if (!["portfolio", "instrument"].includes(kind)) throw new InvestmentError("Jenis tidak valid.");
  uuid(id);
  return locked(async (client) => {
    const table = kind === "portfolio" ? "investment_portfolios" : "investment_instruments";
    if (!(await client.query(`UPDATE ${table} SET is_active=true WHERE id=$1 RETURNING id`, [id])).rowCount) throw new InvestmentError("Data tidak ditemukan.");
    return id;
  });
}
export async function deleteInvestment(kind: "portfolio" | "instrument", id: string) {
  if (!["portfolio", "instrument"].includes(kind)) throw new InvestmentError("Jenis tidak valid.");
  uuid(id);
  return locked(async (client) => {
    await deleteUnused(client, kind === "portfolio" ? "investment_portfolios" : "investment_instruments", id, false);
    return id;
  });
}

/** Correct a manual quote by appending at its original timestamp; never rewrite history. */
export async function correctManualPrice(originalId: string, rawPrice: string, key: string) {
  const payload = { originalId: uuid(originalId), price: decimalString(decimal(rawPrice)) };
  return idempotent("price", key, payload, async (client) => {
    const original = (await client.query("SELECT * FROM investment_price_points WHERE id=$1", [payload.originalId])).rows[0];
    if (!original || original.source_type !== "manual") throw new InvestmentError("Hanya harga manual yang dapat dikoreksi.");
    const latest = (await client.query(`SELECT id FROM investment_price_points WHERE instrument_id=$1 AND as_of=$2
      ORDER BY inserted_at DESC,id DESC LIMIT 1`, [original.instrument_id, original.as_of])).rows[0];
    if (latest.id !== original.id) throw new InvestmentError("Harga ini sudah digantikan. Koreksi versi terakhir pada waktu yang sama.");
    if (!(await client.query("SELECT id FROM investment_instruments WHERE id=$1 AND is_active FOR SHARE", [original.instrument_id])).rowCount) throw new InvestmentError("Pulihkan instrumen dahulu sebelum mengoreksi harga.");
    // now() is transaction-start time. Explicit ordering beyond the original also
    // handles a prior import or two corrections within one PostgreSQL timestamp.
    const id = randomUUID();
    await client.query(`INSERT INTO investment_price_points (id,instrument_id,currency_code,price,as_of,source_type,inserted_at)
      VALUES ($1,$2,$3,$4,$5,'manual',GREATEST(clock_timestamp(),$6::timestamptz + interval '1 microsecond'))`,
      [id, original.instrument_id, original.currency_code, payload.price, original.as_of, original.inserted_at]);
    return id;
  });
}
