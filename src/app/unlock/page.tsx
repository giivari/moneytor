import { AuthFrame } from "@/components/auth-frame";
import { AuthPanel, BootstrapForm } from "@/components/auth-panel";
import { ownerState } from "@/lib/auth/store";

export const dynamic = "force-dynamic";
export default async function UnlockPage({ searchParams }: { searchParams: Promise<{ failed?: string }> }) {
  const state = await ownerState();
  const failed = (await searchParams).failed;
  return <AuthFrame>{state.initialized_at ? <AuthPanel mode="unlock" /> : <><h1>Siapkan moneytor pribadi</h1><p>Masukkan secret penyiapan dari konfigurasi server untuk mendaftarkan passkey pertama.</p><BootstrapForm />{failed && <p role="alert" className="auth-error">Penyiapan belum dapat dilanjutkan. Periksa secret atau coba lagi nanti.</p>}</>}</AuthFrame>;
}
