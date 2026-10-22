"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Question,
  Sparkle,
  X,
} from "@phosphor-icons/react";

export interface OnboardingStep {
  title: string;
  badge: string;
  description: string;
  tip?: string;
  targetSelector?: string;
}

export interface FeatureTourDefinition {
  key: string;
  featureName: string;
  steps: OnboardingStep[];
}

const STORAGE_KEY = "moneytor:feature-onboarding:v1";

export const FEATURE_TOURS: Record<string, FeatureTourDefinition> = {
  home: {
    key: "home",
    featureName: "Beranda (Home)",
    steps: [
      {
        badge: "Selamat Datang",
        title: "Kenali Posisi Keuangan Anda dalam Sekejap",
        description:
          "Halaman Home merangkum posisi uang Anda saat ini: berapa dana yang siap dibelanjakan (Dapat digunakan), total Dana likuid, Total aset diketahui, serta sisa dana Setelah kewajiban.",
        tip: "Jika baru pertama kali memakai moneytor (data masih 0), mulailah dengan membuat rekening atau dompet pertama di menu Assets.",
        targetSelector: ".home-hero, .home-empty, .main-content",
      },
      {
        badge: "Navigasi Utama",
        title: "Berpindah Antar-Modul dengan Cepat",
        description:
          "Gunakan bilah navigasi ini untuk membuka Transactions (riwayat & mutasi), Assets (rekening & investasi), Planning (anggaran, cadangan & tagihan), Insights (grafik analitik), serta Settings (pengaturan & ekspor).",
        targetSelector: ".floating-nav, .bottom-nav",
      },
      {
        badge: "Tombol Aksi Cepat",
        title: "Tombol '+ Tambah transaksi' dari Mana Saja",
        description:
          "Tombol ini selalu tersedia di setiap halaman. Klik kapan saja untuk langsung mencatat Pengeluaran, Pemasukan, atau Transfer antar-rekening lengkap dengan rincian biaya admin/pajak.",
        targetSelector: ".header-actions .button-primary, .bottom-add",
      },
    ],
  },
  assets: {
    key: "assets",
    featureName: "Aset & Rekening (Assets)",
    steps: [
      {
        badge: "Langkah Pertama",
        title: "Tombol '+ Tambah aset' untuk Rekening & Kas",
        description:
          "Klik tombol 'Tambah aset' untuk mendaftarkan rekening bank, dompet digital (e-wallet), atau uang tunai beserta Saldo Awal-nya. Centang 'Dana likuid' dan 'Dapat digunakan' bila saldo akun tersebut bisa dipakai belanja harian.",
        tip: "Saldo rekening tidak diubah manual, melainkan otomatis bertambah/berkurang mengikuti transaksi yang Anda catat.",
        targetSelector: ".finance-assets-page .page-heading-actions .button-primary, .finance-empty .button-primary",
      },
      {
        badge: "Portofolio Investasi",
        title: "Kartu Ringkasan & Akses ke Halaman Investasi",
        description:
          "Di bagian ini Anda dapat memantau total nilai aset per mata uang dan menekan tautan menuju modul Investasi untuk mengelola saham, reksa dana, emas, maupun aset kripto secara terpisah dari kas harian.",
        targetSelector: "a[href='/assets/investments'], .asset-overview-grid",
      },
      {
        badge: "Rekonsiliasi & Laporan",
        title: "Koreksi Saldo Awal & Tombol 'Ekspor Aset'",
        description:
          "Setiap rekening yang terdaftar memiliki tombol 'Koreksi saldo awal' (untuk memperbaiki saldo pembukaan tanpa merusak riwayat transaksi) serta tombol 'Ekspor Aset' untuk mengunduh laporan PDF, Excel (.xlsx), atau CSV.",
        targetSelector: ".finance-assets-page .export-menu-trigger, .finance-assets-page .page-heading-actions",
      },
    ],
  },
  investments: {
    key: "investments",
    featureName: "Portofolio Investasi",
    steps: [
      {
        badge: "Alur 4 Tahap",
        title: "Susun Portofolio, Instrumen & Kepemilikan",
        description:
          "Pencatatan investasi dibagi menjadi 4 langkah terstruktur: (1) Buat Portofolio/Sekuritas, (2) Tambah Instrumen (saham/reksa dana/kripto), (3) Catat Kepemilikan ('Sudah saya miliki' untuk aset lama atau 'Beli baru' yang memotong kas), lalu (4) Masukkan Harga Pasar.",
        targetSelector: ".investment-onboarding, .investment-holdings, .investment-page .page-heading",
      },
      {
        badge: "Transaksi & Laporan",
        title: "Catat Beli/Jual, Harga Pasar & Ekspor Portofolio",
        description:
          "Gunakan tombol di bagian atas untuk mencatat transaksi beli/jual berikutnya atau klik 'Ekspor Portofolio' untuk mengunduh rincian unit kepemilikan, rata-rata harga beli, dan laba/rugi (P/L) ke PDF, Excel, atau CSV.",
        targetSelector: ".investment-page .page-heading-actions",
      },
    ],
  },
  transactions: {
    key: "transactions",
    featureName: "Transaksi & Mutasi",
    steps: [
      {
        badge: "Buku Besar",
        title: "Filter Riwayat, Rincian Biaya & Jejak Koreksi",
        description:
          "Daftar ini menampilkan seluruh mutasi Pemasukan, Pengeluaran, dan Transfer. Klik baris transaksi mana pun untuk melihat rincian biaya admin/pajak, melakukan 'Koreksi' nominal, atau 'Batalkan transaksi' (Void) dengan jejak audit yang tetap tersimpan.",
        targetSelector: ".list-toolbar, .summary-strip",
      },
      {
        badge: "Migrasi Cepat",
        title: "Tombol 'Impor CSV/Excel' untuk Mutasi Massal",
        description:
          "Punya riwayat transaksi dari e-statement bank atau catatan Excel lama? Klik tombol 'Impor CSV/Excel' ini untuk mengunggah file, memetakan kolom secara interaktif, dan mendeteksi transaksi ganda secara otomatis.",
        targetSelector: ".transactions-import-trigger",
      },
      {
        badge: "Otomatisasi & e-Statement",
        title: "Tautan 'Otomatisasi' & Tombol 'Ekspor Mutasi'",
        description:
          "Klik 'Otomatisasi' untuk membuat jadwal tagihan/pemasukan berulang serta aturan alokasi otomatis, atau gunakan tombol 'Ekspor Mutasi' untuk mengunduh e-Statement PDF, Excel (.xlsx), maupun CSV.",
        targetSelector: ".automation-entry, .export-menu-trigger",
      },
    ],
  },
  imports: {
    key: "imports",
    featureName: "Impor CSV / Excel & Migrasi Akun",
    steps: [
      {
        badge: "Impor Transaksi",
        title: "Unggah File CSV atau Excel (.xlsx)",
        description:
          "Pilih file mutasi CSV atau buku kerja Excel Anda. Sistem akan menampilkan pratinjau baris, membantu mencocokkan nama rekening & kategori, serta menandai kandidat duplikat sebelum disimpan ke buku besar.",
        targetSelector: ".import-section:first-of-type, .import-page .page-heading",
      },
      {
        badge: "Migrasi Rekening",
        title: "Impor Daftar Rekening & Saldo Awal Sekaligus",
        description:
          "Bagian kedua di bawah memungkinkan Anda mengunggah lembar daftar akun ('Accounts' sheet) dari buku kerja Excel untuk membuat rekening beserta saldo awalnya secara massal.",
        targetSelector: ".import-section:nth-of-type(2), .import-page",
      },
    ],
  },
  automation: {
    key: "automation",
    featureName: "Otomatisasi & Alokasi",
    steps: [
      {
        badge: "Jadwal Rutin",
        title: "Transaksi Terjadwal (Recurring Rules)",
        description:
          "Buat aturan jadwal harian, mingguan, atau bulanan untuk tagihan rutin maupun gaji. Anda bisa memilih mode 'Catat otomatis saat jatuh tempo' atau 'Konfirmasi sebelum mencatat' agar nominalnya bisa disesuaikan dulu.",
        targetSelector: ".main-content section:first-of-type, .page-heading",
      },
      {
        badge: "Alokasi Pintar",
        title: "Aturan Alokasi Otomatis Saat Ada Pemasukan",
        description:
          "Di bagian aturan alokasi, Anda dapat mengatur tindakan otomatis (misalnya menyisihkan persentase tertentu dari pemasukan) setiap kali transaksi pemasukan baru tercatat.",
        targetSelector: ".automation-rules-section, .main-content",
      },
    ],
  },
  planning: {
    key: "planning",
    featureName: "Perencanaan Keuangan (Planning)",
    steps: [
      {
        badge: "Simulasi Posisi",
        title: "Jangka Waktu Kewajiban (7 / 30 / 90 Hari)",
        description:
          "Pilih jangka waktu 7, 30, atau 90 hari untuk melihat berapa dana yang benar-benar siap digunakan setelah dikurangi dana cadangan aktif dan kewajiban tagihan yang akan jatuh tempo.",
        targetSelector: ".planning-horizon, .planning-position-grid, .planning-first-run",
      },
      {
        badge: "4 Pilar Rencana",
        title: "Anggaran, Target Tabungan, Cadangan & Kewajiban",
        description:
          "Gunakan tombol pembuatan rencana untuk mengatur: (1) Batas pengeluaran bulanan, (2) Target tabungan, (3) Dana cadangan (menyisihkan uang secara virtual tanpa memindah rekening), dan (4) Kewajiban/tagihan.",
        targetSelector: ".planning-first-actions, .planning-sections",
      },
      {
        badge: "Ekspor Rencana",
        title: "Tombol 'Ekspor Rencana'",
        description:
          "Unduh seluruh daftar batas anggaran, progres target, dana cadangan, dan jadwal kewajiban Anda ke dokumen PDF, Excel (.xlsx), atau CSV.",
        targetSelector: ".planning-page .export-menu-trigger, .planning-page .page-heading-actions",
      },
    ],
  },
  insights: {
    key: "insights",
    featureName: "Analitik Keuangan (Insights)",
    steps: [
      {
        badge: "Filter Periode",
        title: "Pilih Rentang Waktu & Mata Uang Analisis",
        description:
          "Klik panel periode laporan ini untuk memilih Bulan ini, Bulan lalu, Tahun ini, Tren bulanan (hingga 36 bulan), atau Rentang tanggal kustom, lalu tekan 'Terapkan'.",
        targetSelector: ".insight-filter-disclosure, .insight-workspace",
      },
      {
        badge: "Evaluasi Arus Kas",
        title: "Perbandingan Periode, Komposisi Kategori & Biaya",
        description:
          "Pantau kenaikan/penurunan pemasukan dan belanja dibanding periode sebelumnya, distribusi pengeluaran per kategori & rekening, total biaya admin/pajak, serta arus kas investasi.",
        targetSelector: ".insight-workspace, .main-content",
      },
    ],
  },
  settings: {
    key: "settings",
    featureName: "Pengaturan & Katalog (Settings)",
    steps: [
      {
        badge: "Katalog Keuangan",
        title: "Kelola Kategori, Mata Uang & Preset Penyedia",
        description:
          "Di bagian Keuangan, Anda dapat menambah atau mengurutkan kategori pemasukan/pengeluaran, jenis biaya tambahan, mata uang, grup aset, jaringan pembayaran (QRIS, BI-FAST, Visa), hingga preset bank & e-wallet.",
        targetSelector: ".settings-nav-section:first-of-type",
      },
      {
        badge: "Pusat Ekspor",
        title: "Menu 'Ekspor & cadangan data'",
        description:
          "Buka menu ini untuk mengakses Pusat Ekspor lengkap: unduh e-Statement PDF, Excel (.xlsx), CSV untuk setiap modul, atau simpan Snapshot JSON penuh sebagai cadangan (backup) seluruh database Anda.",
        targetSelector: "a[href='/settings/data']",
      },
      {
        badge: "Keamanan Pemilik",
        title: "Passkeys, Kode Pemulihan & Sesi Aktif",
        description:
          "Di bagian Keamanan, Anda dapat mendaftarkan Passkey tambahan (misalnya di ponsel atau laptop cadangan), membuat ulang 8 kode pemulihan darurat, serta mencabut sesi perangkat lain.",
        targetSelector: ".settings-nav-section:nth-of-type(2)",
      },
    ],
  },
  "settings-data": {
    key: "settings-data",
    featureName: "Pusat Ekspor & Cadangan Data",
    steps: [
      {
        badge: "Unduh Laporan",
        title: "Pilih Format PDF, Excel (.xlsx), atau CSV per Modul",
        description:
          "Setiap kartu mewakili satu koleksi data (Transaksi, Aset, Investasi, dan Perencanaan). Klik tombol PDF untuk e-Statement siap cetak, XLSX untuk lembar kerja Excel, atau CSV untuk pengolahan data.",
        targetSelector: ".export-datasets-grid",
      },
      {
        badge: "Backup Penuh",
        title: "Unduh Snapshot JSON Lengkap",
        description:
          "Gunakan tombol 'Unduh Snapshot (.json)' di bagian bawah untuk menyimpan salinan utuh seluruh data keuangan Anda dalam satu file terstruktur.",
        targetSelector: ".import-section:nth-of-type(2), .data-tools-page",
      },
    ],
  },
  "settings-catalogs": {
    key: "settings-catalogs",
    featureName: "Katalog Keuangan",
    steps: [
      {
        badge: "Kustomisasi Katalog",
        title: "Tambah Item Baru atau Gunakan Preset Cepat",
        description:
          "Tambahkan item katalog sesuai kebutuhan Anda, gunakan tombol preset instan (jika tersedia untuk institusi/jaringan pembayaran), atau ubah nama dan arsipkan item lama tanpa merusak transaksi historis.",
        targetSelector: ".settings-page .surface, .settings-page",
      },
    ],
  },
  "settings-security": {
    key: "settings-security",
    featureName: "Keamanan & Akses Perangkat",
    steps: [
      {
        badge: "Kontrol Keamanan",
        title: "Kelola Passkey, Kode Pemulihan & Sesi",
        description:
          "Halaman ini melindungi akses tunggal ke moneytor Anda. Pastikan Anda memiliki minimal satu Passkey aktif dan menyimpan 8 kode pemulihan di tempat aman di luar perangkat ini.",
        targetSelector: ".settings-page .surface, .settings-page",
      },
    ],
  },
};

export function resolveFeatureTour(pathname: string): FeatureTourDefinition | null {
  if (pathname === "/") return FEATURE_TOURS.home;
  if (pathname === "/assets") return FEATURE_TOURS.assets;
  if (pathname.startsWith("/assets/investments")) return FEATURE_TOURS.investments;
  if (pathname === "/transactions") return FEATURE_TOURS.transactions;
  if (pathname.startsWith("/transactions/imports")) return FEATURE_TOURS.imports;
  if (pathname.startsWith("/transactions/automation")) return FEATURE_TOURS.automation;
  if (pathname.startsWith("/planning")) return FEATURE_TOURS.planning;
  if (pathname.startsWith("/insights")) return FEATURE_TOURS.insights;
  if (pathname === "/settings") return FEATURE_TOURS.settings;
  if (pathname.startsWith("/settings/data")) return FEATURE_TOURS["settings-data"];
  if (pathname.startsWith("/settings/catalogs")) return FEATURE_TOURS["settings-catalogs"];
  if (pathname.startsWith("/settings/security")) return FEATURE_TOURS["settings-security"];
  return null;
}

function readSeenTours(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeSeenTours(map: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota or private mode restrictions
  }
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findVisibleTarget(selectorList?: string): HTMLElement | null {
  if (typeof document === "undefined" || !selectorList) return null;
  const selectors = selectorList
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const selector of selectors) {
    try {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (
          rect.width > 8 &&
          rect.height > 8 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0"
        ) {
          return el;
        }
      }
    } catch {
      // Ignore invalid selector fallback
    }
  }
  return null;
}

export function FeatureOnboarding() {
  const pathname = usePathname();
  const tour = useMemo(() => resolveFeatureTour(pathname), [pathname]);
  const titleId = useId();
  const descId = useId();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [resetNotice, setResetNotice] = useState(false);
  const cardRef = useRef<HTMLElement>(null);

  // Auto-open on first visit to each feature route
  useEffect(() => {
    if (!tour) {
      setOpen(false);
      return;
    }
    setResetNotice(false);
    const seen = readSeenTours();
    if (!seen[tour.key]) {
      const timer = window.setTimeout(() => {
        setStepIndex(0);
        setOpen(true);
      }, 260);
      return () => window.clearTimeout(timer);
    } else {
      setOpen(false);
    }
  }, [tour]);

  const currentStep = tour?.steps[stepIndex] ?? tour?.steps[0] ?? null;

  const updateSpotlight = useCallback(
    (shouldScroll: boolean) => {
      if (!open || !currentStep) {
        setSpotlight(null);
        return;
      }
      const el = findVisibleTarget(currentStep.targetSelector);
      if (!el) {
        setSpotlight(null);
        return;
      }
      const initialRect = el.getBoundingClientRect();
      const viewportH = window.innerHeight;
      if (
        shouldScroll &&
        (initialRect.top < 72 || initialRect.bottom > viewportH - 96)
      ) {
        try {
          el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        } catch {
          // Ignore scrollIntoView errors in older environments
        }
      }
      const measure = () => {
        const rect = el.getBoundingClientRect();
        const pad = 6;
        const clampedTop = Math.max(6, rect.top - pad);
        const clampedLeft = Math.max(6, rect.left - pad);
        const maxWidth = Math.min(rect.width + pad * 2, window.innerWidth - clampedLeft - 6);
        const maxHeight = Math.min(Math.min(rect.height + pad * 2, 280), window.innerHeight - clampedTop - 6);
        setSpotlight({
          top: Math.round(clampedTop),
          left: Math.round(clampedLeft),
          width: Math.round(Math.max(24, maxWidth)),
          height: Math.round(Math.max(24, maxHeight)),
        });
      };
      measure();
      const settleTimer = window.setTimeout(measure, 320);
      return () => window.clearTimeout(settleTimer);
    },
    [open, currentStep],
  );

  useEffect(() => {
    if (!open) return;
    const cleanup = updateSpotlight(true);
    const onLayoutChange = () => updateSpotlight(false);
    window.addEventListener("resize", onLayoutChange, { passive: true });
    window.addEventListener("scroll", onLayoutChange, { passive: true });
    return () => {
      cleanup?.();
      window.removeEventListener("resize", onLayoutChange);
      window.removeEventListener("scroll", onLayoutChange);
    };
  }, [open, stepIndex, updateSpotlight]);

  const markCompleteAndClose = useCallback(() => {
    if (tour) {
      const seen = readSeenTours();
      seen[tour.key] = true;
      writeSeenTours(seen);
    }
    setOpen(false);
  }, [tour]);

  useEffect(() => {
    if (!open || !tour) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        markCompleteAndClose();
      } else if (event.key === "ArrowRight") {
        if (stepIndex < tour.steps.length - 1) {
          event.preventDefault();
          setStepIndex((i) => i + 1);
        }
      } else if (event.key === "ArrowLeft") {
        if (stepIndex > 0) {
          event.preventDefault();
          setStepIndex((i) => i - 1);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, tour, stepIndex, markCompleteAndClose]);

  if (!tour) return null;

  const totalSteps = tour.steps.length;
  const isLastStep = stepIndex >= totalSteps - 1;

  // Compute callout popover placement relative to spotlight when available
  const popoverStyle = (() => {
    if (typeof window === "undefined" || !spotlight) return undefined;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw <= 640) {
      // On mobile screens, dock the callout cleanly above the bottom navigation or near top
      const targetInLowerHalf = spotlight.top > vh * 0.48;
      return targetInLowerHalf
        ? ({ top: "16px", bottom: "auto" } as React.CSSProperties)
        : ({ bottom: "calc(var(--mobile-dock-height, 70px) + 26px)", top: "auto" } as React.CSSProperties);
    }
    const cardWidth = Math.min(410, vw - 32);
    const spaceBelow = vh - (spotlight.top + spotlight.height);
    const placeBelow = spaceBelow >= 250 || spotlight.top < 220;
    const top = placeBelow
      ? Math.min(vh - 260, spotlight.top + spotlight.height + 14)
      : Math.max(16, spotlight.top - 248);
    const preferredLeft = spotlight.left + spotlight.width / 2 - cardWidth / 2;
    const left = Math.max(16, Math.min(vw - cardWidth - 16, preferredLeft));
    return {
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      transform: "none",
    } as React.CSSProperties;
  })();

  function replayCurrentTour() {
    setResetNotice(false);
    setStepIndex(0);
    setOpen(true);
  }

  function resetAllTours() {
    writeSeenTours({});
    setResetNotice(true);
    setStepIndex(0);
  }

  return (
    <>
      <button
        type="button"
        className="onboarding-help-trigger"
        onClick={replayCurrentTour}
        aria-label={`Panduan fitur ${tour.featureName}`}
        title={`Panduan fitur: ${tour.featureName}`}
      >
        <Question size={19} weight="bold" aria-hidden="true" />
      </button>

      {open && currentStep && (
        <div className="onboarding-layer" role="presentation">
          <div
            className="onboarding-backdrop"
            onClick={markCompleteAndClose}
            aria-hidden="true"
          />

          {spotlight && (
            <div
              className="onboarding-spotlight"
              style={{
                top: `${spotlight.top}px`,
                left: `${spotlight.left}px`,
                width: `${spotlight.width}px`,
                height: `${spotlight.height}px`,
              }}
              aria-hidden="true"
            >
              <span className="onboarding-spotlight-badge">
                <Compass size={13} weight="fill" /> Area yang dijelaskan
              </span>
            </div>
          )}

          <section
            ref={cardRef}
            className={`onboarding-callout${spotlight ? " onboarding-callout--anchored" : ""}`}
            style={popoverStyle}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            aria-describedby={descId}
          >
            <header className="onboarding-callout-header">
              <div className="onboarding-callout-meta">
                <span className="onboarding-badge">
                  <Sparkle size={13} weight="fill" aria-hidden="true" />
                  {currentStep.badge}
                </span>
                <span className="onboarding-step-counter">
                  {tour.featureName} · {stepIndex + 1}/{totalSteps}
                </span>
              </div>
              <button
                type="button"
                className="onboarding-close-btn"
                onClick={markCompleteAndClose}
                aria-label="Tutup panduan"
                title="Tutup panduan (Esc)"
              >
                <X size={17} weight="bold" />
              </button>
            </header>

            <div className="onboarding-callout-body" id={descId}>
              <h2 id={titleId} className="onboarding-callout-title">
                {currentStep.title}
              </h2>
              <p className="onboarding-callout-copy">{currentStep.description}</p>
              {currentStep.tip && (
                <p className="onboarding-callout-tip">{currentStep.tip}</p>
              )}
              {resetNotice && (
                <p className="onboarding-reset-confirm" role="status">
                  Seluruh panduan pertama kali berhasil diaktifkan ulang untuk semua halaman.
                </p>
              )}
            </div>

            <footer className="onboarding-callout-footer">
              <div className="onboarding-progress-dots" role="tablist" aria-label="Langkah panduan">
                {tour.steps.map((step, idx) => (
                  <button
                    key={step.title}
                    type="button"
                    role="tab"
                    aria-selected={idx === stepIndex}
                    aria-label={`Langkah ${idx + 1}: ${step.title}`}
                    className={`onboarding-dot${idx === stepIndex ? " active" : ""}`}
                    onClick={() => setStepIndex(idx)}
                  />
                ))}
              </div>

              <div className="onboarding-callout-actions">
                <button
                  type="button"
                  className="onboarding-skip-btn"
                  onClick={markCompleteAndClose}
                >
                  Lewati
                </button>
                <div className="onboarding-nav-btns">
                  {stepIndex > 0 && (
                    <button
                      type="button"
                      className="onboarding-prev-btn"
                      onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                    >
                      <ArrowLeft size={15} weight="bold" /> Sebelumnya
                    </button>
                  )}
                  {!isLastStep ? (
                    <button
                      type="button"
                      className="onboarding-next-btn"
                      onClick={() => setStepIndex((i) => Math.min(totalSteps - 1, i + 1))}
                    >
                      Lanjut <ArrowRight size={15} weight="bold" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="onboarding-next-btn onboarding-done-btn"
                      onClick={markCompleteAndClose}
                    >
                      <Check size={15} weight="bold" /> Mengerti
                    </button>
                  )}
                </div>
              </div>

              <div className="onboarding-callout-subfooter">
                <button
                  type="button"
                  className="onboarding-reset-btn"
                  onClick={resetAllTours}
                >
                  <ArrowCounterClockwise size={13} /> Tampilkan ulang panduan di semua fitur
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

