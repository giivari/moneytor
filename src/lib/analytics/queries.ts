import "server-only";
import type { PoolClient } from "pg";
import type { ReportingPeriod } from "./periods";
import type { ChargeReport, DimensionRow, InvestmentFlows } from "./types";
import { FEE_SYSTEM_KEYS, TAX_SYSTEM_KEYS } from "./domain";

export type AggregateRow = DimensionRow & { dimension: "summary" | "category" | "account" | "origin" | "month" | "day" };
/** One effective activity is one fact. Charges are reduced before any dimension joins. */
export async function readAggregates(client: PoolClient, period: ReportingPeriod, currency: string | null, summaryOnly = false): Promise<AggregateRow[]> {
  const result = await client.query<AggregateRow>(`
    WITH RECURSIVE selected AS MATERIALIZED (
      SELECT * FROM financial_activities WHERE status='posted' AND occurred_at >= $1 AND occurred_at < $2
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
        a.display_name AS account_name,a.is_active AS account_active,
        COALESCE(f.source_asset_id,f.destination_asset_id) AS account_id,
        CASE WHEN f.kind='income' THEN f.base_amount_minor::numeric ELSE 0 END AS income,
        CASE WHEN f.kind='expense' THEN f.base_amount_minor::numeric ELSE 0 END AS expense,
        CASE WHEN f.kind='transfer' THEN f.base_amount_minor::numeric ELSE 0 END AS transfer,
        COALESCE(ch.total,0) AS charges,COALESCE(ch.fees,0) AS fees,COALESCE(ch.taxes,0) AS taxes,
        COALESCE(ch.other,0) AS other,COALESCE(ch.transfer_fees,0) AS transfer_fees
      FROM selected f JOIN currencies c ON c.code=f.currency_code JOIN origins o ON o.id=f.id
      LEFT JOIN charges ch ON ch.activity_id=f.id LEFT JOIN transaction_categories cat ON cat.id=f.category_id
      JOIN assets a ON a.id=COALESCE(f.source_asset_id,f.destination_asset_id)
    ), dimensions AS (
      SELECT f.*,d.* FROM facts f CROSS JOIN LATERAL (VALUES
        ('summary','summary',NULL::text,'Ringkasan',false),
        ('category',COALESCE(f.category_id::text,'uncategorized'),f.category_id::text,COALESCE(f.category_name,'Tanpa kategori'),NOT COALESCE(f.category_active,true)),
        ('account',f.account_id::text,f.account_id::text,f.account_name,NOT f.account_active),
        ('origin',f.origin,NULL::text,f.origin,false),
        ('month',to_char(f.occurred_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM'),NULL::text,to_char(f.occurred_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM'),false),
        ('day',to_char(f.occurred_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD'),NULL::text,to_char(f.occurred_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD'),false)
      ) d(dimension,key,dimension_id,name,archived)
      WHERE (d.dimension<>'category' OR f.kind='expense') AND (NOT $4::boolean OR d.dimension='summary')
    )
    SELECT dimension,key,dimension_id AS id,name,archived,currency_code AS currency,exponent,
      sum(income)::text AS "incomeMinor",sum(expense)::text AS "expensePrincipalMinor",
      sum(fees)::text AS "feesMinor",sum(taxes)::text AS "taxesMinor",sum(other)::text AS "otherChargesMinor",
      sum(transfer_fees)::text AS "transferFeesMinor",sum(charges)::text AS "chargesMinor",
      sum(expense+charges)::text AS "spendingMinor",sum(income-expense-charges)::text AS "netMinor",
      sum(transfer)::text AS "transferPrincipalMinor",count(*)::text AS "activityCount",
      count(*) FILTER (WHERE kind='income')::text AS "incomeCount",
      count(*) FILTER (WHERE kind='expense')::text AS "expenseCount",
      count(*) FILTER (WHERE kind='transfer')::text AS "transferCount"
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
