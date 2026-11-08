"use client";

import { sortNamed } from "@/lib/list-order";
import { useState } from "react";
import { LockKey, PencilSimple, Plus, SlidersHorizontal, Tag } from "@phosphor-icons/react";
import { CURATED_PAYMENT_NETWORKS, CURATED_PROVIDERS, resolveProviderMark } from "@/lib/domain/provider-marks";
import { ProviderBrandMark } from "./provider-brand-mark";
import { CATEGORY_NATURE_LABELS } from "./inline-catalog-select";
import { financeRequest } from "@/lib/finance/client";
import type { Catalog, CatalogRecord, CategoryNature } from "@/lib/repositories/catalogs";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LifecycleConfirmation } from "./lifecycle-confirmation";
import { LoadingIndicator } from "./loading-indicator";

type CreationContext = {
  parentId?: string;
  parentName?: string;
  appliesTo: "income" | "expense";
  isAlias?: boolean;
} | null;

export function CatalogManager({ catalog, items }: { catalog: Catalog; items: CatalogRecord[] }) {
  const { refresh, notify, refreshing } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const isCategory = catalog === "transactionCategories";

  const [archived, setArchived] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<"all" | "expense" | "income">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNatureId, setEditingNatureId] = useState<string | null>(null);
  const [natureValue, setNatureValue] = useState<string>("");
  const [creationContext, setCreationContext] = useState<CreationContext>(null);
  const [isCreatingRoot, setIsCreatingRoot] = useState(false);
  const [rootScope, setRootScope] = useState<"income" | "expense">("expense");
  const [name, setName] = useState("");
  const [confirmation, setConfirmation] = useState<{ id: string; name: string; operation: "catalog-archive" | "catalog-delete" } | null>(null);
  const [pendingId, setPendingId] = useState("");
  const [operationPending, setOperationPending] = useState("");
  const [error, setError] = useState("");

  function stopEditing() {
    setEditingId(null);
    setEditingNatureId(null);
    setCreationContext(null);
    setIsCreatingRoot(false);
    setName("");
    setNatureValue("");
    setError("");
  }

  async function run(operation: string, body: Record<string, unknown>) {
    if (refreshing || !begin()) return;
    setOperationPending(operation);
    setPendingId(String(body.id ?? ""));
    setError("");
    try {
      await financeRequest(operation, { catalog, ...body });
      stopEditing();
      setConfirmation(null);
      if (operation === "catalog-create") setArchived(false);
      refresh();
      notify(
        operation === "catalog-restore"
          ? "Pilihan dipulihkan. Tersedia di daftar aktif."
          : operation === "catalog-archive"
            ? "Pilihan berhasil dinonaktifkan."
            : operation === "catalog-rename"
              ? "Nama berhasil diperbarui."
              : "Pilihan berhasil ditambahkan."
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Perubahan gagal disimpan.");
    } finally {
      finish();
    }
  }

  async function submitNature(item: CatalogRecord) {
    if (refreshing || !begin()) return;
    setOperationPending("category-nature");
    setPendingId(item.id);
    setError("");
    const nextNature = (natureValue || null) as CategoryNature | null;
    try {
      await financeRequest<{ ok: boolean }>("category-nature", {
        id: item.id,
        nature: nextNature,
      });
      stopEditing();
      refresh();
      notify(`Sifat kategori ${item.displayName} berhasil diperbarui.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal memperbarui sifat kategori.");
    } finally {
      finish();
    }
  }

  function startRename(item: CatalogRecord) {
    setEditingId(item.id);
    setName(item.displayName);
    setEditingNatureId(null);
    setCreationContext(null);
    setIsCreatingRoot(false);
    setConfirmation(null);
    setError("");
  }

  function startNatureChange(item: CatalogRecord) {
    setEditingNatureId(item.id);
    setNatureValue(item.natureOverride ?? "");
    setEditingId(null);
    setCreationContext(null);
    setIsCreatingRoot(false);
    setConfirmation(null);
    setError("");
  }

  function startNewChild(parent: CatalogRecord) {
    setCreationContext({
      parentId: parent.id,
      parentName: parent.displayName,
      appliesTo: parent.appliesTo ?? "expense",
      isAlias: false,
    });
    setName("");
    setEditingId(null);
    setEditingNatureId(null);
    setIsCreatingRoot(false);
    setConfirmation(null);
    setError("");
  }

  function startNewAlias(parent: CatalogRecord | undefined, child: CatalogRecord) {
    setCreationContext({
      parentId: parent?.id ?? child.parentId ?? undefined,
      parentName: parent?.displayName ?? "kategori induk",
      appliesTo: child.appliesTo ?? "expense",
      isAlias: true,
    });
    setName("");
    setEditingId(null);
    setEditingNatureId(null);
    setIsCreatingRoot(false);
    setConfirmation(null);
    setError("");
  }

  function startNewRoot(scope: "income" | "expense") {
    setIsCreatingRoot(true);
    setRootScope(scope);
    setName("");
    setCreationContext(null);
    setEditingId(null);
    setEditingNatureId(null);
    setConfirmation(null);
    setError("");
  }

  // Brand marks for providers & payment networks
  const showMarks = catalog === "providers" || catalog === "paymentNetworks";
  const existingKeys = new Set(items.map((item) => resolveProviderMark(item.displayName).matchedKey).filter(Boolean));
  const existingNorms = new Set(items.map((item) => item.displayName.toLowerCase().trim()));
  const availablePresets =
    catalog === "providers"
      ? CURATED_PROVIDERS.filter((p) => !existingKeys.has(p.key) && !existingNorms.has(p.displayName.toLowerCase()))
      : catalog === "paymentNetworks"
        ? CURATED_PAYMENT_NETWORKS.filter((p) => !existingKeys.has(p.key) && !existingNorms.has(p.displayName.toLowerCase()))
        : [];

  // Filter items by active/archived state
  const visibleItems = sortNamed(
    items.filter((item) => (archived ? !item.isActive : item.isActive)),
    (item) => item.displayName,
    (item) => item.id
  );

  // Tree helper for categories
  function renderCategoryTree(scope: "expense" | "income") {
    const scopeItems = visibleItems.filter((item) => item.appliesTo === scope);
    const visibleParentIds = new Set(scopeItems.filter((item) => !item.parentId).map((item) => item.id));
    const roots = sortNamed(
      scopeItems.filter((item) => !item.parentId || !visibleParentIds.has(item.parentId)),
      (item) => item.displayName,
      (item) => item.id
    );

    const scopeTitle = scope === "expense" ? "Kategori Pengeluaran" : "Kategori Pemasukan";

    return (
      <div className="settings-catalog-scope-section" key={scope}>
        <h3 className="settings-catalog-scope-heading">
          <Tag size={16} aria-hidden="true" />
          <span>{scopeTitle}</span>
          <span className="count-pill">{scopeItems.length}</span>
        </h3>

        <div className="settings-catalog-tree">
          {roots.map((root) => {
            const children = sortNamed(
              scopeItems.filter((item) => item.parentId === root.id),
              (item) => item.displayName,
              (item) => item.id
            );

            return (
              <div className="settings-catalog-group" key={root.id}>
                {/* Parent Row */}
                <div className="settings-catalog-parent-head data-list-row data-list-row--actions">
                  <div className="settings-catalog-parent-identity">
                    <strong>{root.displayName}</strong>
                    <div className="settings-catalog-meta-tags">
                      <span className="u-pill">Induk</span>
                      {root.isBuiltIn ? (
                        <span className="catalog-locked-pill" title="Entri bawaan terkunci: nama, induk, dan system_key tidak bisa diubah">
                          <LockKey size={12} aria-hidden="true" /> Bawaan (Terkunci)
                        </span>
                      ) : (
                        <span className="u-pill">{root.isActive ? "Kustom" : "Diarsipkan"}</span>
                      )}
                      {root.systemKey && (
                        <code className="catalog-key-pill" title="Kunci sistem bawaan">
                          {root.systemKey}
                        </code>
                      )}
                      {root.appliesTo === "expense" && (
                        <span
                          className="catalog-nature-pill"
                          data-overridden={root.natureOverride ? "true" : undefined}
                          title={root.natureOverride ? "Sifat diubah oleh pengguna" : "Sifat efektif"}
                        >
                          Sifat: {root.effectiveNature ? CATEGORY_NATURE_LABELS[root.effectiveNature] : "Tanpa sifat"}
                          {root.natureOverride ? " (diubah)" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="settings-catalog-actions compact-management-actions">
                    <button
                      type="button"
                      className="finance-edit-button"
                      onClick={() => startNewChild(root)}
                      aria-label={`Tambah anak kategori di bawah ${root.displayName}`}
                    >
                      <Plus size={14} aria-hidden="true" /> Anak
                    </button>
                    {root.appliesTo === "expense" && (
                      <button
                        type="button"
                        className="finance-edit-button"
                        onClick={() => startNatureChange(root)}
                        aria-label={`Ganti sifat kategori ${root.displayName}`}
                      >
                        <SlidersHorizontal size={14} aria-hidden="true" /> Sifat
                      </button>
                    )}
                    {!root.isBuiltIn && editingId !== root.id && (
                      <button
                        type="button"
                        className="finance-edit-button"
                        onClick={() => startRename(root)}
                        aria-label={`Ubah nama ${root.displayName}`}
                      >
                        <PencilSimple size={14} aria-hidden="true" /> Ubah
                      </button>
                    )}
                    {root.isActive ? (
                      <button
                        type="button"
                        className="finance-danger"
                        onClick={() => {
                          setConfirmation({ id: root.id, name: root.displayName, operation: "catalog-archive" });
                          stopEditing();
                        }}
                      >
                        Nonaktifkan
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="finance-secondary"
                          aria-busy={pending && pendingId === root.id}
                          onClick={() => void run("catalog-restore", { id: root.id })}
                        >
                          {pending && pendingId === root.id ? <LoadingIndicator>Mengaktifkan...</LoadingIndicator> : "Aktifkan"}
                        </button>
                        {root.canDelete && (
                          <button
                            type="button"
                            className="finance-danger"
                            onClick={() => setConfirmation({ id: root.id, name: root.displayName, operation: "catalog-delete" })}
                          >
                            Hapus permanen
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Inline Rename Form for Parent */}
                {editingId === root.id && (
                  <form
                    className="settings-catalog-editor compact-management-body"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run("catalog-rename", { id: root.id, displayName: name });
                    }}
                  >
                    <label className="field">
                      <span>Nama baru</span>
                      <input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
                    </label>
                    <div className="settings-catalog-editor-actions">
                      <button type="button" className="finance-secondary" onClick={stopEditing}>
                        Batal
                      </button>
                      <button type="submit" className="button-primary" aria-busy={pending}>
                        {pending && operationPending === "catalog-rename" ? <LoadingIndicator>Memperbarui…</LoadingIndicator> : "Simpan nama"}
                      </button>
                    </div>
                  </form>
                )}

                {/* Inline Nature Change Form for Parent */}
                {editingNatureId === root.id && (
                  <form
                    className="settings-catalog-nature-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitNature(root);
                    }}
                  >
                    <div className="settings-catalog-nature-header">
                      <strong>Ganti sifat kategori ({root.displayName})</strong>
                      <small className="finance-hint">
                        Sifat efektif saat ini: <strong>{root.effectiveNature ? CATEGORY_NATURE_LABELS[root.effectiveNature] : "Tanpa sifat"}</strong>
                      </small>
                    </div>
                    <label className="field">
                      <span>Pilih sifat</span>
                      <select value={natureValue} onChange={(e) => setNatureValue(e.target.value)}>
                        <option value="">Ikuti bawaan (hapus penyesuaian)</option>
                        <option value="need">Kebutuhan</option>
                        <option value="want">Keinginan</option>
                        <option value="obligation">Kewajiban</option>
                        <option value="social">Sosial</option>
                        <option value="saving">Tabungan</option>
                      </select>
                    </label>
                    <div className="settings-catalog-editor-actions">
                      <button type="button" className="finance-secondary" onClick={stopEditing}>
                        Batal
                      </button>
                      <button type="submit" className="button-primary" aria-busy={pending}>
                        {pending && operationPending === "category-nature" ? <LoadingIndicator>Menyimpan…</LoadingIndicator> : "Simpan sifat"}
                      </button>
                    </div>
                  </form>
                )}

                {/* Children Rows */}
                {children.length > 0 && (
                  <div className="settings-catalog-children">
                    {children.map((child) => (
                      <div className="settings-catalog-child-row data-list-row data-list-row--actions" key={child.id}>
                        <div className="settings-catalog-parent-identity">
                          <strong>{child.displayName}</strong>
                          <div className="settings-catalog-meta-tags">
                            <span className="u-pill">Anak</span>
                            {child.isBuiltIn ? (
                              <span className="catalog-locked-pill" title="Entri bawaan terkunci: nama, induk, dan system_key tidak bisa diubah">
                                <LockKey size={12} aria-hidden="true" /> Bawaan (Terkunci)
                              </span>
                            ) : (
                              <span className="u-pill">{child.isActive ? "Kustom" : "Diarsipkan"}</span>
                            )}
                            {child.systemKey && (
                              <code className="catalog-key-pill" title="Kunci sistem bawaan">
                                {child.systemKey}
                              </code>
                            )}
                            {child.appliesTo === "expense" && (
                              <span
                                className="catalog-nature-pill"
                                data-overridden={child.natureOverride ? "true" : undefined}
                                title={child.natureOverride ? "Sifat diubah oleh pengguna" : "Sifat efektif"}
                              >
                                Sifat: {child.effectiveNature ? CATEGORY_NATURE_LABELS[child.effectiveNature] : "Tanpa sifat"}
                                {child.natureOverride ? " (diubah)" : ""}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="settings-catalog-actions compact-management-actions">
                          <button
                            type="button"
                            className="finance-edit-button"
                            onClick={() => startNewAlias(root, child)}
                            aria-label={`Tambah alias untuk ${child.displayName}`}
                          >
                            <Plus size={14} aria-hidden="true" /> Alias
                          </button>
                          {child.appliesTo === "expense" && (
                            <button
                              type="button"
                              className="finance-edit-button"
                              onClick={() => startNatureChange(child)}
                              aria-label={`Ganti sifat kategori ${child.displayName}`}
                            >
                              <SlidersHorizontal size={14} aria-hidden="true" /> Sifat
                            </button>
                          )}
                          {!child.isBuiltIn && editingId !== child.id && (
                            <button
                              type="button"
                              className="finance-edit-button"
                              onClick={() => startRename(child)}
                              aria-label={`Ubah nama ${child.displayName}`}
                            >
                              <PencilSimple size={14} aria-hidden="true" /> Ubah
                            </button>
                          )}
                          {child.isActive ? (
                            <button
                              type="button"
                              className="finance-danger"
                              onClick={() => {
                                setConfirmation({ id: child.id, name: child.displayName, operation: "catalog-archive" });
                                stopEditing();
                              }}
                            >
                              Nonaktifkan
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="finance-secondary"
                                aria-busy={pending && pendingId === child.id}
                                onClick={() => void run("catalog-restore", { id: child.id })}
                              >
                                {pending && pendingId === child.id ? <LoadingIndicator>Mengaktifkan...</LoadingIndicator> : "Aktifkan"}
                              </button>
                              {child.canDelete && (
                                <button
                                  type="button"
                                  className="finance-danger"
                                  onClick={() => setConfirmation({ id: child.id, name: child.displayName, operation: "catalog-delete" })}
                                >
                                  Hapus permanen
                                </button>
                              )}
                            </>
                          )}
                        </div>

                        {/* Inline Rename Form for Child */}
                        {editingId === child.id && (
                          <form
                            className="settings-catalog-editor compact-management-body"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void run("catalog-rename", { id: child.id, displayName: name });
                            }}
                          >
                            <label className="field">
                              <span>Nama baru</span>
                              <input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
                            </label>
                            <div className="settings-catalog-editor-actions">
                              <button type="button" className="finance-secondary" onClick={stopEditing}>
                                Batal
                              </button>
                              <button type="submit" className="button-primary" aria-busy={pending}>
                                {pending && operationPending === "catalog-rename" ? <LoadingIndicator>Memperbarui…</LoadingIndicator> : "Simpan nama"}
                              </button>
                            </div>
                          </form>
                        )}

                        {/* Inline Nature Change Form for Child */}
                        {editingNatureId === child.id && (
                          <form
                            className="settings-catalog-nature-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void submitNature(child);
                            }}
                          >
                            <div className="settings-catalog-nature-header">
                              <strong>Ganti sifat kategori ({child.displayName})</strong>
                              <small className="finance-hint">
                                Sifat efektif saat ini: <strong>{child.effectiveNature ? CATEGORY_NATURE_LABELS[child.effectiveNature] : "Tanpa sifat"}</strong>
                              </small>
                            </div>
                            <label className="field">
                              <span>Pilih sifat</span>
                              <select value={natureValue} onChange={(e) => setNatureValue(e.target.value)}>
                                <option value="">Ikuti bawaan (hapus penyesuaian)</option>
                                <option value="need">Kebutuhan</option>
                                <option value="want">Keinginan</option>
                                <option value="obligation">Kewajiban</option>
                                <option value="social">Sosial</option>
                                <option value="saving">Tabungan</option>
                              </select>
                            </label>
                            <div className="settings-catalog-editor-actions">
                              <button type="button" className="finance-secondary" onClick={stopEditing}>
                                Batal
                              </button>
                              <button type="submit" className="button-primary" aria-busy={pending}>
                                {pending && operationPending === "category-nature" ? <LoadingIndicator>Menyimpan…</LoadingIndicator> : "Simpan sifat"}
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <section className="settings-detail-surface" aria-label="Daftar pilihan">
      <fieldset className="finance-fieldset" disabled={pending || refreshing} aria-busy={pending || refreshing}>
        <label className="finance-history-toggle">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => {
              setArchived(event.target.checked);
              stopEditing();
            }}
          />{" "}
          Lihat yang dinonaktifkan ({items.filter((item) => !item.isActive).length})
        </label>

        {isCategory && (
          <div className="settings-catalog-scope-nav" role="tablist" aria-label="Pilih jenis kategori">
            <button
              type="button"
              role="tab"
              aria-selected={scopeFilter === "all"}
              className="settings-catalog-scope-btn"
              data-active={scopeFilter === "all" ? "true" : undefined}
              onClick={() => setScopeFilter("all")}
            >
              Semua Kategori
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scopeFilter === "expense"}
              className="settings-catalog-scope-btn"
              data-active={scopeFilter === "expense" ? "true" : undefined}
              onClick={() => setScopeFilter("expense")}
            >
              Pengeluaran
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scopeFilter === "income"}
              className="settings-catalog-scope-btn"
              data-active={scopeFilter === "income" ? "true" : undefined}
              onClick={() => setScopeFilter("income")}
            >
              Pemasukan
            </button>
          </div>
        )}

        {isCategory ? (
          <div>
            {(scopeFilter === "all" || scopeFilter === "expense") && renderCategoryTree("expense")}
            {(scopeFilter === "all" || scopeFilter === "income") && renderCategoryTree("income")}
          </div>
        ) : (
          <div className="settings-catalog-list">
            {visibleItems.map((item) => {
              const mark = showMarks ? resolveProviderMark(item.displayName) : null;
              return (
                <div className="settings-catalog-item" key={item.id}>
                  <div className="settings-catalog-row compact-management-item data-list-row data-list-row--actions">
                    <div className={mark ? "data-list-identity" : "settings-catalog-identity"}>
                      {mark && <ProviderBrandMark mark={mark} />}
                      <div className="settings-catalog-identity">
                        <strong>{item.displayName}</strong>
                        <small>
                          {item.isBuiltIn ? "Bawaan" : item.isActive ? "Kustom" : "Diarsipkan"}
                        </small>
                      </div>
                    </div>
                    {!item.isBuiltIn && editingId !== item.id && (
                      <div className="settings-catalog-actions compact-management-actions">
                        <button
                          type="button"
                          className="finance-edit-button"
                          onClick={() => startRename(item)}
                          aria-label={`Ubah nama ${item.displayName}`}
                        >
                          <PencilSimple size={14} aria-hidden="true" /> Ubah
                        </button>
                        {item.isActive ? (
                          <button
                            type="button"
                            className="finance-danger"
                            onClick={() => {
                              setConfirmation({ id: item.id, name: item.displayName, operation: "catalog-archive" });
                              stopEditing();
                            }}
                          >
                            Arsipkan
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="finance-secondary"
                              aria-busy={pending && pendingId === item.id}
                              onClick={() => void run("catalog-restore", { id: item.id })}
                            >
                              {pending && pendingId === item.id ? <LoadingIndicator>Memulihkan...</LoadingIndicator> : "Pulihkan"}
                            </button>
                            {item.canDelete && (
                              <button
                                type="button"
                                className="finance-danger"
                                onClick={() => setConfirmation({ id: item.id, name: item.displayName, operation: "catalog-delete" })}
                              >
                                Hapus permanen
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {editingId === item.id && (
                    <form
                      className="settings-catalog-editor compact-management-body"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run("catalog-rename", { id: item.id, displayName: name });
                      }}
                    >
                      <label className="field">
                        <span>Nama baru</span>
                        <input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
                      </label>
                      <div className="settings-catalog-editor-actions">
                        <button type="button" className="finance-secondary" onClick={stopEditing}>
                          Batal
                        </button>
                        <button type="submit" className="button-primary" aria-busy={pending}>
                          {pending && operationPending === "catalog-rename" ? <LoadingIndicator>Memperbarui…</LoadingIndicator> : "Simpan nama"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!visibleItems.length && (
          <p className="settings-catalog-empty">
            {archived ? "Belum ada pilihan yang dinonaktifkan." : "Belum ada pilihan aktif."}
          </p>
        )}

        {archived && visibleItems.some((item) => !item.isBuiltIn && !item.canDelete) && (
          <p className="finance-hint">Pilihan yang sudah dipakai tidak dapat dihapus permanen. Aktifkan kembali untuk menggunakannya.</p>
        )}

        {/* Form: Tambah Anak / Alias Kategori */}
        {creationContext && (
          <form
            className="settings-catalog-new compact-management-body"
            onSubmit={(event) => {
              event.preventDefault();
              void run("catalog-create", {
                displayName: name,
                appliesTo: creationContext.appliesTo,
                parentId: creationContext.parentId,
              });
            }}
          >
            <div className="settings-catalog-banner">
              <span>
                {creationContext.isAlias ? "Tambah alias" : "Tambah subkategori"} di bawah induk:{" "}
                <strong>{creationContext.parentName}</strong> ({creationContext.appliesTo === "expense" ? "Pengeluaran" : "Pemasukan"})
              </span>
            </div>
            <label className="field">
              <span>Nama {creationContext.isAlias ? "alias" : "subkategori"} baru</span>
              <input
                autoFocus
                required
                maxLength={120}
                value={name}
                placeholder={creationContext.isAlias ? "Mis. Kopi susu / Warung Bu Siti" : "Nama subkategori"}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="settings-catalog-editor-actions">
              <button type="button" className="finance-secondary" onClick={stopEditing}>
                Batal
              </button>
              <button type="submit" className="button-primary" aria-busy={pending}>
                {pending && operationPending === "catalog-create" ? (
                  <LoadingIndicator>Menyimpan…</LoadingIndicator>
                ) : (
                  `Simpan ${creationContext.isAlias ? "alias" : "subkategori"}`
                )}
              </button>
            </div>
          </form>
        )}

        {/* Form: Tambah Kategori Induk Baru (atau item baru untuk non-kategori) */}
        {isCreatingRoot ? (
          <form
            className="settings-catalog-new compact-management-body"
            onSubmit={(event) => {
              event.preventDefault();
              void run("catalog-create", {
                displayName: name,
                appliesTo: isCategory ? rootScope : undefined,
              });
            }}
          >
            <label className="field">
              <span>Nama {isCategory ? "kategori induk baru" : "pilihan baru"}</span>
              <input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            {isCategory && (
              <label className="field">
                <span>Untuk</span>
                <select value={rootScope} onChange={(event) => setRootScope(event.target.value as "income" | "expense")}>
                  <option value="expense">Pengeluaran</option>
                  <option value="income">Pemasukan</option>
                </select>
              </label>
            )}
            <div className="settings-catalog-editor-actions">
              <button type="button" className="finance-secondary" onClick={stopEditing}>
                Batal
              </button>
              <button type="submit" className="button-primary" aria-busy={pending}>
                {pending && operationPending === "catalog-create" ? <LoadingIndicator>Menyimpan…</LoadingIndicator> : "Simpan pilihan"}
              </button>
            </div>
          </form>
        ) : (
          !creationContext && (
            <button
              type="button"
              className="settings-catalog-add"
              onClick={() => startNewRoot(scopeFilter === "income" ? "income" : "expense")}
            >
              <Plus size={18} aria-hidden="true" /> {isCategory ? "Tambah kategori induk" : "Tambah pilihan"}
            </button>
          )
        )}

        {availablePresets.length > 0 && (
          <details className="investment-optional" open={visibleItems.length === 0 || undefined}>
            <summary>
              Tambah cepat dari katalog terkurasi ({availablePresets.length}) <span>opsional</span>
            </summary>
            <div className="catalog-preset-grid">
              {availablePresets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className="finance-edit-button catalog-preset-chip"
                  onClick={() => void run("catalog-create", { displayName: preset.displayName })}
                >
                  <ProviderBrandMark mark={{ monogram: preset.monogram, tone: preset.tone, matchedKey: preset.key }} size="sm" />
                  <span>+ {preset.displayName}</span>
                </button>
              ))}
            </div>
          </details>
        )}
      </fieldset>

      {error && (
        <p className="finance-error" role="alert">
          {error}
        </p>
      )}

      {confirmation && (
        <LifecycleConfirmation
          operation={confirmation.operation}
          body={{ catalog, id: confirmation.id }}
          title={`${confirmation.operation === "catalog-delete" ? "Hapus permanen" : "Nonaktifkan"} ${confirmation.name}?`}
          onClose={() => setConfirmation(null)}
        />
      )}
    </section>
  );
}
