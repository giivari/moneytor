"use client";

import { ArrowLeft, Database, DownloadSimple, FileCsv, FilePdf, FileXls } from "@phosphor-icons/react";
import { AppLink as Link } from "@/components/app-link";
import { SectionHeading } from "./section-heading";
import type { ExportDatasetKind } from "@/lib/exports/service";

const EXPORT_DATASETS: {
  kind: ExportDatasetKind;
  title: string;
  tag: string;
  description: string;
}[] = [
  {
    kind: "transactions",
    title: "Mutasi & Riwayat Transaksi",
    tag: "e-Statement · Buku Besar",
    description:
      "Seluruh aktivitas pemasukan, pengeluaran, transfer antar rekening, rincian biaya tambahan, kategori, dan status koreksi/pembatalan.",
  },
  {
    kind: "assets",
    title: "Posisi Aset & Rekening",
    tag: "Rekening · Likuiditas",
    description:
      "Daftar rekening bank, dompet digital, kas tunai, dan akun investasi beserta penyedia, grup alokasi, serta saldo efektif saat ini.",
  },
  {
    kind: "investments",
    title: "Portofolio & Riwayat Investasi",
    tag: "Kepemilikan · Riwayat Trade",
    description:
      "Kepemilikan unit instrumen aktif, harga pasar terbaru, biaya perolehan rata-rata, laba/rugi belum terealisasi, serta riwayat beli/jual.",
  },
  {
    kind: "planning",
    title: "Perencanaan & Kewajiban",
    tag: "Budget · Target · Cadangan",
    description:
      "Daftar batas anggaran pengeluaran bulanan, target tabungan, dana cadangan darurat yang disisihkan, dan jadwal kewajiban jatuh tempo.",
  },
];

export function DataToolsWorkspace({
  counts,
}: {
  counts: { assets: number; activities: number; holdings: number; providers: number };
}) {
  return (
    <div className="page import-page data-tools-page">
      <div>
        <Link className="settings-back" href="/settings">
          <ArrowLeft size={17} /> Settings
        </Link>
        <div className="page-heading finance-heading">
          <div>
            <span className="eyebrow">E-STATEMENT, LAPORAN &amp; CADANGAN DATA</span>
            <h1>Ekspor Data Keuangan</h1>
            <p>
              Unduh laporan mutasi rekening dan posisi keuangan Anda dalam format <strong>PDF (e-Statement)</strong>,{" "}
              <strong>Excel (.xlsx)</strong>, <strong>CSV (.csv)</strong>, atau arsip penuh <strong>JSON</strong>.
            </p>
          </div>
        </div>
      </div>

      <section className="surface import-section">
        <SectionHeading title="Laporan & Mutasi per Modul" eyebrow="PILIH FORMAT UNDUHAN (PDF / XLSX / CSV)" />
        <div className="summary-strip">
          <div>
            <span>Aset tercatat</span>
            <strong>{counts.assets}</strong>
          </div>
          <div>
            <span>Aktivitas transaksi</span>
            <strong>{counts.activities}</strong>
          </div>
          <div>
            <span>Posisi investasi</span>
            <strong>{counts.holdings}</strong>
          </div>
          <div>
            <span>Penyedia keuangan</span>
            <strong>{counts.providers}</strong>
          </div>
        </div>

        <div className="export-datasets-grid">
          {EXPORT_DATASETS.map((item) => (
            <article className="export-dataset-card" key={item.kind}>
              <div className="export-dataset-body">
                <span className="export-dataset-tag">{item.tag}</span>
                <strong className="export-dataset-title">{item.title}</strong>
                <p className="finance-hint export-dataset-desc">{item.description}</p>
              </div>
              <div className="export-format-actions" role="group" aria-label={`Format unduhan ${item.title}`}>
                <a
                  href={`/api/exports/download?type=${item.kind}&format=pdf`}
                  download
                  className="export-format-button"
                  data-format="pdf"
                >
                  <FilePdf size={16} weight="duotone" aria-hidden="true" />
                  <span>PDF</span>
                </a>
                <a
                  href={`/api/exports/download?type=${item.kind}&format=xlsx`}
                  download
                  className="export-format-button"
                  data-format="xlsx"
                >
                  <FileXls size={16} weight="duotone" aria-hidden="true" />
                  <span>Excel (.xlsx)</span>
                </a>
                <a
                  href={`/api/exports/download?type=${item.kind}&format=csv`}
                  download
                  className="export-format-button"
                  data-format="csv"
                >
                  <FileCsv size={16} weight="duotone" aria-hidden="true" />
                  <span>CSV (.csv)</span>
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="surface import-section">
        <SectionHeading title="Cadangan Penuh Sistem (Full Snapshot JSON)" eyebrow="ARSIP PORTABEL" />
        <div className="export-snapshot-banner">
          <div className="export-snapshot-copy">
            <strong>
              <Database size={18} weight="duotone" aria-hidden="true" /> Snapshot Lengkap Moneytor (
              <code>moneytor.export.v1</code>)
            </strong>
            <p className="finance-hint">
              Berisi seluruh katalog, akun aset, transaksi ledger, posisi investasi, riwayat harga, perencanaan, dan
              jejak batch impor dalam satu file JSON terstruktur (tanpa menyertakan data rahasia sesi atau passkey).
            </p>
          </div>
          <a href="/api/exports/download?type=snapshot" download className="button-primary export-snapshot-button">
            <DownloadSimple size={16} weight="bold" /> Unduh Snapshot JSON
          </a>
        </div>
      </section>
    </div>
  );
}
