import { requireOwnerSession } from "@/lib/auth/session";
import "server-only";
import { randomUUID } from "node:crypto";
import { database, inDatabaseTransaction } from "@/lib/db/pool";
import { assertUuid, validateCatalogName, type CatalogItem } from "@/lib/domain/catalog";

import { deleteUnused, LifecycleError, readLifecycleFlags, unreferencedSql } from "@/lib/repositories/lifecycle";

const catalogTables = {
  providers: "financial_providers",
  paymentNetworks: "payment_networks",
  assetTypes: "asset_types",
  assetGroups: "asset_groups",
  transactionCategories: "transaction_categories",
  chargeTypes: "additional_charge_types",
  instrumentTypes: "investment_instrument_types",
} as const;

export type Catalog = keyof typeof catalogTables;
export type CategoryScope = "income" | "expense";
export type CatalogRecord = CatalogItem & { appliesTo?: CategoryScope; canDelete?: boolean };

type CatalogRow = {
  id: string;
  display_name: string;
  system_key: string | null;
  is_builtin: boolean;
  is_active: boolean;
  applies_to?: CategoryScope;
  can_delete?: boolean;
};

function toCatalogItem(row: CatalogRow): CatalogRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    systemKey: row.system_key,
    isBuiltIn: row.is_builtin,
    isActive: row.is_active,
    ...(row.can_delete !== undefined ? { canDelete: row.can_delete } : {}),
    ...(row.applies_to ? { appliesTo: row.applies_to } : {}),
  };
}

export async function listCatalog(catalog: Catalog, includeArchived = false): Promise<CatalogRecord[]> {
  await requireOwnerSession();
  const table = catalogTables[catalog];
  const flags = await readLifecycleFlags(database(), table, includeArchived);
  const eligibility = includeArchived ? `, (NOT is_builtin AND system_key IS NULL AND NOT is_active AND ${unreferencedSql(table, "entry.id", flags.planning, flags.automation, flags.event, flags.general, flags.allocation)}) AS can_delete` : "";
  const scope = catalog === "transactionCategories" ? ", applies_to" : "";
  const result = await database().query<CatalogRow>(
    `SELECT id, display_name, system_key, is_builtin, is_active${scope}${eligibility}
     FROM ${table} entry WHERE ($1::boolean OR is_active) ORDER BY display_name, id`,
    [includeArchived],
  );
  return result.rows.map(toCatalogItem);
}

export async function insertCustomCatalogItem(
  catalog: Exclude<Catalog, "transactionCategories">,
  displayName: string,
): Promise<CatalogRecord> {
  await requireOwnerSession();
  const table = catalogTables[catalog];
  const id = randomUUID();
  const result = await database().query<CatalogRow>(
    `INSERT INTO ${table} (id, display_name, is_builtin, system_key)
     VALUES ($1, $2, false, NULL)
     RETURNING id, display_name, system_key, is_builtin, is_active`,
    [id, validateCatalogName(displayName)],
  );
  return toCatalogItem(result.rows[0]);
}

export async function renameCustomCatalogItem(catalog: Catalog, id: string, displayName: string): Promise<void> {
  await requireOwnerSession();
  assertUuid(id);
  const result = await database().query(
    `UPDATE ${catalogTables[catalog]} SET display_name=$2
     WHERE id=$1 AND NOT is_builtin RETURNING id`,
    [id, validateCatalogName(displayName)],
  );
  if (!result.rowCount) throw new Error("Item kustom aktif tidak ditemukan");
}

export async function archiveCustomCatalogItem(catalog: Catalog, id: string): Promise<void> {
  await requireOwnerSession();
  assertUuid(id);
  const result = await database().query(
    `UPDATE ${catalogTables[catalog]} SET is_active=false
     WHERE id=$1 AND NOT is_builtin AND is_active RETURNING id`,
    [id],
  );
  if (!result.rowCount) throw new Error("Item kustom aktif tidak ditemukan");
}

export async function insertCustomCategory(displayName: string, appliesTo: CategoryScope): Promise<CatalogRecord> {
  await requireOwnerSession();
  if (appliesTo !== "income" && appliesTo !== "expense") throw new Error("Invalid category scope");
  const id = randomUUID();
  const result = await database().query<CatalogRow>(
    `INSERT INTO transaction_categories (id, display_name, applies_to, is_builtin, system_key)
     VALUES ($1, $2, $3, false, NULL)
     RETURNING id, display_name, applies_to, system_key, is_builtin, is_active`,
    [id, validateCatalogName(displayName), appliesTo],
  );
  return toCatalogItem(result.rows[0]);
}

export async function restoreCustomCatalogItem(catalog: Catalog, id: string): Promise<void> {
  await requireOwnerSession(); assertUuid(id);
  const result = await database().query(`UPDATE ${catalogTables[catalog]} SET is_active=true WHERE id=$1 AND NOT is_builtin RETURNING id`, [id]);
  if (!result.rowCount) throw new LifecycleError("Pilihan kustom tidak ditemukan.");
}
export async function deleteCustomCatalogItem(catalog: Catalog, id: string): Promise<void> {
  await requireOwnerSession(); assertUuid(id);
  await inDatabaseTransaction((client) => deleteUnused(client, catalogTables[catalog], id, true));
}
