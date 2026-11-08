"use client";

import { Calculator } from "@phosphor-icons/react";
import { ICON_SM } from "./icon-size";

export interface ExcelStatusBarProps {
  rowCount: number;
  totalIn?: string;
  totalOut?: string;
  customNetLabel?: string;
  customNetValue?: string;
  isNetNegative?: boolean;
  extraLabel?: string;
}

export function ExcelStatusBar({
  rowCount,
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
          Menampilkan <strong className="status-bar-bold">{rowCount}</strong> baris
        </span>
        {totalIn !== undefined && (
          <>
            <span className="status-bar-divider" aria-hidden="true">|</span>
            <span>
              Total Masuk: <strong className="status-bar-in">+{totalIn}</strong>
            </span>
          </>
        )}
        {totalOut !== undefined && (
          <>
            <span className="status-bar-divider" aria-hidden="true">|</span>
            <span>
              Total Keluar: <strong className="status-bar-out">-{totalOut}</strong>
            </span>
          </>
        )}
        {customNetValue !== undefined && (
          <>
            <span className="status-bar-divider" aria-hidden="true">|</span>
            <span>
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
            <span>{extraLabel}</span>
            <span className="status-bar-divider" aria-hidden="true">|</span>
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

// Re-export as StatusBar for backwards compatibility
export const StatusBar = ExcelStatusBar;
export type StatusBarProps = ExcelStatusBarProps;
