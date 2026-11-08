"use client";

import { Calculator } from "@phosphor-icons/react";
import { ICON_SM } from "./icon-size";

export interface StatusBarProps {
  rowCount: number;
  totalIn?: string;
  totalOut?: string;
  extraLabel?: string;
}

export function StatusBar({ rowCount, totalIn, totalOut, extraLabel }: StatusBarProps) {
  return (
    <footer className="excel-status-bar" role="status" aria-label="Status baris dan ringkasan">
      <div className="status-bar-left">
        <span>Menampilkan <strong className="status-bar-bold">{rowCount}</strong> baris</span>
        {totalIn !== undefined && (
          <>
            <span className="status-bar-divider" aria-hidden="true">|</span>
            <span>Total Masuk: <strong className="status-bar-in">+{totalIn}</strong></span>
          </>
        )}
        {totalOut !== undefined && (
          <>
            <span className="status-bar-divider" aria-hidden="true">|</span>
            <span>Total Keluar: <strong className="status-bar-out">-{totalOut}</strong></span>
          </>
        )}
        {extraLabel && (
          <>
            <span className="status-bar-divider" aria-hidden="true">|</span>
            <span>{extraLabel}</span>
          </>
        )}
      </div>

      <div className="status-bar-right">
        <Calculator size={ICON_SM} weight="bold" className="status-bar-icon" aria-hidden="true" />
        <span>Kalkulasi Real-Time</span>
      </div>
    </footer>
  );
}
