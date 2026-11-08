"use client";

import { useLinkStatus } from "next/link";
import { AppLink as Link } from "./app-link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  CalendarCheck,
  ChartBar,
  CreditCard,
  DotsThree,
  GearSix,
  House,
  MagnifyingGlass,
  Rows,
  TrendUp,
  Users,
  Wallet,
  X,
  type IconProps,
} from "@phosphor-icons/react";
import { BrandIdentity } from "./brand-identity";
import { FeatureOnboarding } from "./feature-onboarding";
import { PrivacyAmountToggle } from "./privacy-toggle";
import { ThemeQuickToggle } from "./theme-toggle";
import { OutlookSplitAdd, QuickAdd } from "@/components/quick-add";
import { LoadingIndicator } from "./loading-indicator";
import { useFinanceFeedback } from "./finance-feedback";
import { useFinanceOptions } from "./finance-form-hooks";
import { formatMinor } from "@/lib/finance/format";
import { InspectorPanel, InspectorProvider, useInspector } from "./inspector";
import { activeArea, dockPrimary, modules, settingsModule, type ModuleArea, type NavModule } from "./navigation";
import { ICON_MD } from "./icon-size";

const icons: Record<ModuleArea, ComponentType<IconProps>> = {
  home: House,
  transactions: Rows,
  assets: Wallet,
  credit: CreditCard,
  investments: TrendUp,
  planning: CalendarCheck,
  insights: ChartBar,
  settings: GearSix,
};

function NavigationIcon({ area, active }: { area: ModuleArea; active: boolean }) {
  const { pending } = useLinkStatus();
  const Icon = icons[area];
  return pending ? (
    <span className="navigation-pending" role="status">
      <LoadingIndicator>
        <span className="sr-only">Memuat halaman…</span>
      </LoadingIndicator>
    </span>
  ) : (
    <Icon size={ICON_MD} weight={active ? "fill" : "regular"} aria-hidden="true" />
  );
}

function NavItem({
  item,
  current,
  className,
  onSelect,
  role,
  badgeCount,
}: {
  item: NavModule;
  current: ModuleArea | null;
  className: string;
  onSelect?: () => void;
  role?: "menuitem";
  badgeCount?: number;
}) {
  const active = current === item.area;
  return (
    <Link
      href={item.href}
      data-area={item.area}
      className={className}
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      role={role}
      title={item.label}
    >
      <span className="rail-icon-wrap">
        <NavigationIcon area={item.area} active={active} />
        {badgeCount !== undefined && badgeCount > 0 ? (
          <span className="rail-badge">{badgeCount}</span>
        ) : null}
      </span>
      <span>{item.label}</span>
    </Link>
  );
}

function MoreMenu({ current }: { current: ModuleArea | null }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const items = [...modules.filter((item) => !dockPrimary.includes(item.area)), settingsModule];
  const activeInMore = items.some((item) => item.area === current);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    anchorRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const links = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
    const index = links.findIndex((link) => link === document.activeElement),
      last = links.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
        ? last
        : event.key === "ArrowDown"
        ? (index + 1) % links.length
        : (index + last) % links.length;
    links[next]?.focus();
  }
  return (
    <div className="dock-more" ref={anchorRef}>
      <button
        ref={buttonRef}
        type="button"
        className="dock-item"
        data-active={open || activeInMore}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="dock-more-menu"
      >
        <DotsThree size={ICON_MD} weight="bold" aria-hidden="true" />
        <span>Lainnya</span>
      </button>
      <div
        id="dock-more-menu"
        className="dock-menu"
        hidden={!open}
        role="menu"
        aria-label="Modul lainnya"
        onKeyDown={moveFocus}
      >
        {items.map((item) => (
          <NavItem
            key={item.href}
            item={item}
            current={current}
            className="dock-menu-item"
            role="menuitem"
            onSelect={() => setOpen(false)}
          />
        ))}
      </div>
    </div>
  );
}

function HeaderSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const { options } = useFinanceOptions();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const assets = options?.assets ?? [];

  const matchedAccounts = q
    ? assets
        .filter((a) => a.assetClass === "asset" && a.displayName.toLowerCase().includes(q))
        .slice(0, 4)
    : [];

  const matchedCredits = q
    ? assets
        .filter((a) => a.assetClass === "liability" && a.displayName.toLowerCase().includes(q))
        .slice(0, 4)
    : [];

  const matchedSplits = q
    ? assets
        .filter((a) => a.assetClass === "receivable" && a.displayName.toLowerCase().includes(q))
        .slice(0, 4)
    : [];

  const hasResults =
    matchedAccounts.length > 0 || matchedCredits.length > 0 || matchedSplits.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsFocused(false);
    router.push("/transactions");
  };

  return (
    <div className="header-search-container" ref={containerRef}>
      <form className="header-search" onSubmit={handleSubmit} role="search">
        <MagnifyingGlass size={15} aria-hidden="true" className="header-search-icon" />
        <input
          type="search"
          value={query}
          onFocus={() => setIsFocused(true)}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Cari transaksi, rekening, atau teman split bill"
          placeholder="Cari transaksi, rekening, atau teman split bill..."
          className="header-search-input"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="header-search-clear"
            aria-label="Hapus pencarian"
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </form>

      {isFocused && q.length > 0 && (
        <div className="header-search-dropdown" role="region" aria-label="Hasil pencarian cepat">
          <div className="header-search-results-bar">
            <span>Hasil Pencarian &ldquo;{query}&rdquo;</span>
            <span>Klik item untuk buka</span>
          </div>

          {!hasResults ? (
            <div className="header-search-empty">
              Tidak ditemukan rekening atau kredit yang cocok. Tekan Enter untuk cari di Mutasi.
            </div>
          ) : (
            <div className="header-search-groups">
              {matchedAccounts.length > 0 && (
                <div className="header-search-group">
                  <div className="header-search-group-title">
                    Rekening &amp; Aset ({matchedAccounts.length})
                  </div>
                  {matchedAccounts.map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => {
                        setIsFocused(false);
                        router.push("/assets");
                      }}
                      className="header-search-item"
                    >
                      <div className="header-search-item-info">
                        <Wallet size={15} className="header-search-item-icon" />
                        <div>
                          <div className="header-search-item-name">{acc.displayName}</div>
                          <div className="header-search-item-meta">{acc.assetTypeName}</div>
                        </div>
                      </div>
                      <span className="header-search-item-amount">
                        {formatMinor(acc.balanceMinor, acc.currency, acc.exponent)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {matchedCredits.length > 0 && (
                <div className="header-search-group">
                  <div className="header-search-group-title">
                    Fasilitas Kredit ({matchedCredits.length})
                  </div>
                  {matchedCredits.map((cr) => (
                    <button
                      key={cr.id}
                      type="button"
                      onClick={() => {
                        setIsFocused(false);
                        router.push("/credit");
                      }}
                      className="header-search-item"
                    >
                      <div className="header-search-item-info">
                        <CreditCard size={15} className="header-search-item-icon text-credit" />
                        <div>
                          <div className="header-search-item-name">{cr.displayName}</div>
                          <div className="header-search-item-meta">Kredit / PayLater</div>
                        </div>
                      </div>
                      <span className="header-search-item-amount text-credit">
                        {formatMinor(cr.balanceMinor, cr.currency, cr.exponent)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {matchedSplits.length > 0 && (
                <div className="header-search-group">
                  <div className="header-search-group-title">
                    Piutang &amp; Split Bill ({matchedSplits.length})
                  </div>
                  {matchedSplits.map((sb) => (
                    <button
                      key={sb.id}
                      type="button"
                      onClick={() => {
                        setIsFocused(false);
                        router.push("/credit");
                      }}
                      className="header-search-item"
                    >
                      <div className="header-search-item-info">
                        <Users size={15} className="header-search-item-icon text-split" />
                        <div>
                          <div className="header-search-item-name">{sb.displayName}</div>
                          <div className="header-search-item-meta">Piutang Talangan</div>
                        </div>
                      </div>
                      <span className="header-search-item-amount text-split">
                        {formatMinor(sb.balanceMinor, sb.currency, sb.exponent)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { refreshing, navigating } = useFinanceFeedback();
  const { entry } = useInspector();
  const current = activeArea(usePathname());
  return (
    <div className="app-shell" data-inspector={entry ? "open" : "closed"}>
      <header className="app-header" data-loading={refreshing || navigating}>
        <Link href="/" className="brand" aria-label="moneytor, ke Beranda">
          <BrandIdentity />
        </Link>
        <HeaderSearch />
        <div className="header-actions">
          <PrivacyAmountToggle />
          <FeatureOnboarding />
          <ThemeQuickToggle />
          <OutlookSplitAdd />
        </div>
      </header>

      <nav className="app-rail" aria-label="Navigasi utama">
        <div className="rail-modules">
          {modules.map((item) => (
            <NavItem key={item.href} item={item} current={current} className="rail-item" />
          ))}
        </div>
        <div className="rail-footer">
          <NavItem item={settingsModule} current={current} className="rail-item" />
        </div>
      </nav>

      <main id="main-content" className="main-content" aria-busy={refreshing || navigating}>
        {children}
      </main>

      <InspectorPanel />

      <nav className="app-dock" aria-label="Navigasi seluler">
        {dockPrimary.slice(0, 2).map((area) => (
          <NavItem
            key={area}
            item={modules.find((item) => item.area === area)!}
            current={current}
            className="dock-item"
          />
        ))}
        <QuickAdd compact />
        {dockPrimary.slice(2).map((area) => (
          <NavItem
            key={area}
            item={modules.find((item) => item.area === area)!}
            current={current}
            className="dock-item"
          />
        ))}
        <MoreMenu current={current} />
      </nav>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (
    [
      "/unlock",
      "/recover",
      "/enroll",
      "/",
      "/transactions",
      "/assets",
      "/credit",
      "/assets/investments",
      "/planning",
      "/insights",
    ].includes(pathname)
  ) {
    return <>{children}</>;
  }
  return (
    <InspectorProvider>
      <Shell>{children}</Shell>
    </InspectorProvider>
  );
}
