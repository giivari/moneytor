"use client";

import type { ButtonHTMLAttributes } from "react";
import { ResponsiveLabel } from "./responsive-label";

/** One confirm/post action, with concise mobile copy and the same supplied handler. */
export function AutomationConfirmButton({ children, className = "", ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  return <button {...props} type="button" className={`button-primary automation-confirm-button ${className}`}
    aria-label={props["aria-label"] ?? "Konfirmasi dan catat transaksi"}>
    {children ?? <ResponsiveLabel compact="Konfirmasi">Konfirmasi &amp; catat</ResponsiveLabel>}
  </button>;
}
