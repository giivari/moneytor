import { AppLink as Link } from "@/components/app-link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";

export function SettingsDetailHeader({ title, description }: { title: string; description: string }) {
  return <header className="settings-detail-heading">
    <Link className="settings-back" href="/settings"><ArrowLeft size={18} aria-hidden="true" /> Kembali ke Settings</Link>
    <h1>{title}</h1><p className="supporting-prose supporting-prose--section">{description}</p>
  </header>;
}
