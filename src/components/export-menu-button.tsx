"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown, DownloadSimple, FileCsv, FilePdf, FileXls } from "@phosphor-icons/react";
import type { ExportDatasetKind } from "@/lib/exports/service";

export function ExportMenuButton({
  dataset,
  label = "Ekspor",
}: {
  dataset: ExportDatasetKind;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function closeMenu() {
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="export-dropdown" data-open={open}>
      <button
        type="button"
        className="export-trigger-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label} (PDF, Excel, CSV)`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <DownloadSimple size={15} weight="bold" aria-hidden="true" />
        <span>{label}</span>
        <CaretDown size={12} weight="bold" className="export-trigger-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="export-dropdown-menu" role="menu">
          <a
            href={`/api/exports/download?type=${dataset}&format=pdf`}
            download
            className="export-dropdown-item"
            role="menuitem"
            onClick={closeMenu}
          >
            <span className="export-dropdown-badge" data-format="pdf">
              <FilePdf size={16} weight="duotone" aria-hidden="true" />
              <span>PDF</span>
            </span>
            <span className="export-dropdown-copy">
              <strong>e-Statement (.pdf)</strong>
              <small>Mutasi &amp; laporan siap cetak</small>
            </span>
          </a>
          <a
            href={`/api/exports/download?type=${dataset}&format=xlsx`}
            download
            className="export-dropdown-item"
            role="menuitem"
            onClick={closeMenu}
          >
            <span className="export-dropdown-badge" data-format="xlsx">
              <FileXls size={16} weight="duotone" aria-hidden="true" />
              <span>XLSX</span>
            </span>
            <span className="export-dropdown-copy">
              <strong>Excel Workbook (.xlsx)</strong>
              <small>Spreadsheet kolom terformat</small>
            </span>
          </a>
          <a
            href={`/api/exports/download?type=${dataset}&format=csv`}
            download
            className="export-dropdown-item"
            role="menuitem"
            onClick={closeMenu}
          >
            <span className="export-dropdown-badge" data-format="csv">
              <FileCsv size={16} weight="duotone" aria-hidden="true" />
              <span>CSV</span>
            </span>
            <span className="export-dropdown-copy">
              <strong>Tabel CSV (.csv)</strong>
              <small>Data mentah UTF-8 / kompatibel</small>
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
