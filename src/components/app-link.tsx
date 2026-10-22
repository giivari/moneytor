"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useId, type ComponentProps } from "react";
import { useFinanceFeedback } from "./finance-feedback";

function LinkPending() {
  const { pending } = useLinkStatus();
  const { reportNavigation } = useFinanceFeedback();
  const id = useId();
  useEffect(() => {
    reportNavigation(id, pending);
    return () => reportNavigation(id, false);
  }, [id, pending, reportNavigation]);
  return pending ? <span className="sr-only">Membuka halaman…</span> : null;
}

/** Native Link prefetch and pending lifecycle; no router timers or invented completion. */
export function AppLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<LinkPending /></Link>;
}
