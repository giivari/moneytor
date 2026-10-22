import { ImportWorkspace } from "@/components/import-workspace";
import { listImportBatches } from "@/lib/imports/service";
import { listAssets } from "@/lib/repositories/assets";
import { listCatalog } from "@/lib/repositories/catalogs";

export const dynamic = "force-dynamic";

export default async function TransactionsImportsPage() {
  const [assets, categories, batches] = await Promise.all([
    listAssets(false),
    listCatalog("transactionCategories", false),
    listImportBatches(),
  ]);
  return <ImportWorkspace assets={assets} categories={categories} initialBatches={batches} />;
}

