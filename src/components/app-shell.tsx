"use client";

import { useLinkStatus } from "next/link";
import { AppLink as Link } from "./app-link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChartDonut, DotsThree, GearSix, House, List, SquaresFour, Target } from "@phosphor-icons/react";
import { BrandIdentity } from "./brand-identity";
import { FeatureOnboarding } from "./feature-onboarding";
import { PrivacyAmountToggle } from "./privacy-toggle";
import { QuickAdd } from "@/components/quick-add";
import { LoadingIndicator } from "./loading-indicator";
import { useFinanceFeedback } from "./finance-feedback";

function NavigationIcon({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return pending ? <span className="navigation-pending" role="status"><LoadingIndicator><span className="sr-only">Memuat halaman…</span></LoadingIndicator></span> : children;
}

const navigation = [
  { href: "/", label: "Home", Icon: House },
  { href: "/transactions", label: "Transactions", Icon: List },
  { href: "/assets", label: "Assets", Icon: SquaresFour },
  { href: "/planning", label: "Planning", Icon: Target },
  { href: "/insights", label: "Insights", Icon: ChartDonut },
  { href: "/settings", label: "Settings", Icon: GearSix },
];
const mobileMore = navigation.slice(3);

export function AppShell({ children }: { children: React.ReactNode }) {
  const { refreshing, loading } = useFinanceFeedback();
  const pathname = usePathname();
  const standalone = ["/unlock", "/recover", "/enroll"].includes(pathname);
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const header = headerRef.current, shell = shellRef.current;
    if (!header || !shell) return;
    const measure = () => shell.style.setProperty("--shell-header-block-size", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [standalone]);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreAnchorRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreItemsRef = useRef<(HTMLAnchorElement | null)[]>([]);
  const active = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  const activeMoreItem = mobileMore.find((item) => active(item.href));

  useEffect(() => {
    if (!moreOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!moreAnchorRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMoreOpen(false); moreButtonRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    moreItemsRef.current[0]?.focus();
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [moreOpen]);

  function moveMoreFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = moreItemsRef.current.findIndex((item) => item === document.activeElement);
    const last = mobileMore.length - 1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? last
      : event.key === "ArrowDown" ? (index + 1) % mobileMore.length
      : (index + mobileMore.length - 1) % mobileMore.length;
    moreItemsRef.current[next]?.focus();
  }

  if (standalone) return <>{children}</>;

  return <div ref={shellRef} className="app-shell">
    <header ref={headerRef} className="site-header" data-loading={loading}>
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="moneytor, ke Home"><BrandIdentity /></Link>
        <nav className="floating-nav" aria-label="Navigasi utama">
          {navigation.map(({ href, label, Icon }) => <Link key={href} href={href} data-area={href.slice(1) || "home"} className={`nav-link ${active(href) ? "active" : ""}`} aria-current={active(href) ? "page" : undefined}><NavigationIcon><Icon size={17} weight={active(href) ? "fill" : "regular"} /></NavigationIcon><span>{label}</span></Link>)}
        </nav>
        <div className="header-actions"><PrivacyAmountToggle /><FeatureOnboarding /><QuickAdd /></div>
      </div>
    </header>

    <main id="main-content" className="main-content" aria-busy={refreshing}>{refreshing && <p className="finance-refresh-status" role="status"><LoadingIndicator>Memperbarui data…</LoadingIndicator></p>}{children}</main>

    <nav className="bottom-nav" aria-label="Navigasi seluler">
      <Link href="/" data-area="home" className={active("/") ? "active" : ""} aria-current={active("/") ? "page" : undefined}><NavigationIcon><House size={22} weight={active("/") ? "fill" : "regular"} /></NavigationIcon><span>Home</span></Link>
      <Link href="/assets" data-area="assets" className={active("/assets") ? "active" : ""} aria-current={active("/assets") ? "page" : undefined}><NavigationIcon><SquaresFour size={22} weight={active("/assets") ? "fill" : "regular"} /></NavigationIcon><span>Assets</span></Link>
      <QuickAdd compact />
      <Link href="/transactions" data-area="transactions" className={active("/transactions") ? "active" : ""} aria-current={active("/transactions") ? "page" : undefined}><NavigationIcon><List size={22} weight={active("/transactions") ? "bold" : "regular"} /></NavigationIcon><span>Activity</span></Link>
      <div className="more-anchor" ref={moreAnchorRef}>
        <button ref={moreButtonRef} type="button" data-area={activeMoreItem?.href.slice(1)} className={moreOpen || activeMoreItem ? "active" : ""} onClick={() => setMoreOpen(!moreOpen)} aria-haspopup="menu" aria-expanded={moreOpen} aria-controls="mobile-more"><DotsThree size={22} weight="bold" /><span>More</span></button>
        <div id="mobile-more" className="more-popover" hidden={!moreOpen} role="menu" aria-label="Halaman lainnya" onKeyDown={moveMoreFocus}>
          {mobileMore.map(({ href, label, Icon }, index) => <Link key={href} data-area={href.slice(1)} ref={(item) => { moreItemsRef.current[index] = item; }} href={href} role="menuitem" onClick={() => setMoreOpen(false)} aria-current={active(href) ? "page" : undefined}><Icon size={19} weight={active(href) ? "fill" : "regular"} /><span>{label}</span></Link>)}
        </div>
      </div>
    </nav>
  </div>;
}
