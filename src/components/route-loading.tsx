"use client";

import { useEffect, useId } from "react";
import { usePathname } from "next/navigation";
import { useFinanceFeedback } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";

export function RouteLoading() {
  const id = useId();
  const pathname = usePathname();
  const { reportNavigation } = useFinanceFeedback();
  useEffect(() => {
    reportNavigation(id, true);
    return () => reportNavigation(id, false);
  }, [id, reportNavigation]);
  const cards = pathname === "/" || pathname.startsWith("/assets/investments");
  return <div className="page route-loading" aria-busy="true" aria-label="Memuat halaman">
    <div className="route-loading-status" role="status"><LoadingIndicator>Menyiapkan halaman…</LoadingIndicator><span>Konten sedang dimuat.</span></div>
    <div className="loading-skeleton loading-skeleton-heading" aria-hidden="true" />
    <div className={cards ? "loading-card-grid" : "loading-row-list"} aria-hidden="true">{[0, 1, 2].map((item) => <div className="loading-skeleton loading-content-placeholder" key={item}><span /><span /></div>)}</div>
  </div>;
}
