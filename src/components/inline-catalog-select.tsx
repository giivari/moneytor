"use client";

import { useState, type ReactNode } from "react";
import { financeRequest } from "@/lib/finance/client";
import type { Catalog, CatalogRecord, CategoryNature } from "@/lib/repositories/catalogs";
import { useFinanceFeedback } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";

const CREATE_VALUE = "__create_new__";
const CREATE_CHILD_VALUE = "__create_child__";

export const CATEGORY_NATURE_LABELS: Record<CategoryNature, string> = {
  need: "Kebutuhan",
  want: "Keinginan",
  obligation: "Kewajiban",
  social: "Sosial",
  saving: "Tabungan",
};

export type SelectableCatalogItem = {
  id: string;
  displayName: string;
  parentId?: string | null;
  nature?: CategoryNature | null;
  natureOverride?: CategoryNature | null;
  effectiveNature?: CategoryNature | null;
};

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
  items: SelectableCatalogItem[];
  emptyLabel?: string;
  extraOptions?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  createLabel?: string;
  onCreated?: (item: CatalogRecord) => void;
}) {
  const { notify, refresh } = useFinanceFeedback();
  const [creating, setCreating] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | undefined>(undefined);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [natureSaving, setNatureSaving] = useState(false);
  const [error, setError] = useState("");
  const [localItems, setLocalItems] = useState<SelectableCatalogItem[]>([]);
  const [localNatureOverrides, setLocalNatureOverrides] = useState<Record<string, CategoryNature | null>>({});

  const mergedItems = [
    ...items,
    ...localItems.filter((created) => !items.some((existing) => existing.id === created.id)),
  ].map((item) => {
    if (!(item.id in localNatureOverrides)) return item;
    const override = localNatureOverrides[item.id];
    return {
      ...item,
      natureOverride: override,
      effectiveNature: override ?? item.effectiveNature ?? null,
    };
  });

  const isCategoryCatalog = catalog === "transactionCategories";
  const parentSet = new Set(mergedItems.filter((item) => !item.parentId).map((item) => item.id));
  const rootItems = isCategoryCatalog
    ? mergedItems.filter((item) => !item.parentId || !parentSet.has(item.parentId))
    : mergedItems;

  const selectedItem = value ? mergedItems.find((item) => item.id === value) : undefined;
  const selectedParentId = isCategoryCatalog
    ? selectedItem
      ? selectedItem.parentId && parentSet.has(selectedItem.parentId)
        ? selectedItem.parentId
        : selectedItem.id
      : ""
    : value;
  const selectedChildId =
    isCategoryCatalog && selectedItem?.parentId && parentSet.has(selectedItem.parentId)
      ? selectedItem.id
      : "";
  const selectedParent = selectedParentId ? mergedItems.find((item) => item.id === selectedParentId) : undefined;
  const childItems = isCategoryCatalog && selectedParentId
    ? mergedItems.filter((item) => item.parentId === selectedParentId)
    : [];

  async function submitCreate() {
    const trimmed = draftName.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await financeRequest<{ item: CatalogRecord }>("catalog-create", {
        catalog,
        displayName: trimmed,
        ...(isCategoryCatalog
          ? {
              appliesTo: appliesTo ?? "expense",
              ...(createParentId ? { parentId: createParentId } : {}),
            }
          : {}),
      });
      const created = response.item;
      setLocalItems((prev) => [
        ...prev,
        {
          id: created.id,
          displayName: created.displayName,
          parentId: created.parentId ?? createParentId ?? null,
          nature: created.nature ?? null,
          natureOverride: created.natureOverride ?? null,
          effectiveNature: created.effectiveNature ?? null,
        },
      ]);
      onChange(created.id);
      onCreated?.(created);
      setDraftName("");
      setCreating(false);
      setCreateParentId(undefined);
      notify(`${created.displayName} berhasil ditambahkan.`);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menambahkan pilihan baru.");
    } finally {
      setSaving(false);
    }
  }

  async function submitNatureChange(nextValue: string) {
    if (!selectedItem || natureSaving) return;
    const nextNature = (nextValue || null) as CategoryNature | null;
    setNatureSaving(true);
    setError("");
    try {
      await financeRequest<{ ok: boolean }>("category-nature", {
        id: selectedItem.id,
        nature: nextNature,
      });
      setLocalNatureOverrides((prev) => ({ ...prev, [selectedItem.id]: nextNature }));
      onCreated?.(selectedItem as CatalogRecord);
      notify(`Sifat kategori ${selectedItem.displayName} diperbarui.`);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal memperbarui sifat kategori.");
    } finally {
      setNatureSaving(false);
    }
  }

  return (
    <div className="inline-catalog-select">
      <div className={isCategoryCatalog && selectedParentId ? "field-grid" : undefined}>
        <label className="field">
          <span>{isCategoryCatalog ? `${label} · Induk` : label}</span>
          <select
            required={required}
            disabled={disabled || saving}
            value={isCategoryCatalog ? selectedParentId : value}
            onChange={(event) => {
              if (event.target.value === CREATE_VALUE) {
                setCreateParentId(undefined);
                setCreating(true);
                setError("");
                return;
              }
              onChange(event.target.value);
            }}
          >
            {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
            {extraOptions}
            {rootItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
                {isCategoryCatalog && appliesTo === "expense" && item.effectiveNature
                  ? ` · ${CATEGORY_NATURE_LABELS[item.effectiveNature]}`
                  : ""}
              </option>
            ))}
            <option value={CREATE_VALUE}>
              + Tambah {isCategoryCatalog ? `${createLabel} induk` : createLabel} baru…
            </option>
          </select>
        </label>

        {isCategoryCatalog && selectedParentId && (
          <label className="field">
            <span>Subkategori ({selectedParent?.displayName ?? "Induk"})</span>
            <select
              disabled={disabled || saving}
              value={selectedChildId}
              onChange={(event) => {
                if (event.target.value === CREATE_CHILD_VALUE) {
                  setCreateParentId(selectedParentId);
                  setCreating(true);
                  setError("");
                  return;
                }
                onChange(event.target.value || selectedParentId);
              }}
            >
              <option value="">
                Langsung di {selectedParent?.displayName ?? "kategori induk"}
              </option>
              {childItems.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.displayName}
                  {appliesTo === "expense" && child.effectiveNature
                    ? ` · ${CATEGORY_NATURE_LABELS[child.effectiveNature]}`
                    : ""}
                </option>
              ))}
              <option value={CREATE_CHILD_VALUE}>
                + Tambah subkategori di {selectedParent?.displayName ?? "induk"}…
              </option>
            </select>
          </label>
        )}
      </div>

      {isCategoryCatalog && appliesTo === "expense" && selectedItem && (
        <div className="category-nature-bar">
          <small className="finance-hint">
            Sifat efektif:{" "}
            <strong>
              {selectedItem.effectiveNature
                ? CATEGORY_NATURE_LABELS[selectedItem.effectiveNature]
                : "Tanpa sifat"}
            </strong>
            {selectedItem.natureOverride ? " (diubah pengguna)" : ""}
          </small>
          <label className="field">
            <span>Ubah sifat kategori ({selectedItem.displayName})</span>
            <select
              disabled={disabled || natureSaving}
              value={selectedItem.natureOverride ?? ""}
              onChange={(event) => void submitNatureChange(event.target.value)}
            >
              <option value="">
                Ikuti bawaan (
                {selectedItem.nature
                  ? CATEGORY_NATURE_LABELS[selectedItem.nature]
                  : selectedParent?.effectiveNature
                    ? CATEGORY_NATURE_LABELS[selectedParent.effectiveNature]
                    : "Tanpa sifat"}
                )
              </option>
              <option value="need">Kebutuhan</option>
              <option value="want">Keinginan</option>
              <option value="obligation">Kewajiban</option>
              <option value="social">Sosial</option>
              <option value="saving">Tabungan</option>
            </select>
          </label>
        </div>
      )}

      {creating && (
        <div
          className="inline-catalog-creator"
          role="group"
          aria-label={`Tambah ${createParentId ? `subkategori di ${selectedParent?.displayName ?? "induk"}` : createLabel} baru`}
        >
          <div className="inline-field-action">
            <label className="field">
              <span>
                Nama {createParentId ? `subkategori (${selectedParent?.displayName ?? "induk"})` : `${createLabel} baru`}
              </span>
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
                    setCreateParentId(undefined);
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
                setCreateParentId(undefined);
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
      {!creating && error && <p className="finance-error" role="alert">{error}</p>}
    </div>
  );
}

