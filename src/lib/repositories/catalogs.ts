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
export type CategoryNature = "need" | "want" | "obligation" | "social" | "saving";
export const CATEGORY_NATURES: readonly CategoryNature[] = ["need", "want", "obligation", "social", "saving"];
/** Categories also carry the two-level hierarchy and nature; effectiveNature = override, else own, else the parent's. */
export type CatalogRecord = CatalogItem & { appliesTo?: CategoryScope; canDelete?: boolean;
  parentId?: string | null; nature?: CategoryNature | null; natureOverride?: CategoryNature | null; effectiveNature?: CategoryNature | null };

type CatalogRow = {
  id: string;
  display_name: string;
  system_key: string | null;
  is_builtin: boolean;
  is_active: boolean;
  applies_to?: CategoryScope;
  can_delete?: boolean;
  parent_id?: string | null; nature?: CategoryNature | null; nature_override?: CategoryNature | null; effective_nature?: CategoryNature | null;
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
    ...(row.applies_to ? { parentId: row.parent_id ?? null, nature: row.nature ?? null,
      natureOverride: row.nature_override ?? null, effectiveNature: row.effective_nature ?? null } : {}),
  };
}

export async function listCatalog(catalog: Catalog, includeArchived = false): Promise<CatalogRecord[]> {
  await requireOwnerSession();
  const table = catalogTables[catalog];
  const flags = await readLifecycleFlags(database(), table, includeArchived);
  const eligibility = includeArchived ? `, (NOT is_builtin AND system_key IS NULL AND NOT is_active AND ${unreferencedSql(table, "entry.id", flags.planning, flags.automation, flags.event, flags.general, flags.allocation)}) AS can_delete` : "";
  const scope = catalog === "transactionCategories" ? `, applies_to, parent_id, nature,
    (SELECT e.nature_override FROM transaction_category_effective e WHERE e.id=entry.id) AS nature_override,
    (SELECT e.effective_nature FROM transaction_category_effective e WHERE e.id=entry.id) AS effective_nature` : "";
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
     WHERE id=$1 AND (NOT is_builtin OR $2 = 'transactionCategories') AND is_active RETURNING id`,
    [id, catalog],
  );
  if (!result.rowCount) throw new Error("Item aktif tidak ditemukan");
}

/** A custom category may sit under a catalog parent (two levels; same kind). A child with no own nature inherits the parent's. */
export async function insertCustomCategory(displayName: string, appliesTo: CategoryScope, parentId?: string): Promise<CatalogRecord> {
  await requireOwnerSession();
  if (appliesTo !== "income" && appliesTo !== "expense") throw new Error("Invalid category scope");
  if (parentId) assertUuid(parentId);
  const id = randomUUID();
  const result = await database().query<CatalogRow>(
    `INSERT INTO transaction_categories (id, display_name, applies_to, is_builtin, system_key, parent_id)
     VALUES ($1, $2, $3, false, NULL, $4)
     RETURNING id, display_name, applies_to, system_key, is_builtin, is_active, parent_id, nature`,
    [id, validateCatalogName(displayName), appliesTo, parentId ?? null],
  );
  return toCatalogItem({ ...result.rows[0], effective_nature: result.rows[0].nature ?? null });
}

/** Owner's own nature for an expense category (built-in rows are never edited); null removes the override. */
export async function setCategoryNature(categoryId: string, nature: CategoryNature | null): Promise<void> {
  await requireOwnerSession(); assertUuid(categoryId);
  if (nature === null) {
    await database().query("DELETE FROM category_nature_overrides WHERE category_id=$1", [categoryId]);
    return;
  }
  if (!CATEGORY_NATURES.includes(nature)) throw new Error("Sifat kategori tidak valid");
  const category = await database().query("SELECT 1 FROM transaction_categories WHERE id=$1 AND applies_to='expense'", [categoryId]);
  if (!category.rowCount) throw new Error("Sifat hanya untuk kategori pengeluaran");
  await database().query(`INSERT INTO category_nature_overrides (category_id, nature) VALUES ($1,$2)
    ON CONFLICT (category_id) DO UPDATE SET nature=EXCLUDED.nature, updated_at=now()`, [categoryId, nature]);
}

export async function restoreCustomCatalogItem(catalog: Catalog, id: string): Promise<void> {
  await requireOwnerSession(); assertUuid(id);
  const result = await database().query(`UPDATE ${catalogTables[catalog]} SET is_active=true WHERE id=$1 AND (NOT is_builtin OR $2 = 'transactionCategories') RETURNING id`, [id, catalog]);
  if (!result.rowCount) throw new LifecycleError("Pilihan tidak ditemukan.");
}
export async function deleteCustomCatalogItem(catalog: Catalog, id: string): Promise<void> {
  await requireOwnerSession(); assertUuid(id);
  await inDatabaseTransaction((client) => deleteUnused(client, catalogTables[catalog], id, true));
}
