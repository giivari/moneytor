"use client";

import { useLinkStatus } from "next/link";
import { CaretRight } from "@phosphor-icons/react";
import { LoadingIndicator } from "./loading-indicator";

export function SettingsLinkStatus() {
  const { pending } = useLinkStatus();
  return <span className="settings-nav-status" role={pending ? "status" : undefined}>
    {pending ? <LoadingIndicator><span className="sr-only">Memuat halaman…</span></LoadingIndicator>
      : <CaretRight size={18} aria-hidden="true" />}
  </span>;
}
