import { notFound } from "next/navigation";
import { requireOwnerSession } from "@/lib/auth/session";
import { listCatalog } from "@/lib/repositories/catalogs";
import { catalogSection } from "@/lib/settings/catalog-sections";
import { CatalogManager } from "@/components/catalog-manager";
import { SettingsDetailHeader } from "@/components/settings-detail-header";

export const dynamic = "force-dynamic";
export default async function CatalogDetailPage({ params }: { params: Promise<{ catalog: string }> }) {
  await requireOwnerSession();
  const section = catalogSection((await params).catalog);
  if (!section) notFound();
  const items = await listCatalog(section.catalog, true);
  return <div className="page settings-page settings-detail-page">
    <SettingsDetailHeader title={section.title} description={section.description} />
    <CatalogManager catalog={section.catalog} items={items} />
  </div>;
}
