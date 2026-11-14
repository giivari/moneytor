"use client";

import { Calculator } from "@phosphor-icons/react";
import { ICON_SM } from "./icon-size";

export interface ExcelStatusBarProps {
  rowCount: number;
  /** Leading word of the row summary; "Total" when rowCount is the full count rather than the rows on screen. */
  rowPrefix?: string;
  /** When set, the summary reads "{rowPrefix} {rowCount} dari {ofTotal} baris". */
  ofTotal?: number;
  totalIn?: string;
  totalOut?: string;
  customNetLabel?: string;
  customNetValue?: string;
  isNetNegative?: boolean;
  extraLabel?: string;
}

export function ExcelStatusBar({
  rowCount,
  rowPrefix = "Menampilkan",
  ofTotal,
  totalIn,
  totalOut,
  customNetLabel,
  customNetValue,
  isNetNegative = false,
  extraLabel,
}: ExcelStatusBarProps) {
  return (
    <footer className="excel-status-bar" role="status" aria-label="Status baris dan ringkasan">
      <div className="status-bar-left">
        <span>
          {rowPrefix} <strong className="status-bar-bold">{rowCount}</strong>{ofTotal !== undefined && <> dari <strong className="status-bar-bold">{ofTotal}</strong></>} baris
        </span>
        {totalIn !== undefined && (
          <>
            <span className="status-bar-divider" aria-hidden="true">|</span>
            <span>
              Masuk: <strong className="status-bar-in">+{totalIn}</strong>
            </span>
          </>
        )}
        {totalOut !== undefined && (
          <>
            <span className="status-bar-divider" aria-hidden="true">|</span>
            <span>
              Keluar: <strong className="status-bar-out">−{totalOut}</strong>
            </span>
          </>
        )}
        {customNetValue !== undefined && (
          <>
            <span className="status-bar-divider status-bar-desktop-only" aria-hidden="true">|</span>
            <span className="status-bar-desktop-only">
              {customNetLabel || "Selisih Bersih"}:{" "}
              <strong className={isNetNegative ? "status-bar-out" : "status-bar-in"}>
                {customNetValue}
              </strong>
            </span>
          </>
        )}
      </div>

      <div className="status-bar-right">
        {extraLabel && (
          <>
            <span className="status-bar-desktop-only">{extraLabel}</span>
            <span className="status-bar-divider status-bar-desktop-only" aria-hidden="true">|</span>
          </>
        )}
        <div className="status-bar-calc">
          <Calculator size={ICON_SM} weight="bold" className="status-bar-icon" aria-hidden="true" />
          <span>Kalkulasi Real-Time</span>
        </div>
      </div>
    </footer>
  );
}

export const StatusBar = ExcelStatusBar;
export type StatusBarProps = ExcelStatusBarProps;
