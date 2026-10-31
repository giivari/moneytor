"use client";

import { Plus } from "@phosphor-icons/react";
import { OptionalFormSection } from "./optional-form-section";
import { InlineCatalogSelect } from "./inline-catalog-select";

export type ChargeEditorRow = { id?: string; typeId: string; amount: string };

export function OptionalChargesEditor({ enabled, onEnabledChange, rows, onChange, chargeTypes,
  inputMode = "decimal", pattern, maxRows, disabled = false, onChargeTypeCreated }: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  rows: ChargeEditorRow[];
  onChange: (rows: ChargeEditorRow[]) => void;
  chargeTypes: { id: string; displayName: string }[];
  inputMode?: "decimal" | "numeric";
  pattern?: string;
  maxRows?: number;
  disabled?: boolean;
  onChargeTypeCreated?: () => void;
}) {
  function addRow() {
    onChange([...rows, { id: crypto.randomUUID(), typeId: "", amount: "" }]);
  }
  return <OptionalFormSection label="Ada biaya tambahan" enabled={enabled} disabled={disabled}
    onChange={(checked) => {
      if (checked && !rows.length) addRow();
      onEnabledChange(checked);
    }}>
    <div className="optional-charges-editor">
      {rows.map((row, index) => <div className="charge-editor-row" key={row.id ?? index}>
        <InlineCatalogSelect
          label="Jenis biaya"
          catalog="chargeTypes"
          createLabel="jenis biaya"
          required
          disabled={disabled}
          value={row.typeId}
          emptyLabel="Pilih jenis biaya"
          items={chargeTypes}
          onCreated={onChargeTypeCreated}
          onChange={(nextTypeId) => onChange(rows.map((entry, i) => i === index ? { ...entry, typeId: nextTypeId } : entry))}
        />
        <label className="field"><span>Nominal</span><input required disabled={disabled} inputMode={inputMode} pattern={pattern} value={row.amount}
          onChange={(event) => onChange(rows.map((entry, i) => i === index ? { ...entry, amount: event.target.value } : entry))} /></label>
        <button type="button" className="row-action" data-tone="danger" disabled={disabled} aria-label={`Hapus biaya ${index + 1}`}
          onClick={() => {
            const remaining = rows.filter((_, i) => i !== index);
            onChange(remaining);
            if (!remaining.length) onEnabledChange(false);
          }}>Hapus</button>
      </div>)}
      {rows.length > 0 && <button type="button" className="text-link form-row-add" onClick={addRow}
        disabled={disabled || (maxRows !== undefined && rows.length >= maxRows)}>
        <Plus size={16} aria-hidden="true" /> Tambah biaya lain
      </button>}
    </div>
  </OptionalFormSection>;
}
