import { notFound } from "next/navigation";
import { requireOwnerSession } from "@/lib/auth/session";
import { securityOverview } from "@/lib/auth/service";
import { SecurityPanel } from "@/components/security-panel";
import { SettingsDetailHeader } from "@/components/settings-detail-header";

export const dynamic = "force-dynamic";
const details = {
  passkeys: { title: "Passkeys", description: "Kelola kunci untuk membuka moneytor." },
  recovery: { title: "Kode pemulihan", description: "Simpan cara cadangan untuk memulihkan akses." },
  sessions: { title: "Sesi", description: "Kelola akses browser dan perangkat lain." },
} as const;

export default async function SecurityDetailPage({ params }: { params: Promise<{ section: string }> }) {
  const session = await requireOwnerSession();
  const section = (await params).section;
  if (!(section in details)) notFound();
  const detail = details[section as keyof typeof details];
  const overview = await securityOverview(session);
  return <div className="page settings-page settings-detail-page">
    <SettingsDetailHeader title={detail.title} description={detail.description} />
    <SecurityPanel initial={overview} section={section as keyof typeof details} />
  </div>;
}
