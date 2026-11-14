"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard, MagnifyingGlass, Rows, Users, Wallet, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { formatMinor } from "@/lib/finance/format";
import { isCreditAsset, isReceivableAsset } from "@/lib/domain/credit";
import type { FinanceActivity, FinanceAsset } from "@/lib/finance/types";
import { ICON_MD, ICON_SM } from "./icon-size";

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loadedAt = useRef(0);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (focusTimer.current) clearTimeout(focusTimer.current); }, []);
  const [assets, setAssets] = useState<FinanceAsset[]>([]);
  const [activities, setActivities] = useState<FinanceActivity[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function ensureLoaded() {
    // Muat ulang bila data lebih tua dari 30 detik, sehingga hasil pencarian mengikuti mutasi terbaru.
    if (Date.now() - loadedAt.current < 30_000) return;
    loadedAt.current = Date.now();
    try {
      const [optRes, actRes] = await Promise.all([
        fetch("/api/finance/options", { cache: "no-store" }),
        fetch("/api/finance/activities?history=false", { cache: "no-store" }),
      ]);
      if (optRes.ok) {
        const optData = await optRes.json();
        setAssets(optData.assets ?? []);
      }
      if (actRes.ok) {
        const actData = await actRes.json();
        setActivities(actData.items ?? []);
      }
    } catch {
      loadedAt.current = 0; // izinkan percobaan ulang saat dibuka lagi
    }
  }

  function openMobileSearch() {
    setMobileOpen(true);
    setOpen(true);
    void ensureLoaded();
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  }

  const q = query.trim().toLowerCase();
  const matchedRegularAssets = q
    ? assets.filter(
        (a) =>
          !isCreditAsset(a) &&
          !isReceivableAsset(a) &&
          `${a.displayName} ${a.providerName ?? ""} ${a.assetTypeName} ${a.safeSuffix ?? ""}`
            .toLowerCase()
            .includes(q),
      )
    : [];
  const matchedCreditAndReceivables = q
    ? assets.filter(
        (a) =>
          (isCreditAsset(a) || isReceivableAsset(a)) &&
          `${a.displayName} ${a.providerName ?? ""} ${a.note ?? ""}`.toLowerCase().includes(q),
      )
    : [];
  const matchedActivities = q
    ? activities
        .filter((act) =>
          `${act.note ?? ""} ${act.categoryName ?? ""} ${act.sourceName ?? ""} ${act.destinationName ?? ""}`
            .toLowerCase()
            .includes(q),
        )
        .slice(0, 6)
    : [];

  const hasResults =
    matchedRegularAssets.length > 0 ||
    matchedCreditAndReceivables.length > 0 ||
    matchedActivities.length > 0;

  function go(href: string) {
    setOpen(false);
    setMobileOpen(false);
    router.push(href);
  }

  function handleClearOrClose() {
    if (mobileOpen) {
      if (query) {
        setQuery("");
        inputRef.current?.focus();
      } else {
        setMobileOpen(false);
        setOpen(false);
      }
    } else {
      setQuery("");
      inputRef.current?.focus();
    }
  }

  return (
    <div className="header-search-wrap" ref={containerRef}>
      <button
        type="button"
        className="icon-button mobile-search-btn"
        onClick={openMobileSearch}
        aria-label="Cari transaksi, rekening, atau talangan"
        title="Cari"
      >
        <MagnifyingGlass size={ICON_MD} weight="bold" />
      </button>

      <div className={`header-search-bar-wrap ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="header-search">
          <MagnifyingGlass size={ICON_SM} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onFocus={() => {
              setOpen(true);
              void ensureLoaded();
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            placeholder="Cari transaksi, rekening, atau talangan..."
            aria-label="Cari di seluruh fitur moneytor"
          />
          {(query || mobileOpen) && (
            <button
              type="button"
              className="header-search-clear"
              onClick={handleClearOrClose}
              aria-label={mobileOpen && !query ? "Tutup pencarian" : "Bersihkan pencarian"}
              title={mobileOpen && !query ? "Tutup" : "Bersihkan"}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {open && q.length > 0 && (
          <div className="header-search-dropdown" role="region" aria-label="Hasil pencarian">
            <div className="header-search-head">
              <span>Hasil pencarian &ldquo;{query}&rdquo;</span>
              <span>Pilih untuk membuka</span>
            </div>

            {!hasResults ? (
              <p className="header-search-empty">Tidak ditemukan rekening, talangan, atau transaksi yang cocok.</p>
            ) : (
              <div className="header-search-groups">
                {matchedRegularAssets.length > 0 && (
                  <div className="header-search-group" role="group" aria-label="Rekening dan aset">
                    <div className="header-search-group-title" aria-hidden="true">
                      REKENING &amp; ASET ({matchedRegularAssets.length})
                    </div>
                    {matchedRegularAssets.map((acc) => (
                      <button
                        key={acc.id}
                        type="button"
                        className="header-search-item"
                        onClick={() => go("/assets")}
                      >
                        <span className="header-search-item-main">
                          <Wallet size={ICON_SM} />
                          <span>
                            <strong>{acc.displayName}</strong>
                            <small>{acc.providerName || acc.assetTypeName}</small>
                          </span>
                        </span>
                        <strong className="financial-value">
                          {formatMinor(acc.balanceMinor, acc.currency, acc.exponent)}
                        </strong>
                      </button>
                    ))}
                  </div>
                )}

                {matchedCreditAndReceivables.length > 0 && (
                  <div className="header-search-group" role="group" aria-label="Kredit dan talangan">
                    <div className="header-search-group-title" aria-hidden="true">
                      KREDIT &amp; TALANGAN ({matchedCreditAndReceivables.length})
                    </div>
                    {matchedCreditAndReceivables.map((cr) => (
                      <button
                        key={cr.id}
                        type="button"
                        className="header-search-item"
                        onClick={() => go("/credit")}
                      >
                        <span className="header-search-item-main">
                          {isReceivableAsset(cr) ? <Users size={ICON_SM} /> : <CreditCard size={ICON_SM} />}
                          <span>
                            <strong>{cr.displayName}</strong>
                            <small>{isReceivableAsset(cr) ? "Piutang & Talangan" : cr.providerName || cr.assetTypeName}</small>
                          </span>
                        </span>
                        <strong className="financial-value">
                          {formatMinor(cr.balanceMinor, cr.currency, cr.exponent)}
                        </strong>
                      </button>
                    ))}
                  </div>
                )}

                {matchedActivities.length > 0 && (
                  <div className="header-search-group" role="group" aria-label="Buku mutasi">
                    <div className="header-search-group-title" aria-hidden="true">
                      BUKU MUTASI ({matchedActivities.length})
                    </div>
                    {matchedActivities.map((act) => (
                      <button
                        key={act.id}
                        type="button"
                        className="header-search-item"
                        onClick={() => go("/transactions")}
                      >
                        <span className="header-search-item-main">
                          <Rows size={ICON_SM} />
                          <span>
                            <strong>{act.note || act.categoryName || "Transaksi"}</strong>
                            <small>
                              {[act.sourceName, act.destinationName].filter(Boolean).join(" → ")} ·{" "}
                              {new Date(act.occurredAt).toLocaleDateString("id-ID", {
                                day: "2-digit",
                                month: "short",
                              })}
                            </small>
                          </span>
                        </span>
                        <strong className="financial-value">
                          {formatMinor(act.baseAmountMinor, act.currency, act.exponent)}
                        </strong>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
