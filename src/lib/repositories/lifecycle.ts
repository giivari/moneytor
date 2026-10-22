import "server-only";
import type { PoolClient } from "pg";

export class LifecycleError extends Error {}

// Known incoming references, including inactive and voided history.
export const lifecycleReferences = {
  financial_providers: [["assets", "provider_id"], ["investment_portfolios", "provider_id"]],
  payment_networks: [["assets", "payment_network_id"]],
  asset_types: [["assets", "asset_type_id"]],
  asset_groups: [["assets", "asset_group_id"]],
  transaction_categories: [["financial_activities", "category_id"], ["planning_budgets", "category_id"], ["recurring_transaction_rules", "category_id"], ["recurring_transaction_occurrences", "category_id"], ["income_event_rule_versions", "category_id"], ["income_event_instances", "category_id"], ["automation_actions", "category_id"], ["automation_conditions", "category_id"], ["automation_allocation_assessments", "category_id"]],
  additional_charge_types: [["activity_charges", "charge_type_id"], ["recurring_rule_charges", "type_id"], ["recurring_occurrence_charges", "type_id"], ["automation_action_charges", "type_id"]],
  investment_instrument_types: [["investment_instruments", "instrument_type_id"]],
  investment_portfolios: [["investment_opening_positions", "portfolio_id"], ["investment_transactions", "portfolio_id"]],
  investment_instruments: [["investment_opening_positions", "instrument_id"], ["investment_transactions", "instrument_id"], ["investment_price_points", "instrument_id"]],
} as const;
export type LifecycleTable = keyof typeof lifecycleReferences;

// idExpression is a trusted SQL expression supplied by server readers, never input.
export function unreferencedSql(table: LifecycleTable, idExpression = "$1", planningReady = false, automationReady = false, eventReady = false, generalReady = false, allocationReady = false) {
  const references = lifecycleReferences[table].filter(([child]) => (planningReady || child !== "planning_budgets") &&
    (automationReady || !child.startsWith("recurring_")) && (eventReady || !child.startsWith("income_event_")) &&
    (child === "automation_allocation_assessments" ? allocationReady : generalReady || !child.startsWith("automation_")))
    .map(([child, column]) => `NOT EXISTS (SELECT 1 FROM ${child} WHERE ${column}=${idExpression})`);
  if (table === "additional_charge_types" && eventReady) {
    for (const child of ["income_event_rule_versions","income_event_instances"]) references.push(
      `NOT EXISTS (SELECT 1 FROM ${child} WHERE charges @> jsonb_build_array(jsonb_build_object('typeId',${idExpression}::text)))`);
  }
  if (table === "additional_charge_types" && generalReady) {
    references.push(
      `NOT EXISTS (SELECT 1 FROM automation_instances WHERE COALESCE(action_snapshot->'charges','[]'::jsonb) @> jsonb_build_array(jsonb_build_object('typeId',${idExpression}::text)))`);
  }
  if (table === "additional_charge_types" && allocationReady) {
    references.push(
      `NOT EXISTS (SELECT 1 FROM automation_allocation_adjustments WHERE charges @> jsonb_build_array(jsonb_build_object('typeId',${idExpression}::text)))`);
  }
  return references.join(" AND ");
}

export async function readLifecycleFlags(connection: Pick<PoolClient, "query">, table: LifecycleTable, enabled = true) {
  if (!enabled || (table !== "transaction_categories" && table !== "additional_charge_types")) {
    return { planning: false, automation: false, event: false, general: false, allocation: false };
  }
  const row = (await connection.query<{
    planning: boolean; automation: boolean; event: boolean; general: boolean; allocation: boolean;
  }>(`SELECT
    to_regclass('planning_budgets') IS NOT NULL AS planning,
    to_regclass('recurring_transaction_rules') IS NOT NULL AS automation,
    to_regclass('income_event_rules') IS NOT NULL AS event,
    to_regclass('automation_actions') IS NOT NULL AS general,
    to_regclass('automation_allocation_assessments') IS NOT NULL AS allocation`)).rows[0];
  return {
    planning: table === "transaction_categories" && row.planning,
    automation: row.automation,
    event: row.event,
    general: row.general,
    allocation: row.allocation,
  };
}

export async function deleteUnused(client: PoolClient, table: LifecycleTable, id: string, customOnly: boolean) {
  const row = (await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id])).rows[0];
  if (!row) throw new LifecycleError("Data tidak ditemukan. Muat ulang halaman.");
  if (customOnly && (row.is_builtin || row.system_key !== null)) throw new LifecycleError("Pilihan bawaan tidak dapat dihapus.");
  if (row.is_active) throw new LifecycleError("Arsipkan dahulu sebelum menghapus permanen.");
  const flags = await readLifecycleFlags(client, table, true);
  const allowed = (await client.query(
    `SELECT ${unreferencedSql(table, "$1", flags.planning, flags.automation, flags.event, flags.general, flags.allocation)} AS allowed`,
    [id],
  )).rows[0].allowed;
  if (!allowed) throw new LifecycleError("Data ini sudah memiliki referensi atau riwayat dan tidak dapat dihapus. Tetap arsipkan, atau pulihkan untuk digunakan kembali.");
  try {
    // The row lock serializes restore/delete. FK key-share locks and constraints
    // also prevent an insertion racing this check from creating an orphan.
    await client.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
  } catch (error) {
    if ((error as { code?: string }).code === "23503") throw new LifecycleError("Data telah dipakai dan tidak dapat dihapus. Riwayat tetap tersimpan.");
    throw error;
  }
}
