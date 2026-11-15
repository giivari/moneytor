"use client";

import { AppLink } from "./app-link";

export type TransactionsTabKey = "all" | "automation" | "imports";

const TABS: { key: TransactionsTabKey; href: string; label: string }[] = [
  { key: "all", href: "/transactions", label: "Semua Mutasi" },
  { key: "automation", href: "/transactions/automation", label: "Otomatisasi & Jadwal" },
  { key: "imports", href: "/transactions/imports", label: "Impor Mutasi (CSV)" },
];

export function TransactionsTabs({ active }: { active: TransactionsTabKey }) {
  return (
    <nav className="page-tabs" aria-label="Ruang kerja Buku Mutasi">
      {TABS.map((tab) => (
        <AppLink
          key={tab.key}
          href={tab.href}
          className="page-tab"
          aria-current={active === tab.key ? "page" : undefined}
        >
          {tab.label}
        </AppLink>
      ))}
    </nav>
  );
}
