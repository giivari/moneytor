"use client";

import type { ReactNode } from "react";

export function OptionalFormSection({ label, enabled, onChange, children, disabled = false }: {
  label: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return <div className="optional-form-section">
    <label className="finance-history-toggle"><input type="checkbox" checked={enabled} disabled={disabled}
      onChange={(event) => onChange(event.target.checked)} /> {label}</label>
    {enabled && <div className="optional-form-content">{children}</div>}
  </div>;
}
