/** The seven moneytor modules, one language, shared by the rail, the mobile dock and tests. */
export type ModuleArea = "home" | "transactions" | "assets" | "credit" | "investments" | "planning" | "insights" | "settings";

export type NavModule = { href: string; label: string; area: ModuleArea };

export const modules: readonly NavModule[] = [
  { href: "/", label: "Beranda", area: "home" },
  { href: "/transactions", label: "Mutasi", area: "transactions" },
  { href: "/assets", label: "Aset", area: "assets" },
  { href: "/credit", label: "Kredit & Talangan", area: "credit" },
  { href: "/assets/investments", label: "Investasi", area: "investments" },
  { href: "/planning", label: "Rencana", area: "planning" },
  { href: "/insights", label: "Analitik", area: "insights" },
];

export const settingsModule: NavModule = { href: "/settings", label: "Pengaturan", area: "settings" };

/** Dock slots beside "Catat"; the rest live under "Lainnya". */
export const dockPrimary: readonly ModuleArea[] = ["home", "transactions", "assets"];

/** Longest matching module wins, so /assets/investments is Investasi rather than Aset. */
export function activeArea(pathname: string): ModuleArea | null {
  let best: NavModule | null = null;
  for (const item of [...modules, settingsModule]) {
    const hit = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.area ?? null;
}
