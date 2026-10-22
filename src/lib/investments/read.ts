import "server-only";
import { unreferencedSql } from "@/lib/repositories/lifecycle";
import type { PoolClient } from "pg";
import { requireOwnerSession } from "@/lib/auth/session";
import { database, inDatabaseTransaction } from "@/lib/db/pool";
import { hasOpeningCorrections } from "@/lib/db/opening-capability";
import { decimal, decimalString, replayPosition, valuation } from "@/lib/investments/math";
import { configuredPriceProvider } from "@/lib/investments/providers";
import type { Holding, Instrument, InstrumentType, InvestmentSnapshot, InvestmentTotal, InvestmentTrade, OpeningCorrection, RecordedOpening, Portfolio, PricePoint } from "./types";

function accumulate(current: InvestmentTotal | undefined, holding: Pick<Holding, "costBasisMinor" | "realizedMinor" | "marketMinor" | "unrealizedMinor" | "quantity">, instrument: Pick<Instrument, "currency" | "exponent">): InvestmentTotal {
  const total = current ?? { currency: instrument.currency, exponent: instrument.exponent, marketMinor: "0", costBasisMinor: "0",
    pricedCostBasisMinor: "0", unrealizedMinor: "0", realizedMinor: "0", unpricedCount: 0 };
  total.costBasisMinor = (BigInt(total.costBasisMinor) + BigInt(holding.costBasisMinor)).toString();
  total.realizedMinor = (BigInt(total.realizedMinor) + BigInt(holding.realizedMinor)).toString();
  if (holding.marketMinor !== null) {
    total.marketMinor = (BigInt(total.marketMinor) + BigInt(holding.marketMinor)).toString();
    total.pricedCostBasisMinor = (BigInt(total.pricedCostBasisMinor) + BigInt(holding.costBasisMinor)).toString();
    total.unrealizedMinor = (BigInt(total.unrealizedMinor) + BigInt(holding.unrealizedMinor!)).toString();
  } else if (holding.quantity !== "0") total.unpricedCount++;
  return total;
}

export async function investmentSnapshot(existing?: PoolClient): Promise<InvestmentSnapshot> {
  const readSnapshot = await prepareOwnerInvestmentRead();
  if (existing) return readSnapshot(existing);
  return inDatabaseTransaction(async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return readSnapshot(client);
  });
}

/** Request-local authorized reader. Never cache this closure or retain it between requests. */
export async function prepareOwnerInvestmentRead() {
  await requireOwnerSession();
  return read;
}

/** Home/Assets need exact totals, not workspace metadata or inactive trade/price history. */
export async function prepareOwnerInvestmentSummaryRead() {
  await requireOwnerSession();
  return readSummary;
}
async function readSummary(client: PoolClient) {
  const ready = await hasOpeningCorrections(client);
  const pairs = (await client.query<{ portfolio_id: string; instrument_id: string; currency: string; exponent: number }>(`
    SELECT pairs.*,i.currency_code AS currency,c.minor_unit_exponent AS exponent
    FROM (SELECT portfolio_id,instrument_id FROM investment_opening_positions
      UNION SELECT portfolio_id,instrument_id FROM investment_transactions) pairs
    JOIN investment_instruments i ON i.id=pairs.instrument_id JOIN currencies c ON c.code=i.currency_code`)).rows;
  if (!pairs.length) return { totals: [] as InvestmentTotal[], hasHoldings: false };
  const openings = (await client.query(`SELECT o.portfolio_id,o.instrument_id,
    ${ready ? "COALESCE(c.corrected_quantity,o.quantity)" : "o.quantity"}::text AS quantity,
    ${ready ? "COALESCE(c.corrected_cost_basis_minor,o.cost_basis_minor)" : "o.cost_basis_minor"}::text AS cost_basis_minor,o.occurred_at
    FROM investment_opening_positions o ${ready ? `LEFT JOIN LATERAL
    (SELECT corrected_quantity,corrected_cost_basis_minor FROM investment_opening_corrections WHERE opening_id=o.id ORDER BY correction_order DESC LIMIT 1) c ON true` : ""}`)).rows;
  const trades = (await client.query(`SELECT t.id,t.portfolio_id,t.instrument_id,t.kind,t.quantity::text,t.gross_minor::text,
    COALESCE(f.amount_minor,0)::text AS fee_minor,t.occurred_at,COALESCE(t.chronology_order,t.event_order)::text AS replay_order
    FROM investment_transactions t LEFT JOIN investment_trade_fees f ON f.transaction_id=t.id WHERE t.status='posted'`)).rows;
  const prices = (await client.query<{ instrument_id: string; price: string }>(`SELECT DISTINCT ON (instrument_id) instrument_id,price::text
    FROM investment_price_points WHERE as_of<=now() AND instrument_id=ANY($1::uuid[])
    ORDER BY instrument_id,as_of DESC,inserted_at DESC,id DESC`, [[...new Set(pairs.map((p) => p.instrument_id))]])).rows;
  const openingByPair = new Map(openings.map((o) => [`${o.portfolio_id}/${o.instrument_id}`, { quantity: o.quantity, costBasisMinor: o.cost_basis_minor, occurredAt: o.occurred_at.toISOString() }]));
  const tradeByPair = new Map<string, Parameters<typeof replayPosition>[1][number][]>();
  for (const t of trades) {
    const key = `${t.portfolio_id}/${t.instrument_id}`;
    const rows = tradeByPair.get(key) ?? [];
    rows.push({ id: t.id, kind: t.kind, quantity: t.quantity, grossMinor: t.gross_minor, feeMinor: t.fee_minor, occurredAt: t.occurred_at.toISOString(), order: t.replay_order });
    tradeByPair.set(key, rows);
  }
  const priceByInstrument = new Map(prices.map((p) => [p.instrument_id, p.price]));
  const totals = new Map<string, InvestmentTotal>();
  for (const pair of pairs) {
    const key = `${pair.portfolio_id}/${pair.instrument_id}`;
    const position = replayPosition(openingByPair.get(key), tradeByPair.get(key) ?? [], pair.exponent);
    const value = valuation(position.quantity, position.costBasisMinor, priceByInstrument.get(pair.instrument_id) ?? null, pair.exponent);
    totals.set(pair.currency, accumulate(totals.get(pair.currency), { ...position, ...value }, pair));
  }
  return { totals: [...totals.values()], hasHoldings: true };
}
async function read(client: PoolClient): Promise<InvestmentSnapshot> {
  const ready = await hasOpeningCorrections(client);
  const portfolioRows = await client.query(`SELECT p.*,(NOT p.is_active AND ${unreferencedSql("investment_portfolios", "p.id")}) AS can_delete,c.minor_unit_exponent AS exponent,f.display_name AS provider_name
    FROM investment_portfolios p JOIN currencies c ON c.code=p.currency_code LEFT JOIN financial_providers f ON f.id=p.provider_id ORDER BY p.created_at,p.id`);
  const portfolios: Portfolio[] = portfolioRows.rows.map((r) => ({ id: r.id, displayName: r.display_name, currency: r.currency_code, exponent: r.exponent,
    providerId: r.provider_id, providerName: r.provider_name, note: r.note, isActive: r.is_active, canDelete: r.can_delete }));
  const instrumentRows = await client.query(`SELECT i.*,(NOT i.is_active AND ${unreferencedSql("investment_instruments", "i.id")}) AS can_delete,c.minor_unit_exponent AS exponent,t.display_name AS type_name
    FROM investment_instruments i JOIN currencies c ON c.code=i.currency_code JOIN investment_instrument_types t ON t.id=i.instrument_type_id ORDER BY i.created_at,i.id`);
  const instruments: Instrument[] = instrumentRows.rows.map((r) => ({ id: r.id, displayName: r.display_name, symbol: r.symbol, market: r.market,
    typeId: r.instrument_type_id, typeName: r.type_name, currency: r.currency_code, exponent: r.exponent, priceSymbol: r.price_symbol, isActive: r.is_active, canDelete: r.can_delete }));
  const types = await client.query("SELECT * FROM investment_instrument_types ORDER BY created_at,id");
  const instrumentTypes: InstrumentType[] = types.rows.map((r) => ({ id: r.id, displayName: r.display_name, isBuiltIn: r.is_builtin, isActive: r.is_active }));
  const openingRows = await client.query(`SELECT o.*,
    ${ready ? "COALESCE(c.corrected_quantity,o.quantity)" : "o.quantity"}::text AS effective_quantity,
    ${ready ? "COALESCE(c.corrected_cost_basis_minor,o.cost_basis_minor)" : "o.cost_basis_minor"}::text AS effective_cost_basis_minor,
    o.quantity::text AS original_quantity,o.cost_basis_minor::text AS original_cost_basis_minor
    FROM investment_opening_positions o ${ready ? `LEFT JOIN LATERAL
    (SELECT corrected_quantity,corrected_cost_basis_minor FROM investment_opening_corrections WHERE opening_id=o.id ORDER BY correction_order DESC LIMIT 1) c ON true` : ""}
    ORDER BY o.occurred_at,o.id`);
  const openings: RecordedOpening[] = openingRows.rows.map((r) => ({ id: r.id, portfolioId: r.portfolio_id, instrumentId: r.instrument_id,
    quantity: decimalString(decimal(r.effective_quantity)), costBasisMinor: r.effective_cost_basis_minor,
    originalQuantity: decimalString(decimal(r.original_quantity)), originalCostBasisMinor: r.original_cost_basis_minor,
    occurredAt: r.occurred_at.toISOString() }));
  const tradeRows = await client.query(`SELECT t.*,t.quantity::text,t.unit_price::text,t.gross_minor::text,
    COALESCE(f.amount_minor,0)::text AS fee_minor,COALESCE(t.chronology_order,t.event_order)::text AS replay_order
    FROM investment_transactions t LEFT JOIN investment_trade_fees f ON f.transaction_id=t.id ORDER BY t.occurred_at,COALESCE(t.chronology_order,t.event_order),t.event_order`);
  const trades: InvestmentTrade[] = tradeRows.rows.map((r) => ({ id: r.id, portfolioId: r.portfolio_id, instrumentId: r.instrument_id,
    cashAssetId: r.cash_asset_id, currency: r.currency_code, kind: r.kind, quantity: decimalString(decimal(r.quantity)), unitPrice: decimalString(decimal(r.unit_price)),
    grossMinor: r.gross_minor, feeMinor: r.fee_minor, occurredAt: r.occurred_at.toISOString(), createdAt: r.created_at.toISOString(),
    order: r.replay_order, status: r.status, replacesId: r.replaces_id, note: r.note ?? undefined, removedMinor: null, realizedMinor: null }));
  const priceRows = await client.query("SELECT *,price::text FROM investment_price_points ORDER BY as_of DESC,inserted_at DESC,id DESC");
  const prices: PricePoint[] = priceRows.rows.map((r) => ({ id: r.id, instrumentId: r.instrument_id, price: decimalString(decimal(r.price)), currency: r.currency_code,
    asOf: r.as_of.toISOString(), sourceType: r.source_type, sourceId: r.source_id, insertedAt: r.inserted_at.toISOString() }));
  const pairs = new Map<string, { portfolioId: string; instrumentId: string }>();
  for (const item of [...openings, ...trades]) pairs.set(`${item.portfolioId}/${item.instrumentId}`, { portfolioId: item.portfolioId, instrumentId: item.instrumentId });
  const holdings: Holding[] = [];
  const instrumentsById = new Map(instruments.map((item) => [item.id, item]));
  const openingsByPair = new Map(openings.map((item) => [`${item.portfolioId}/${item.instrumentId}`, item]));
  const eventsByPair = new Map<string, InvestmentTrade[]>();
  for (const event of trades) if (event.status === "posted") {
    const key = `${event.portfolioId}/${event.instrumentId}`;
    const events = eventsByPair.get(key) ?? [];
    events.push(event); eventsByPair.set(key, events);
  }
  const currentPrices = new Map<string, PricePoint>();
  const now = new Date().toISOString();
  for (const price of prices) if (price.asOf <= now && !currentPrices.has(price.instrumentId)) currentPrices.set(price.instrumentId, price);
  const totals = new Map<string, InvestmentTotal>();
  const portfolioTotals = new Map<string, InvestmentTotal>();
  const instrumentTotals = new Map<string, InvestmentTotal>();
  for (const pair of pairs.values()) {
    const instrument = instrumentsById.get(pair.instrumentId)!;
    const key = `${pair.portfolioId}/${pair.instrumentId}`;
    const opening = openingsByPair.get(key) ?? null;
    const events = eventsByPair.get(key) ?? [];
    const { sells, ...position } = replayPosition(opening ?? undefined, events, instrument.exponent);
    for (const event of events) if (sells[event.id]) Object.assign(event, sells[event.id]);
    // Future-dated points are retained as history but never presented as a current quote.
    const price = currentPrices.get(pair.instrumentId) ?? null;
    const value = valuation(position.quantity, position.costBasisMinor, price?.price ?? null, instrument.exponent);
    const holding = { ...pair, ...position, ...value, price, stale: Boolean(price && Date.now() - new Date(price.asOf).getTime() > 86400000), opening };
    holdings.push(holding);
    totals.set(instrument.currency, accumulate(totals.get(instrument.currency), holding, instrument));
    portfolioTotals.set(pair.portfolioId, accumulate(portfolioTotals.get(pair.portfolioId), holding, instrument));
    instrumentTotals.set(pair.instrumentId, accumulate(instrumentTotals.get(pair.instrumentId), holding, instrument));
  }
  return { portfolios, instruments, instrumentTypes, holdings, trades, prices, totals: [...totals.values()],
    portfolioTotals: [...portfolioTotals.entries()].map(([portfolioId, total]) => ({ portfolioId, ...total })),
    instrumentTotals: [...instrumentTotals.entries()].map(([instrumentId, total]) => ({ instrumentId, ...total })), providerConfigured: Boolean(configuredPriceProvider()) };
}

/** Fetches audit detail only when the owner opens an opening-position history. */
export async function investmentOpeningHistory(openingId: string): Promise<OpeningCorrection[]> {
  await requireOwnerSession();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(openingId)) throw new Error("Invalid opening id");
  if (!await hasOpeningCorrections(database())) return [];
  const result = await database().query(`SELECT id,opening_id,previous_quantity::text,corrected_quantity::text,
    previous_cost_basis_minor::text,corrected_cost_basis_minor::text,note,created_at
    FROM investment_opening_corrections WHERE opening_id=$1 ORDER BY correction_order DESC`, [openingId]);
  return result.rows.map((r) => ({ id: r.id, openingId: r.opening_id,
    previousQuantity: decimalString(decimal(r.previous_quantity)), correctedQuantity: decimalString(decimal(r.corrected_quantity)),
    previousCostBasisMinor: r.previous_cost_basis_minor, correctedCostBasisMinor: r.corrected_cost_basis_minor,
    note: r.note, createdAt: r.created_at.toISOString() }));
}
