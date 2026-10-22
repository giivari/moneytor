"use client";

import { sortNamed } from "@/lib/list-order";
import { useState } from "react";
import { PencilSimple, Plus } from "@phosphor-icons/react";
import { CURATED_PAYMENT_NETWORKS, CURATED_PROVIDERS, resolveProviderMark } from "@/lib/domain/provider-marks";
import { ProviderBrandMark } from "./provider-brand-mark";
import { financeRequest } from "@/lib/finance/client";
import type { Catalog, CatalogRecord } from "@/lib/repositories/catalogs";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LifecycleConfirmation } from "./lifecycle-confirmation";
import { LoadingIndicator } from "./loading-indicator";

export function CatalogManager({ catalog, items }: { catalog: Catalog; items: CatalogRecord[] }) {
  const { refresh, notify, refreshing } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"income" | "expense">("expense");
  const [confirmation, setConfirmation] = useState<{ id: string; name: string; operation: "catalog-archive" | "catalog-delete" } | null>(null);
  const [archived, setArchived] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const visibleItems = sortNamed(items.filter((item) => archived ? !item.isActive : item.isActive), item => item.displayName, item => item.id);
  const [operationPending, setOperationPending] = useState("");
  const [error, setError] = useState("");

  function stopEditing() { setEditing(null); setName(""); setError(""); }
  async function run(operation: string, body: Record<string, unknown>) {
    if (refreshing || !begin()) return;
    setOperationPending(operation); setPendingId(String(body.id ?? "")); setError("");
    try {
      await financeRequest(operation, { catalog, ...body });
      stopEditing(); setConfirmation(null); if (operation === "catalog-create") setArchived(false); refresh();
      notify(operation === "catalog-restore" ? "Pilihan dipulihkan. Tersedia di daftar aktif." : operation === "catalog-archive" ? "Pilihan berhasil diarsipkan." : operation === "catalog-rename" ? "Nama berhasil diperbarui." : "Pilihan berhasil ditambahkan.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Perubahan gagal disimpan."); }
    finally { finish(); }
  }
  function edit(item: CatalogRecord) { setEditing(item.id); setName(item.displayName); setConfirmation(null); setError(""); }

  const showMarks = catalog === "providers" || catalog === "paymentNetworks";
  const existingKeys = new Set(items.map((item) => resolveProviderMark(item.displayName).matchedKey).filter(Boolean));
  const existingNorms = new Set(items.map((item) => item.displayName.toLowerCase().trim()));
  const availablePresets = catalog === "providers"
    ? CURATED_PROVIDERS.filter((p) => !existingKeys.has(p.key) && !existingNorms.has(p.displayName.toLowerCase()))
    : catalog === "paymentNetworks"
      ? CURATED_PAYMENT_NETWORKS.filter((p) => !existingKeys.has(p.key) && !existingNorms.has(p.displayName.toLowerCase()))
      : [];

  return <section className="settings-detail-surface" aria-label="Daftar pilihan">
    <fieldset className="finance-fieldset" disabled={pending || refreshing} aria-busy={pending || refreshing}>
      <label className="finance-history-toggle"><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); stopEditing(); }} /> Lihat yang diarsipkan ({items.filter((item) => !item.isActive).length})</label>
      <div className="settings-catalog-list">{visibleItems.map((item) => {
        const mark = showMarks ? resolveProviderMark(item.displayName) : null;
        return <div className="settings-catalog-item" key={item.id}>
        <div className="settings-catalog-row compact-management-item data-list-row data-list-row--actions">
          <div className={mark ? "data-list-identity" : "settings-catalog-identity"}>
            {mark && <ProviderBrandMark mark={mark} />}
            <div className="settings-catalog-identity"><strong>{item.displayName}</strong><small>{item.appliesTo === "income" ? "Pemasukan · " : item.appliesTo === "expense" ? "Pengeluaran · " : ""}{item.isBuiltIn ? "Bawaan" : item.isActive ? "Kustom" : "Diarsipkan"}</small></div>
          </div>
          {!item.isBuiltIn && editing !== item.id && <div className="settings-catalog-actions compact-management-actions">
            <button type="button" className="finance-edit-button" onClick={() => edit(item)} aria-label={`Ubah nama ${item.displayName}`}><PencilSimple size={14} aria-hidden="true" /> Ubah</button>
            {item.isActive ? <button type="button" className="finance-danger" onClick={() => { setConfirmation({ id: item.id, name: item.displayName, operation: "catalog-archive" }); stopEditing(); }}>Arsipkan</button> : <>
              <button type="button" className="finance-secondary" aria-busy={pending && pendingId === item.id} onClick={() => void run("catalog-restore", { id: item.id })}>{pending && pendingId === item.id ? <LoadingIndicator>Memulihkan...</LoadingIndicator> : "Pulihkan"}</button>
              {item.canDelete && <button type="button" className="finance-danger" onClick={() => setConfirmation({ id: item.id, name: item.displayName, operation: "catalog-delete" })}>Hapus permanen</button>}
            </>}
          </div>}</div>
        {editing === item.id && <form className="settings-catalog-editor compact-management-body" onSubmit={(event) => { event.preventDefault(); void run("catalog-rename", { id: item.id, displayName: name }); }}>
          <label className="field"><span>Nama baru</span><input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <div className="settings-catalog-editor-actions"><button type="button" className="finance-secondary" onClick={stopEditing}>Batal</button>
            <button type="submit" className="button-primary" aria-busy={pending}>{pending && operationPending === "catalog-rename" ? <LoadingIndicator>Memperbarui…</LoadingIndicator> : "Simpan nama"}</button></div>
        </form>}

      </div>;
      })}</div>
      {!visibleItems.length && <p className="settings-catalog-empty">{archived ? "Belum ada pilihan yang diarsipkan." : "Belum ada pilihan aktif."}</p>}
      {archived && visibleItems.some((item) => !item.isBuiltIn && !item.canDelete) && <p className="finance-hint">Pilihan yang sudah dipakai tidak dapat dihapus permanen. Pulihkan untuk menggunakannya kembali.</p>}
      {editing === "new" ? <form className="settings-catalog-new compact-management-body" onSubmit={(event) => { event.preventDefault(); void run("catalog-create", { displayName: name, appliesTo: catalog === "transactionCategories" ? scope : undefined }); }}>
        <label className="field"><span>Nama pilihan baru</span><input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        {catalog === "transactionCategories" && <label className="field"><span>Untuk</span><select value={scope} onChange={(event) => setScope(event.target.value as "income" | "expense")}><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option></select></label>}
        <div className="settings-catalog-editor-actions"><button type="button" className="finance-secondary" onClick={stopEditing}>Batal</button>
          <button type="submit" className="button-primary" aria-busy={pending}>{pending && operationPending === "catalog-create" ? <LoadingIndicator>Menyimpan…</LoadingIndicator> : "Simpan pilihan"}</button></div>
      </form> : <button type="button" className="settings-catalog-add" onClick={() => { setEditing("new"); setName(""); setConfirmation(null); setError(""); }}><Plus size={18} aria-hidden="true" /> Tambah pilihan</button>}
      {availablePresets.length > 0 && <details className="investment-optional" open={visibleItems.length === 0 || undefined}><summary>Tambah cepat dari katalog terkurasi ({availablePresets.length}) <span>opsional</span></summary>
        <div className="catalog-preset-grid">{availablePresets.map((preset) => <button key={preset.key} type="button" className="finance-edit-button catalog-preset-chip" onClick={() => void run("catalog-create", { displayName: preset.displayName })}>
          <ProviderBrandMark mark={{ monogram: preset.monogram, tone: preset.tone, matchedKey: preset.key }} size="sm" />
          <span>+ {preset.displayName}</span>
        </button>)}</div>
      </details>}
    </fieldset>
    {error && <p className="finance-error" role="alert">{error}</p>}
    {confirmation && <LifecycleConfirmation operation={confirmation.operation} body={{ catalog, id: confirmation.id }} title={`${confirmation.operation === "catalog-delete" ? "Hapus permanen" : "Arsipkan"} ${confirmation.name}?`} onClose={() => setConfirmation(null)} />}
  </section>;
}
