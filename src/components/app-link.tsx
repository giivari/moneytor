"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useId, type ComponentProps } from "react";
import { useFinanceFeedback } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";

function LinkPending() {
  const { pending } = useLinkStatus();
  const { reportNavigation } = useFinanceFeedback();
  const id = useId();
  useEffect(() => {
    reportNavigation(id, pending);
    return () => reportNavigation(id, false);
  }, [id, pending, reportNavigation]);
  return pending ? <span className="app-link-pending-spinner" role="status"><LoadingIndicator><span className="sr-only">Menyiapkan halaman…</span></LoadingIndicator></span> : null;
}

// `next/link` types describe the Pages Router Link, but the App Router resolves `next/link` to
// next/dist/client/app-dir/link (create-compiler-aliases), which supports `unstable_dynamicOnHover` in Next 15.5.
const dynamicOnHover = { unstable_dynamicOnHover: true } as unknown as Partial<ComponentProps<typeof Link>>;

/**
 * Native Link prefetch and pending lifecycle; no router timers or invented completion.
 * Viewport prefetch stays partial (loading boundary only); hover/touch upgrades to a full dynamic
 * prefetch so the click renders from the router cache instead of showing the skeleton.
 * `prefetch={false}` still disables both.
 */
export function AppLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...dynamicOnHover} {...props}>{children}<LinkPending /></Link>;
}
