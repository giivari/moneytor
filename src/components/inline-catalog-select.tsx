"use client";

import { useState, type ReactNode } from "react";
import { financeRequest } from "@/lib/finance/client";
import type { Catalog, CatalogRecord } from "@/lib/repositories/catalogs";
import { useFinanceFeedback } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";

const CREATE_VALUE = "__create_new__";

export function InlineCatalogSelect({
  label,
  catalog,
  appliesTo,
  value,
  onChange,
  items,
  emptyLabel,
  extraOptions,
  required = false,
  disabled = false,
  createLabel = catalog === "transactionCategories" ? "kategori" : "pilihan",
  onCreated,
}: {
  label: string;
  catalog: Exclude<Catalog, "instrumentTypes">;
  appliesTo?: "income" | "expense";
  value: string;
  onChange: (nextValue: string) => void;
  items: { id: string; displayName: string }[];
  emptyLabel?: string;
  extraOptions?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  createLabel?: string;
  onCreated?: (item: CatalogRecord) => void;
}) {
  const { notify, refresh } = useFinanceFeedback();
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [localItems, setLocalItems] = useState<{ id: string; displayName: string }[]>([]);

  const mergedItems = [
    ...items,
    ...localItems.filter((created) => !items.some((existing) => existing.id === created.id)),
  ];

  async function submitCreate() {
    const trimmed = draftName.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await financeRequest<{ item: CatalogRecord }>("catalog-create", {
        catalog,
        displayName: trimmed,
        ...(catalog === "transactionCategories" ? { appliesTo: appliesTo ?? "expense" } : {}),
      });
      const created = response.item;
      setLocalItems((prev) => [...prev, { id: created.id, displayName: created.displayName }]);
      onChange(created.id);
      onCreated?.(created);
      setDraftName("");
      setCreating(false);
      notify(`${created.displayName} berhasil ditambahkan.`);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menambahkan pilihan baru.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inline-catalog-select">
      <label className="field">
        <span>{label}</span>
        <select
          required={required}
          disabled={disabled || saving}
          value={value}
          onChange={(event) => {
            if (event.target.value === CREATE_VALUE) {
              setCreating(true);
              setError("");
              return;
            }
            onChange(event.target.value);
          }}
        >
          {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
          {extraOptions}
          {mergedItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
          <option value={CREATE_VALUE}>+ Tambah {createLabel} baru…</option>
        </select>
      </label>
      {creating && (
        <div className="inline-catalog-creator" role="group" aria-label={`Tambah ${createLabel} baru`}>
          <div className="inline-field-action">
            <label className="field">
              <span>Nama {createLabel} baru</span>
              <input
                autoFocus
                maxLength={120}
                disabled={saving}
                value={draftName}
                placeholder={`Mis. ${catalog === "transactionCategories" ? (appliesTo === "income" ? "Bonus / Freelance" : "Langganan / Kesehatan") : "Nama baru"}`}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    void submitCreate();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setCreating(false);
                    setError("");
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="button-primary"
              disabled={saving || !draftName.trim()}
              onClick={() => void submitCreate()}
            >
              {saving ? <LoadingIndicator>Menambah…</LoadingIndicator> : "Tambah"}
            </button>
            <button
              type="button"
              className="finance-secondary"
              disabled={saving}
              onClick={() => {
                setCreating(false);
                setDraftName("");
                setError("");
              }}
            >
              Batal
            </button>
          </div>
          {error && <p className="finance-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

