import { AppLink } from "@/components/app-link";
import { requireOwnerSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
/** Placeholder until the Kredit & Talangan module is built; credit accounts are still managed in Aset. */
export default async function CreditPage() {
  await requireOwnerSession();
  return <div className="page credit-page">
    <header className="page-header"><div className="page-heading-row"><div><h1>Kredit &amp; Talangan</h1><p>PayLater, kartu kredit, cicilan, dan piutang teman.</p></div></div></header>
    <section className="home-card home-empty"><h2>Modul sedang disiapkan</h2>
      <p>Sementara ini akun kredit dan piutang dikelola dari halaman Aset.</p>
      <AppLink href="/assets" className="button-primary">Buka Aset</AppLink></section>
  </div>;
}
