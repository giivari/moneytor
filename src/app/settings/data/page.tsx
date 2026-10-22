import { DataToolsWorkspace } from "@/components/data-tools-workspace";
import { requireOwnerSession } from "@/lib/auth/session";
import { listActivities } from "@/lib/finance/service";
import { investmentSnapshot } from "@/lib/investments/read";
import { listAssets } from "@/lib/repositories/assets";
import { listCatalog } from "@/lib/repositories/catalogs";

export const dynamic = "force-dynamic";

export default async function SettingsDataPage() {
  await requireOwnerSession();
  const [assets, activities, investments, providers] = await Promise.all([
    listAssets(true),
    listActivities(true),
    investmentSnapshot(),
    listCatalog("providers", true),
  ]);
  return (
    <DataToolsWorkspace
      counts={{
        assets: assets.length,
        activities: activities.length,
        holdings: investments.holdings.length,
        providers: providers.length,
      }}
    />
  );
}

