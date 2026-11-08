"use client";

import { useLinkStatus } from "next/link";
import { AppLink as Link } from "./app-link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { CalendarCheck, ChartBar, CreditCard, DotsThree, GearSix, House, MagnifyingGlass, Rows, TrendUp, Wallet, type IconProps } from "@phosphor-icons/react";
import { BrandIdentity } from "./brand-identity";
import { FeatureOnboarding } from "./feature-onboarding";
import { PrivacyAmountToggle } from "./privacy-toggle";
import { ThemeQuickToggle } from "./theme-toggle";
import { QuickAdd } from "@/components/quick-add";
import { LoadingIndicator } from "./loading-indicator";
import { useFinanceFeedback } from "./finance-feedback";
import { InspectorPanel, InspectorProvider, useInspector } from "./inspector";
import { activeArea, dockPrimary, modules, settingsModule, type ModuleArea, type NavModule } from "./navigation";
import { ICON_MD } from "./icon-size";

const icons: Record<ModuleArea, ComponentType<IconProps>> = {
  home: House, transactions: Rows, assets: Wallet, credit: CreditCard, investments: TrendUp,
  planning: CalendarCheck, insights: ChartBar, settings: GearSix,
};

function NavigationIcon({ area, active }: { area: ModuleArea; active: boolean }) {
  const { pending } = useLinkStatus();
  const Icon = icons[area];
  return pending
    ? <span className="navigation-pending" role="status"><LoadingIndicator><span className="sr-only">Memuat halaman…</span></LoadingIndicator></span>
    : <Icon size={ICON_MD} weight={active ? "fill" : "regular"} aria-hidden="true" />;
}

function NavItem({ item, current, className, onSelect, role }: { item: NavModule; current: ModuleArea | null; className: string; onSelect?: () => void; role?: "menuitem" }) {
  const active = current === item.area;
  return <Link href={item.href} data-area={item.area} className={className} aria-current={active ? "page" : undefined} onClick={onSelect} role={role}>
    <NavigationIcon area={item.area} active={active} /><span>{item.label}</span>
  </Link>;
}

function MoreMenu({ current }: { current: ModuleArea | null }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const items = [...modules.filter((item) => !dockPrimary.includes(item.area)), settingsModule];
  const activeInMore = items.some((item) => item.area === current);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!anchorRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    anchorRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const links = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
    const index = links.findIndex((link) => link === document.activeElement), last = links.length - 1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? last : event.key === "ArrowDown" ? (index + 1) % links.length : (index + last) % links.length;
    links[next]?.focus();
  }
  return <div className="dock-more" ref={anchorRef}>
    <button ref={buttonRef} type="button" className="dock-item" data-active={open || activeInMore} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-controls="dock-more-menu">
      <DotsThree size={ICON_MD} weight="bold" aria-hidden="true" /><span>Lainnya</span>
    </button>
    <div id="dock-more-menu" className="dock-menu" hidden={!open} role="menu" aria-label="Modul lainnya" onKeyDown={moveFocus}>
      {items.map((item) => <NavItem key={item.href} item={item} current={current} className="dock-menu-item" role="menuitem" onSelect={() => setOpen(false)} />)}
    </div>
  </div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { refreshing, navigating, routeSkeleton, loading } = useFinanceFeedback();
  const { entry } = useInspector();
  const current = activeArea(usePathname());
  return <div className="app-shell" data-inspector={entry ? "open" : "closed"}>
    <header className="app-header" data-loading={loading}>
      <Link href="/" className="brand" aria-label="moneytor, ke Beranda"><BrandIdentity /></Link>
      <div className="header-search" role="search">
        <MagnifyingGlass size={16} aria-hidden="true" className="header-search-icon" />
        <input
          type="search"
          aria-label="Cari transaksi atau rekening"
          placeholder="Cari transaksi, rekening, atau entitas…"
          className="header-search-input"
        />
      </div>
      <div className="header-actions"><PrivacyAmountToggle /><FeatureOnboarding /><ThemeQuickToggle /><QuickAdd /></div>
    </header>

    <nav className="app-rail" aria-label="Navigasi utama">
      <div className="rail-modules">{modules.map((item) => <NavItem key={item.href} item={item} current={current} className="rail-item" />)}</div>
      <div className="rail-footer"><NavItem item={settingsModule} current={current} className="rail-item" /></div>
    </nav>

    <main id="main-content" className="main-content" aria-busy={refreshing || navigating}>
      {(refreshing || (navigating && !routeSkeleton)) && (
        <div className="page finance-status-shell">
          <div className="route-loading-status finance-refresh-status" role="status">
            <LoadingIndicator>{refreshing ? "Memperbarui data…" : "Menyiapkan halaman…"}</LoadingIndicator>
            <span>{refreshing ? "Konten sedang diperbarui." : "Konten sedang dimuat."}</span>
          </div>
        </div>
      )}
      {children}
    </main>

    <InspectorPanel />

    <nav className="app-dock" aria-label="Navigasi seluler">
      {dockPrimary.slice(0, 2).map((area) => <NavItem key={area} item={modules.find((item) => item.area === area)!} current={current} className="dock-item" />)}
      <QuickAdd compact />
      {dockPrimary.slice(2).map((area) => <NavItem key={area} item={modules.find((item) => item.area === area)!} current={current} className="dock-item" />)}
      <MoreMenu current={current} />
    </nav>
  </div>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (["/unlock", "/recover", "/enroll"].includes(pathname)) return <>{children}</>;
  return <InspectorProvider><Shell>{children}</Shell></InspectorProvider>;
}
