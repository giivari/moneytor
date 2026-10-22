import { requireOwnerSession } from "@/lib/auth/session";
import { database } from "@/lib/db/pool";
import { investmentSnapshot } from "@/lib/investments/read";
import { listAssets } from "@/lib/repositories/assets";
import { listCatalog } from "@/lib/repositories/catalogs";
import { InvestmentManager } from "@/components/investment-manager";
export const dynamic = "force-dynamic";
export default async function InvestmentsPage() {
  await requireOwnerSession();
  const [snapshot, assets, providers, currencies] = await Promise.all([
    investmentSnapshot(), listAssets(false), listCatalog("providers"),
    database().query<{ code: string; minor_unit_exponent: number }>("SELECT code,minor_unit_exponent FROM currencies WHERE is_active ORDER BY code"),
  ]);
  return <InvestmentManager snapshot={snapshot} assets={assets} providers={providers.map((p) => ({ id: p.id, displayName: p.displayName }))}
    currencies={currencies.rows.map((c) => ({ code: c.code, exponent: c.minor_unit_exponent }))} />;
}
