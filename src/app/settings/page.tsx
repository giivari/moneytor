import { AppLink as Link } from "@/components/app-link";
import { ChartLineUp, Buildings, CreditCard, Database, Devices, Key, Lifebuoy, ListBullets, Receipt, SquaresFour, Wallet } from "@phosphor-icons/react/dist/ssr";
import { requireOwnerSession } from "@/lib/auth/session";
import { securityOverview } from "@/lib/auth/service";
import { catalogSections } from "@/lib/settings/catalog-sections";
import { SettingsLinkStatus } from "@/components/settings-link-status";

export const dynamic = "force-dynamic";
const catalogIcons = [ListBullets, Receipt, Wallet, SquaresFour, Buildings, CreditCard, ChartLineUp];
function SettingsRow({ href, title, detail, icon, tone }: { href: string; title: string; detail: string; icon: React.ReactNode; tone: string }) {
  return <Link href={href} className="settings-nav-row" data-tone={tone}>
    <span className="settings-nav-icon" aria-hidden="true">{icon}</span>
    <span className="settings-nav-copy"><strong>{title}</strong><small>{detail}</small></span>
    <SettingsLinkStatus />
  </Link>;
}

export default async function SettingsPage() {
  const session = await requireOwnerSession();
  const security = await securityOverview(session);
  return <div className="page settings-page settings-overview-page">
    <header className="page-heading settings-heading"><div><span className="eyebrow">PENGATURAN PRIBADI</span>
      <h1>Settings</h1><p>Pilihan keuangan & keamanan.</p></div></header>
    <div className="settings-overview-grid">
      <section className="settings-nav-section" aria-labelledby="settings-finance-title"><h2 id="settings-finance-title">Keuangan</h2>
        <div className="settings-nav-group">{catalogSections.map((item, index) => {
          const Icon = catalogIcons[index];
          return <SettingsRow key={item.slug} href={`/settings/catalogs/${item.slug}`} title={item.title} detail={item.summary} tone={item.tone} icon={<Icon size={20} />} />;
        })}
          <SettingsRow href="/settings/data" title="Ekspor & cadangan data" detail="Unduh e-Statement PDF, Excel (.xlsx), CSV & snapshot JSON" tone="blue" icon={<Database size={20} />} />
        </div>
      </section>
      <section className="settings-nav-section" aria-labelledby="settings-security-title"><h2 id="settings-security-title">Keamanan</h2>
        <div className="settings-nav-group">
          <SettingsRow href="/settings/security/passkeys" title="Passkeys" detail={`${security.credentials.length} aktif`} tone="violet" icon={<Key size={20} />} />
          <SettingsRow href="/settings/security/recovery" title="Kode pemulihan" detail={`${security.recoveryRemaining} tersisa`} tone="amber" icon={<Lifebuoy size={20} />} />
          <SettingsRow href="/settings/security/sessions" title="Sesi" detail="Kelola akses perangkat" tone="cyan" icon={<Devices size={20} />} />
        </div>
      </section>
    </div>
  </div>;
}
