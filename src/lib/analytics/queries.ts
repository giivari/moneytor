import "server-only";
import type { PoolClient } from "pg";
import type { ReportingPeriod } from "./periods";
import type { AnalyticsExpenseItem, AnalyticsObligationItem, ChargeReport, DimensionRow, InvestmentFlows, SpendingItem } from "./types";
import { FEE_SYSTEM_KEYS, TAX_SYSTEM_KEYS } from "./domain";
import { CREDIT_REMINDER_NOTE_PREFIX } from "@/lib/domain/credit";

export type AggregateRow = DimensionRow & { dimension: "summary" | "category" | "category_parent" | "category_nature" | "income_category" | "weekday" | "account" | "origin" | "month" | "day" };
/** One effective activity is one fact. Charges are reduced before any dimension joins. */
export async function readAggregates(client: PoolClient, period: ReportingPeriod, currency: string | null, summaryOnly = false): Promise<AggregateRow[]> {
  const result = await client.query<AggregateRow>(`
    WITH RECURSIVE selected AS MATERIALIZED (
      SELECT * FROM financial_activities_effective WHERE status='posted' AND occurred_at >= $1 AND occurred_at < $2
        AND ($3::text IS NULL OR currency_code=$3)
    ), lineage AS (
      SELECT id,id AS ancestor FROM selected
      UNION SELECT l.id,f.replaces_activity_id FROM lineage l JOIN financial_activities f ON f.id=l.ancestor
        WHERE f.replaces_activity_id IS NOT NULL
    ), receipts AS (
      SELECT result_activity_id AS id,'allocation_adjustment' AS origin FROM automation_allocation_adjustments WHERE result_activity_id IS NOT NULL
      UNION ALL SELECT activity_id,'automation' FROM automation_action_results
      UNION ALL SELECT result_activity_id,'automation' FROM income_event_instances WHERE result_activity_id IS NOT NULL
      UNION ALL SELECT activity_id,'automation' FROM recurring_transaction_occurrences WHERE activity_id IS NOT NULL
    ), origins AS (
      SELECT l.id,CASE WHEN bool_or(r.origin='allocation_adjustment') THEN 'allocation_adjustment'
        WHEN bool_or(r.origin='automation') THEN 'automation' ELSE 'manual' END AS origin
      FROM lineage l LEFT JOIN receipts r ON r.id=l.ancestor GROUP BY l.id
    ), charges AS (
      SELECT ac.activity_id,sum(ac.amount_minor::numeric) AS total,
        sum(ac.amount_minor::numeric) FILTER (WHERE t.system_key=ANY($5::text[])) AS fees,
        sum(ac.amount_minor::numeric) FILTER (WHERE t.system_key=ANY($6::text[])) AS taxes,
        sum(ac.amount_minor::numeric) FILTER (WHERE t.system_key IS NULL OR NOT (t.system_key=ANY($5::text[]) OR t.system_key=ANY($6::text[]))) AS other,
        sum(ac.amount_minor::numeric) FILTER (WHERE f.kind='transfer') AS transfer_fees
      FROM activity_charges ac JOIN selected f ON f.id=ac.activity_id JOIN additional_charge_types t ON t.id=ac.charge_type_id
      GROUP BY ac.activity_id
    ), facts AS (
      SELECT f.*,c.minor_unit_exponent AS exponent,o.origin,
        cat.display_name AS category_name,cat.is_active AS category_active,
        ce.root_id,root.display_name AS root_name,root.is_active AS root_active,ce.effective_nature,
        a.display_name AS account_name,a.is_active AS account_active,
        COALESCE(f.source_asset_id,f.destination_asset_id) AS account_id,
        da.display_name AS dest_account_name,da.is_active AS dest_account_active,
        CASE WHEN f.kind='income' THEN f.base_amount_minor::numeric ELSE 0 END AS income,
        CASE WHEN f.kind='expense' THEN f.base_amount_minor::numeric WHEN f.kind='refund' THEN -f.base_amount_minor::numeric ELSE 0 END AS expense,
        CASE WHEN f.kind='adjustment' AND f.source_asset_id IS NULL THEN f.base_amount_minor::numeric ELSE 0 END AS adjustment_in,
        CASE WHEN f.kind='adjustment' AND f.source_asset_id IS NOT NULL THEN f.base_amount_minor::numeric ELSE 0 END AS adjustment_out,
        CASE WHEN f.kind='borrow' THEN f.base_amount_minor::numeric ELSE 0 END AS debt_borrowed,
        CASE WHEN f.kind='repay' THEN f.base_amount_minor::numeric ELSE 0 END AS debt_repaid,
        CASE WHEN f.kind='transfer' THEN f.base_amount_minor::numeric ELSE 0 END AS transfer,
        COALESCE(ch.total,0) AS charges,COALESCE(ch.fees,0) AS fees,COALESCE(ch.taxes,0) AS taxes,
        COALESCE(ch.other,0) AS other,COALESCE(ch.transfer_fees,0) AS transfer_fees
      FROM selected f JOIN currencies c ON c.code=f.currency_code JOIN origins o ON o.id=f.id
      LEFT JOIN charges ch ON ch.activity_id=f.id LEFT JOIN transaction_categories cat ON cat.id=f.category_id
      LEFT JOIN transaction_category_effective ce ON ce.id=f.category_id LEFT JOIN transaction_categories root ON root.id=ce.root_id
      JOIN assets a ON a.id=COALESCE(f.source_asset_id,f.destination_asset_id)
      LEFT JOIN assets da ON da.id=f.destination_asset_id AND f.kind='transfer'
    ), dimensions AS (
      SELECT d.dimension,d.key,d.dimension_id,d.name,d.archived,f.currency_code,f.exponent,f.kind,
        f.income,f.expense,f.fees,f.taxes,f.other,f.transfer_fees,f.charges,f.transfer,
        f.adjustment_in,f.adjustment_out,f.debt_borrowed,f.debt_repaid,
        0::numeric AS transfer_in,false AS is_transfer_in
      FROM facts f CROSS JOIN LATERAL (VALUES
        ('summary','summary',NULL::text,'Ringkasan',false),
        ('category',COALESCE(f.category_id::text,'uncategorized'),f.category_id::text,COALESCE(f.category_name,'Tanpa kategori'),NOT COALESCE(f.category_active,true)),
        ('category_parent',COALESCE(f.root_id::text,'uncategorized'),f.root_id::text,COALESCE(f.root_name,'Tanpa kategori'),NOT COALESCE(f.root_active,true)),
        ('category_nature',COALESCE(f.effective_nature,'none'),NULL::text,CASE f.effective_nature WHEN 'need' THEN 'Kebutuhan' WHEN 'want' THEN 'Keinginan' WHEN 'obligation' THEN 'Kewajiban' WHEN 'social' THEN 'Sosial' WHEN 'saving' THEN 'Tabungan' ELSE 'Tanpa sifat' END,false),
        ('income_category',COALESCE(f.category_id::text,'uncategorized'),f.category_id::text,COALESCE(f.category_name,'Tanpa kategori'),NOT COALESCE(f.category_active,true)),
        ('weekday',extract(isodow from f.occurred_at AT TIME ZONE 'Asia/Jakarta')::int::text,NULL::text,extract(isodow from f.occurred_at AT TIME ZONE 'Asia/Jakarta')::int::text,false),
        ('account',f.account_id::text,f.account_id::text,f.account_name,NOT f.account_active),
        ('origin',f.origin,NULL::text,f.origin,false),
        ('month',to_char(f.occurred_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM'),NULL::text,to_char(f.occurred_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM'),false),
        ('day',to_char(f.occurred_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD'),NULL::text,to_char(f.occurred_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD'),false)
      ) d(dimension,key,dimension_id,name,archived)
      WHERE (d.dimension NOT IN ('category','category_parent','category_nature') OR f.kind IN ('expense','refund'))
        AND (d.dimension<>'income_category' OR f.kind='income')
        AND (NOT $4::boolean OR d.dimension='summary')
      UNION ALL
      SELECT 'account',f.destination_asset_id::text,f.destination_asset_id::text,f.dest_account_name,NOT COALESCE(f.dest_account_active,true),
        f.currency_code,f.exponent,f.kind,
        0::numeric,0::numeric,0::numeric,0::numeric,0::numeric,0::numeric,0::numeric,0::numeric,
        0::numeric,0::numeric,0::numeric,0::numeric,
        f.base_amount_minor::numeric AS transfer_in,true AS is_transfer_in
      FROM facts f
      WHERE f.kind='transfer' AND f.destination_asset_id IS NOT NULL AND f.dest_account_name IS NOT NULL AND NOT $4::boolean
    )
    SELECT dimension,key,dimension_id AS id,name,archived,currency_code AS currency,exponent,
      sum(income)::text AS "incomeMinor",sum(expense)::text AS "expensePrincipalMinor",
      sum(fees)::text AS "feesMinor",sum(taxes)::text AS "taxesMinor",sum(other)::text AS "otherChargesMinor",
      sum(transfer_fees)::text AS "transferFeesMinor",sum(charges)::text AS "chargesMinor",
      sum(expense+charges)::text AS "spendingMinor",sum(income-expense-charges)::text AS "netMinor",
      sum(transfer)::text AS "transferPrincipalMinor",
      sum(adjustment_in)::text AS "adjustmentInMinor",sum(adjustment_out)::text AS "adjustmentOutMinor",
      sum(debt_borrowed)::text AS "debtBorrowedMinor",sum(debt_repaid)::text AS "debtRepaidMinor",
      sum(transfer_in)::text AS "transferInMinor",
      count(*)::text AS "activityCount",
      count(*) FILTER (WHERE kind='income')::text AS "incomeCount",
      count(*) FILTER (WHERE kind='expense')::text AS "expenseCount",
      count(*) FILTER (WHERE kind='refund')::text AS "refundCount",
      count(*) FILTER (WHERE kind='transfer' AND NOT is_transfer_in)::text AS "transferCount",
      count(*) FILTER (WHERE is_transfer_in)::text AS "transferInCount"
    FROM dimensions GROUP BY dimension,key,dimension_id,name,archived,currency_code,exponent
    ORDER BY currency_code COLLATE "C",dimension COLLATE "C",key COLLATE "C"`, [period.startAt, period.endAt, currency, summaryOnly, FEE_SYSTEM_KEYS, TAX_SYSTEM_KEYS]);
  return result.rows;
}
export async function readCharges(client: PoolClient, period: ReportingPeriod, currency: string | null): Promise<ChargeReport[]> {
  return (await client.query<ChargeReport>(`
    SELECT f.currency_code AS currency,c.minor_unit_exponent AS exponent,t.id AS "typeId",t.display_name AS name,
      t.system_key AS "systemKey",NOT t.is_active AS archived,f.kind AS "activityKind",
      CASE WHEN t.system_key=ANY($5::text[]) THEN 'tax' WHEN t.system_key=ANY($4::text[]) THEN 'fee' ELSE 'other' END AS bucket,
      sum(ac.amount_minor::numeric)::text AS "amountMinor",count(*)::text AS "chargeCount"
    FROM financial_activities f JOIN activity_charges ac ON ac.activity_id=f.id
      JOIN additional_charge_types t ON t.id=ac.charge_type_id JOIN currencies c ON c.code=f.currency_code
    WHERE f.status='posted' AND f.occurred_at >= $1 AND f.occurred_at < $2 AND ($3::text IS NULL OR f.currency_code=$3)
    GROUP BY f.currency_code,c.minor_unit_exponent,t.id,f.kind ORDER BY f.currency_code COLLATE "C",sum(ac.amount_minor::numeric) DESC,t.id,f.kind`,
  [period.startAt, period.endAt, currency, FEE_SYSTEM_KEYS, TAX_SYSTEM_KEYS])).rows;
}
export async function readInvestmentFlows(client: PoolClient, period: ReportingPeriod, currency: string | null): Promise<InvestmentFlows[]> {
  return (await client.query<InvestmentFlows>(`
    SELECT t.currency_code AS currency,c.minor_unit_exponent AS exponent,
      COALESCE(sum(t.gross_minor::numeric) FILTER (WHERE t.kind='buy'),0)::text AS "purchasePrincipalMinor",
      COALESCE(sum(t.gross_minor::numeric) FILTER (WHERE t.kind='sell'),0)::text AS "saleProceedsMinor",
      COALESCE(sum(f.amount_minor::numeric),0)::text AS "feesMinor",
      sum(CASE WHEN t.kind='buy' THEN -t.gross_minor::numeric ELSE t.gross_minor::numeric END-COALESCE(f.amount_minor::numeric,0))::text AS "netCashMinor",
      count(*)::text AS "tradeCount"
    FROM investment_transactions t JOIN currencies c ON c.code=t.currency_code LEFT JOIN investment_trade_fees f ON f.transaction_id=t.id
    WHERE t.status='posted' AND t.occurred_at >= $1 AND t.occurred_at < $2 AND ($3::text IS NULL OR t.currency_code=$3)
    GROUP BY t.currency_code,c.minor_unit_exponent ORDER BY t.currency_code COLLATE "C"`, [period.startAt, period.endAt, currency])).rows;
}
export async function readExpenseItems(client: PoolClient, period: ReportingPeriod, currency: string | null): Promise<AnalyticsExpenseItem[]> {
  const result = await client.query<{
    id: string;
    occurredAt: Date | string;
    currency: string;
    exponent: number;
    baseAmountMinor: string;
    chargesMinor: string;
    spendingMinor: string;
    categoryId: string | null;
    categoryName: string | null;
    sourceAssetId: string;
    sourceName: string;
    note: string | null;
    origin: AnalyticsExpenseItem["origin"];
    charges: { typeId: string; name?: string; amountMinor: string }[];
  }>(`
    WITH RECURSIVE selected AS MATERIALIZED (
      SELECT * FROM financial_activities WHERE status='posted' AND kind='expense' AND occurred_at >= $1 AND occurred_at < $2
        AND ($3::text IS NULL OR currency_code=$3)
    ), lineage AS (
      SELECT id,id AS ancestor FROM selected
      UNION SELECT l.id,f.replaces_activity_id FROM lineage l JOIN financial_activities f ON f.id=l.ancestor
        WHERE f.replaces_activity_id IS NOT NULL
    ), receipts AS (
      SELECT result_activity_id AS id,'allocation_adjustment' AS origin FROM automation_allocation_adjustments WHERE result_activity_id IS NOT NULL
      UNION ALL SELECT activity_id,'automation' FROM automation_action_results
      UNION ALL SELECT result_activity_id,'automation' FROM income_event_instances WHERE result_activity_id IS NOT NULL
      UNION ALL SELECT activity_id,'automation' FROM recurring_transaction_occurrences WHERE activity_id IS NOT NULL
    ), origins AS (
      SELECT l.id,CASE WHEN bool_or(r.origin='allocation_adjustment') THEN 'allocation_adjustment'
        WHEN bool_or(r.origin='automation') THEN 'automation' ELSE 'manual' END AS origin
      FROM lineage l LEFT JOIN receipts r ON r.id=l.ancestor GROUP BY l.id
    ), charges AS (
      SELECT ac.activity_id,sum(ac.amount_minor::numeric) AS total,
        COALESCE(jsonb_agg(jsonb_build_object('typeId', ac.charge_type_id::text, 'name', t.display_name, 'amountMinor', ac.amount_minor::text) ORDER BY ac.id), '[]'::jsonb) AS list
      FROM activity_charges ac JOIN selected f ON f.id=ac.activity_id JOIN additional_charge_types t ON t.id=ac.charge_type_id GROUP BY ac.activity_id
    )
    SELECT f.id::text AS id, f.occurred_at AS "occurredAt", f.currency_code AS currency, c.minor_unit_exponent AS exponent,
      f.base_amount_minor::text AS "baseAmountMinor", COALESCE(ch.total,0)::text AS "chargesMinor",
      (f.base_amount_minor::numeric + COALESCE(ch.total,0))::text AS "spendingMinor",
      refunded_in_chain(f.id)::text AS "refundedMinor",
      (f.base_amount_minor::numeric + COALESCE(ch.total,0) - refunded_in_chain(f.id))::text AS "netMinor",
      f.category_id::text AS "categoryId", cat.display_name AS "categoryName",
      f.source_asset_id::text AS "sourceAssetId", a.display_name AS "sourceName",
      f.note, o.origin, COALESCE(ch.list, '[]'::jsonb) AS charges
    FROM selected f JOIN currencies c ON c.code=f.currency_code JOIN origins o ON o.id=f.id
    LEFT JOIN charges ch ON ch.activity_id=f.id LEFT JOIN transaction_categories cat ON cat.id=f.category_id
    JOIN assets a ON a.id=f.source_asset_id
    ORDER BY (f.base_amount_minor::numeric + COALESCE(ch.total,0)) DESC, f.occurred_at DESC
    LIMIT 50`, [period.startAt, period.endAt, currency]);
  return result.rows.map((row) => ({
    ...row,
    occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt),
    charges: Array.isArray(row.charges) ? row.charges : [],
  }));
}

/** One line per activity that spends money in the period (expense, transfer/repay fees, refunds as negative), straight from spending_effects. */
export async function readSpendingItems(client: PoolClient, period: ReportingPeriod, currency: string | null): Promise<SpendingItem[]> {
  return (await client.query<SpendingItem>(`
    SELECT s.activity_id::text AS id, s.kind, min(s.occurred_at) AS "occurredAt", s.currency_code AS currency, c.minor_unit_exponent AS exponent,
      sum(s.amount_minor)::text AS "amountMinor", s.asset_id::text AS "assetId", s.category_id::text AS "categoryId", cat.display_name AS "categoryName"
    FROM spending_effects s JOIN currencies c ON c.code=s.currency_code LEFT JOIN transaction_categories cat ON cat.id=s.category_id
    WHERE s.occurred_at >= $1 AND s.occurred_at < $2 AND ($3::text IS NULL OR s.currency_code=$3)
    GROUP BY s.activity_id,s.kind,s.currency_code,c.minor_unit_exponent,s.asset_id,s.category_id,cat.display_name
    ORDER BY min(s.occurred_at) DESC, s.activity_id`, [period.startAt, period.endAt, currency])).rows.map((row) => ({
    ...row, occurredAt: (row.occurredAt as unknown) instanceof Date ? (row.occurredAt as unknown as Date).toISOString() : String(row.occurredAt),
  }));
}

export type ObligationAnalyticsRow = AnalyticsObligationItem & {
  currency: string;
  exponent: number;
  settledInPeriod: boolean;
};

export async function readObligationsForAnalytics(
  client: PoolClient,
  period: ReportingPeriod,
  currency: string | null,
): Promise<ObligationAnalyticsRow[]> {
  const result = await client.query<ObligationAnalyticsRow>(`
    SELECT o.id::text AS id, o.title, l.display_name AS "labelName",
      o.currency_code AS currency, c.minor_unit_exponent AS exponent,
      o.amount_minor::text AS "amountMinor", o.due_on::text AS "dueOn", o.status,
      COALESCE(o.settled_at >= $1 AND o.settled_at < $2, false) AS "settledInPeriod",
      LEAST(o.amount_minor::numeric, COALESCE(r.reserved, 0))::text AS "coveredMinor",
      GREATEST(o.amount_minor::numeric - COALESCE(r.reserved, 0), 0)::text AS "uncoveredMinor"
    FROM planning_obligations o
    JOIN planning_labels l ON l.id = o.label_id
    JOIN currencies c ON c.code = o.currency_code
    LEFT JOIN (
      SELECT obligation_id, sum(amount_minor::numeric) AS reserved
      FROM planning_reserves
      WHERE is_active AND obligation_id IS NOT NULL
      GROUP BY obligation_id
    ) r ON r.obligation_id = o.id
    WHERE ($3::text IS NULL OR o.currency_code = $3)
      AND (o.status = 'open' OR (o.status = 'settled' AND o.settled_at >= $1 AND o.settled_at < $2))
      -- Credit installment reminders are already in the credit facility totals.
      AND (o.note IS NULL OR o.note NOT LIKE $4)
    ORDER BY (o.status = 'open') DESC, o.due_on ASC, o.id ASC`,
    [period.startAt, period.endAt, currency, `${CREDIT_REMINDER_NOTE_PREFIX}%`],
  );
  return result.rows;
}
