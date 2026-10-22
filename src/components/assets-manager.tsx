"use client";

import { sortTemporal } from "@/lib/list-order";
import { useListSort } from "./use-list-sort";
import { ListSortControl } from "./list-sort-control";

import { useEffect, useRef, useState } from "react";
import { Bank, PencilSimple, Plus, X } from "@phosphor-icons/react";
import { resolveProviderMark } from "@/lib/domain/provider-marks";
import { financeRequest, requestJson } from "@/lib/finance/client";
import { ExportMenuButton } from "./export-menu-button";
import { FinanceOptionsStatus, useFinanceDialog, useFinanceOptions } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import type { AssetOpeningHistory } from "@/lib/repositories/assets";
import type { FinanceAsset } from "@/lib/finance/types";
import type { InvestmentTotal } from "@/lib/investments/types";
import { SectionHeading } from "./section-heading";
import { InvestmentSummary } from "./investment-summary";
import { useMobileViewport } from "./use-mobile-viewport";

function AssetForm({ initial, onClose }: { initial?: FinanceAsset; onClose: () => void }) {
  const { refresh, notify } = useFinanceFeedback();
  const dialog = useFinanceDialog(onClose);
  const { options, optionsError, retry } = useFinanceOptions();
  const [error, setError] = useState("");
  const { pending, begin, finish } = useMutationPending();
  const [operation, setOperation] = useState<"save" | "archive">("save");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [name, setName] = useState(initial?.displayName ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? "IDR");
  const [opening, setOpening] = useState("0");
  const [typeId, setTypeId] = useState(initial?.assetTypeId ?? "");
  const [groupId, setGroupId] = useState(initial?.assetGroupId ?? "");
  const [providerId, setProviderId] = useState(initial?.providerId ?? "");
  const [networkId, setNetworkId] = useState(initial?.paymentNetworkId ?? "");
  const [liquid, setLiquid] = useState(initial?.normallyLiquid ?? false);
  const [spendable, setSpendable] = useState(initial?.normallySpendable ?? false);
  const [suffix, setSuffix] = useState(initial?.safeSuffix ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const exponent = options?.currencies.find((item) => item.code === currency)?.exponent ?? 0;
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!begin()) return; setError(""); setOperation("save");
    try {
      const body = { id: initial?.id, displayName: name, currency,
        openingAmountMinor: initial ? undefined : inputToMinor(opening, exponent), openingEffectiveAt: new Date().toISOString(),
        assetTypeId: typeId || options?.catalogs.assetTypes[0]?.id,
        assetGroupId: groupId || undefined, providerId: providerId || undefined, paymentNetworkId: networkId || undefined,
        normallyLiquid: liquid, normallySpendable: spendable, safeSuffix: suffix || undefined, note: note || undefined };
      await financeRequest(initial ? "asset-update" : "asset-create", body);
      refresh(); notify(initial ? "Aset berhasil diperbarui." : "Aset berhasil ditambahkan."); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Aset gagal disimpan."); }
    finally { finish(); }
  }
  async function archive() {
    if (!initial || !begin()) return;
    setError(""); setOperation("archive");
    try { await financeRequest("asset-archive", { id: initial.id }); refresh(); notify("Aset berhasil diarsipkan."); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Aset gagal diarsipkan."); }
    finally { finish(); }
  }
  return <dialog ref={dialog} className="finance-dialog" onCancel={(event) => { if (pending) event.preventDefault(); }} aria-labelledby="asset-form-title">
    <div className="dialog-heading"><div><span className="eyebrow">ASET TERCATAT</span><h2 id="asset-form-title">{initial ? "Ubah aset" : "Aset baru"}</h2></div>
      <button type="button" className="icon-button" onClick={() => dialog.current?.close()} aria-label="Tutup" disabled={pending}><X size={20} /></button></div>
    {initial && <p className="finance-hint">Mata uang tetap. Koreksi saldo awal tersedia sebagai tindakan terpisah dengan riwayat perubahan.</p>}
    {!options ? <FinanceOptionsStatus error={optionsError} retry={retry} /> : <form onSubmit={save} aria-busy={pending}><fieldset className="finance-fieldset" disabled={pending}>
      <label className="field"><span>Nama aset</span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      {!initial && <div className="field-grid"><label className="field"><span>Mata uang</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}>
        {options.currencies.map((item) => <option key={item.code} value={item.code}>{item.code}</option>)}</select></label>
        <label className="field"><span>Saldo awal</span><input required inputMode="decimal" value={opening} onChange={(event) => setOpening(event.target.value)} /></label></div>}
      <div className="field-grid"><label className="field"><span>Jenis aset</span><select required value={typeId || options.catalogs.assetTypes[0]?.id || ""} onChange={(event) => setTypeId(event.target.value)}>
        {initial?.assetTypeId && !options.catalogs.assetTypes.some((item) => item.id === initial.assetTypeId) && <option value={initial.assetTypeId}>{initial.assetTypeName} (diarsipkan)</option>}
        {options.catalogs.assetTypes.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
        <label className="field"><span>Grup aset</span><select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Tanpa grup</option>
        {initial?.assetGroupId && !options.catalogs.assetGroups.some((item) => item.id === initial.assetGroupId) && <option value={initial.assetGroupId}>{initial.assetGroupName} (diarsipkan)</option>}
        {options.catalogs.assetGroups.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label></div>
      <div className="field-grid"><label className="field"><span>Penyedia</span><select value={providerId} onChange={(event) => setProviderId(event.target.value)}><option value="">Tanpa penyedia</option>
        {initial?.providerId && !options.catalogs.providers.some((item) => item.id === initial.providerId) && <option value={initial.providerId}>{initial.providerName} (diarsipkan)</option>}
        {options.catalogs.providers.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
        <label className="field"><span>Jaringan kartu</span><select value={networkId} onChange={(event) => setNetworkId(event.target.value)}><option value="">Tidak ada</option>
        {initial?.paymentNetworkId && !options.catalogs.paymentNetworks.some((item) => item.id === initial.paymentNetworkId) && <option value={initial.paymentNetworkId}>{"Jaringan tersimpan"} (diarsipkan)</option>}
        {options.catalogs.paymentNetworks.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label></div>
      <div className="finance-checks"><label><input type="checkbox" checked={liquid} onChange={(event) => { setLiquid(event.target.checked); if (!event.target.checked) setSpendable(false); }} /> Dana likuid</label>
        <label><input type="checkbox" checked={spendable} disabled={!liquid} onChange={(event) => setSpendable(event.target.checked)} /> Dapat digunakan</label></div>
      <div className="field-grid"><label className="field"><span>4 digit/karakter terakhir (opsional)</span><input maxLength={4} value={suffix} onChange={(event) => setSuffix(event.target.value)} /><small>Untuk membedakan rekening atau kartu tanpa menyimpan nomor lengkap. Kosongkan untuk uang tunai.</small></label>
        <label className="field"><span>Catatan</span><textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opsional" /></label></div>
      {error && <p role="alert" className="finance-error">{error}</p>}
      {confirmArchive && <div className="finance-confirm"><p>Arsipkan aset ini? Riwayat dan saldonya tetap tersimpan, tetapi aset tidak tersedia untuk transaksi baru. Anda dapat memulihkannya nanti.</p>
        <button type="button" className="finance-danger" onClick={archive} disabled={pending} aria-busy={pending && operation === "archive"}>{pending && operation === "archive" ? <LoadingIndicator>Mengarsipkan…</LoadingIndicator> : "Ya, arsipkan"}</button>
        <button type="button" className="finance-secondary" onClick={() => setConfirmArchive(false)}>Batal</button></div>}
      <div className="finance-actions">{initial && !confirmArchive && <button type="button" className="finance-danger" onClick={() => setConfirmArchive(true)}>Arsipkan</button>}
        <button type="submit" className="button-primary" disabled={pending} aria-busy={pending && operation === "save"}>{pending && operation === "save" ? <LoadingIndicator>{initial ? "Memperbarui…" : "Menyimpan…"}</LoadingIndicator> : "Simpan aset"}</button></div>
    </fieldset></form>}
  </dialog>;
}

function AssetOpeningCorrection({ asset, onClose }: { asset: FinanceAsset; onClose: () => void }) {
  const dialog = useFinanceDialog(onClose);
  const { refresh, notify } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const [history, setHistory] = useState<AssetOpeningHistory | null>(null);
  const correctionSort = useListSort(`assets.${asset.id}.opening-corrections`);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const retry = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    let active = true;
    requestJson<AssetOpeningHistory>(`/api/finance/asset-opening?id=${encodeURIComponent(asset.id)}`, { cache: "no-store" })
      .then((data) => { if (active) { setHistory(data); setAmount(minorToInput(data.effectiveMinor, data.exponent)); setLoading(false); } })
      .catch((cause) => { if (active) { setError(cause instanceof Error ? cause.message : "Riwayat belum dapat dimuat."); setLoading(false); } });
    return () => { active = false; };
  }, [asset.id]);
  let corrected: string | null = null;
  try { if (history) corrected = inputToMinor(amount, history.exponent); } catch { /* Incomplete input while typing. */ }
  const delta = history && corrected !== null ? BigInt(corrected) - BigInt(history.effectiveMinor) : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!history || !begin()) return; setError("");
    try {
      const body = { assetId: asset.id, expectedMinor: history.effectiveMinor, correctedMinor: inputToMinor(amount, history.exponent), note: note.trim() || undefined };
      const payload = JSON.stringify(body);
      if (retry.current?.payload !== payload) retry.current = { payload, key: crypto.randomUUID() };
      await financeRequest("asset-opening-correct", { ...body, idempotencyKey: retry.current.key });
      refresh(); notify("Saldo awal berhasil dikoreksi."); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Koreksi belum dapat disimpan."); }
    finally { finish(); }
  }
  return <dialog ref={dialog} className="finance-dialog" aria-labelledby="asset-opening-title" onCancel={(event) => { if (pending) event.preventDefault(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">REKONSILIASI ASET</span><h2 id="asset-opening-title">Koreksi saldo awal</h2></div><button type="button" className="icon-button" aria-label="Tutup" disabled={pending} onClick={() => dialog.current?.close()}><X size={20} /></button></div>
    <p className="finance-hint">Perbaiki saldo saat aset pertama dicatat. Transaksi yang sudah ada tetap utuh.</p>
    {!asset.isActive && <p className="finance-hint">Aset diarsipkan. Pulihkan aset sebelum membuat koreksi baru; riwayatnya tetap dapat dilihat.</p>}
    {loading ? <LoadingIndicator>Memuat saldo awal...</LoadingIndicator> : history && <form onSubmit={submit} aria-busy={pending}><fieldset className="finance-fieldset" disabled={pending}>
      <dl className="investment-preview"><div><dt>Saldo awal asli</dt><dd>{formatMinor(history.originalMinor, history.currency, history.exponent)}</dd></div><div><dt>Saldo awal saat ini</dt><dd>{formatMinor(history.effectiveMinor, history.currency, history.exponent)}</dd></div></dl>
      {asset.isActive && <>
      <label className="field"><span>Saldo awal yang benar ({history.currency})</span><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      {delta !== null && <p className="finance-hint">Perubahan saldo awal: {delta > 0n ? "+" : ""}{formatMinor(delta, history.currency, history.exponent)}. Saldo saat ini ikut berubah sebesar ini.</p>}
      <label className="field"><span>Alasan koreksi (opsional)</span><textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </>}
      {history.corrections.length > 0 && <details className="investment-price-history"><summary>Riwayat koreksi ({history.corrections.length})</summary><ListSortControl {...correctionSort} /><div className="investment-opening-history">{sortTemporal(history.corrections, correctionSort.direction, item => item.createdAt, item => item.id).map((item) => <article className="investment-correction-entry" key={item.id}><small>{new Date(item.createdAt).toLocaleString("id-ID")}</small><p><strong>Saldo awal:</strong> {formatMinor(item.previousMinor, history.currency, history.exponent)} → {formatMinor(item.correctedMinor, history.currency, history.exponent)}</p>{item.note && <p className="investment-correction-note">Alasan: {item.note}</p>}</article>)}</div></details>}
      {error && <p role="alert" className="finance-error">{error}</p>}
      <div className="finance-actions"><button type="button" className="finance-secondary" onClick={() => dialog.current?.close()}>Tutup</button>{asset.isActive && <button type="submit" className="button-primary" disabled={pending || corrected === null || corrected === history.effectiveMinor} aria-busy={pending}>{pending ? <LoadingIndicator>Menyimpan koreksi...</LoadingIndicator> : "Simpan koreksi"}</button>}</div>
    </fieldset></form>}
    {!loading && !history && <p role="alert" className="finance-error">{error}</p>}
  </dialog>;
}

export function AssetsManager({ assets, totals, investmentTotals }: { assets: FinanceAsset[]; totals: { currency: string; exponent: number; amountMinor: string; unpricedCount: number }[]; investmentTotals: InvestmentTotal[] }) {
  const mobile = useMobileViewport();
  const [editing, setEditing] = useState<FinanceAsset | "new" | null>(null);
  const [correcting, setCorrecting] = useState<FinanceAsset | null>(null);
  const { pending, begin, finish } = useMutationPending();
  const { refresh, notify, refreshing } = useFinanceFeedback();
  const [restoringId, setRestoringId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  async function restore(id: string) {
    if (refreshing || !begin()) return; setRestoringId(id); setError("");
    try { await financeRequest("asset-restore", { id }); refresh(); notify("Aset berhasil dipulihkan."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Aset belum dapat dipulihkan."); }
    finally { finish(); }
  }
  const openNewAsset = () => setEditing("new");
  const active = assets.filter((item) => item.isActive);
  const archived = assets.filter((item) => !item.isActive);
  return <div className="page finance-assets-page"><div className="page-heading finance-heading"><div><span className="eyebrow">POSISI KEUANGAN</span><h1>Assets</h1>
    </div><div className="page-heading-actions"><ExportMenuButton dataset="assets" label="Ekspor Aset" /><button className="button-primary" type="button" onClick={openNewAsset}><Plus size={17} /> Tambah aset</button></div></div>
    <div className="asset-overview-grid">{!!totals.length && <section className="asset-total finance-asset-total"><div className="finance-total-heading"><span className="finance-total-icon"><Bank size={17} weight="bold" /></span><span>Total aset tercatat</span></div>
      {totals.map((item) => <strong className="financial-value financial-value--summary" key={item.currency}>{formatMinor(item.amountMinor, item.currency, item.exponent)}</strong>)}
      </section>}
    <InvestmentSummary totals={investmentTotals} /></div>
    {!active.length ? <section className="surface finance-empty"><h2>{archived.length ? "Tidak ada aset aktif" : "Belum ada aset"}</h2><p>{archived.length ? "Tampilkan yang diarsipkan untuk memulihkan aset, atau tambahkan aset baru." : "Buat akun atau aset pertama, lalu catat saldo awalnya."}</p>
      <button className="button-primary" type="button" onClick={openNewAsset}>Tambah aset</button></section> : <section className="surface"><SectionHeading title="Akun & nilai tercatat" eyebrow="ASET AKTIF" action={<div className="section-heading-actions"><span className="count-pill">{active.length} aset</span><ExportMenuButton dataset="assets" label="Ekspor Aset" /></div>} />
      <div className="asset-list">{active.map((asset) => {
        const mark = resolveProviderMark(asset.providerName, asset.displayName, asset.normallySpendable ? "blue" : asset.normallyLiquid ? "cyan" : "violet");
        return <article className="asset-row data-list-row data-list-row--entity" key={asset.id}>
        <div className="data-list-identity"><span className="finance-asset-mark" data-tone={mark.tone}>{mark.monogram}</span>
          <div className="asset-copy"><strong>{asset.displayName}</strong><span>{[asset.providerName, asset.assetTypeName, asset.safeSuffix ? `•••• ${asset.safeSuffix}` : null].filter(Boolean).join(" · ")}</span>
            {!mobile && asset.assetGroupName && <small>{asset.assetGroupName}</small>}</div></div>
        <div className="data-list-management"><strong className="asset-amount financial-value financial-value--entity">{formatMinor(asset.balanceMinor, asset.currency, asset.exponent)}</strong>
        <div className="data-list-actions"><button type="button" className="row-action" onClick={() => setEditing(asset)}><PencilSimple size={14} weight="bold" /> Ubah</button><button type="button" className="row-action" onClick={() => setCorrecting(asset)}>Koreksi saldo awal</button></div></div></article>;
      })}</div></section>}
    {archived.length > 0 && <><label className="finance-history-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Tampilkan yang diarsipkan ({archived.length})</label>
      {showArchived && <section className="surface finance-archived"><SectionHeading title="Aset diarsipkan" />
      <div className="asset-list">{archived.map((asset) => {
        const mark = resolveProviderMark(asset.providerName, asset.displayName, asset.normallySpendable ? "blue" : asset.normallyLiquid ? "cyan" : "violet");
        return <div className="asset-row data-list-row data-list-row--entity" key={asset.id}><div className="data-list-identity"><span className="finance-asset-mark" data-tone={mark.tone}>{mark.monogram}</span><div className="asset-copy"><strong>{asset.displayName}</strong><small>Diarsipkan</small></div></div><div className="data-list-management"><strong className="asset-amount financial-value financial-value--entity">{formatMinor(asset.balanceMinor, asset.currency, asset.exponent)}</strong><div className="data-list-actions"><button type="button" className="row-action" onClick={() => setCorrecting(asset)}>Riwayat saldo awal</button><button type="button" className="row-action" disabled={pending || refreshing} aria-busy={pending && restoringId === asset.id} onClick={() => void restore(asset.id)}>{pending && restoringId === asset.id ? <LoadingIndicator>Memulihkan...</LoadingIndicator> : "Pulihkan"}</button></div></div></div>;
      })}</div><details className="context-help"><summary>Tentang aset diarsipkan</summary><p className="finance-hint supporting-prose">Saldo awal dan riwayat tetap tersimpan. Aset tidak dihapus permanen; pulihkan untuk menggunakannya kembali.</p></details></section>}</>}
    {error && <p className="finance-error" role="alert">{error}</p>}
    <details className="context-help"><summary>Cara membaca aset</summary><p className="finance-hint supporting-prose supporting-prose--section">Saldo berasal dari saldo awal dan seluruh pergerakan yang tercatat. Total aset menjumlahkan saldo akun dan investasi berharga sekali per mata uang. Akun termasuk kas broker; catat unit instrumen di Investasi agar kepemilikan tidak dihitung dua kali. Posisi tanpa harga belum masuk total aset.</p></details>
    {editing && <AssetForm key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    {correcting && <AssetOpeningCorrection key={correcting.id} asset={correcting} onClose={() => setCorrecting(null)} />}
  </div>;
}
