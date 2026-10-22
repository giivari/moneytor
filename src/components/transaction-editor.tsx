"use client";

import { useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { OptionalChargesEditor, type ChargeEditorRow } from "./optional-charges-editor";
import { OptionalFormSection } from "./optional-form-section";
import { financeRequest } from "@/lib/finance/client";
import { FinanceOptionsStatus, useFinanceDialog, useFinanceOptions } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import type { ActivityDraft, ActivityKind, FinanceActivity } from "@/lib/finance/types";

function localDate(iso?: string) {
  const date = iso ? new Date(iso) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function TransactionEditor({ onClose, initial }: { onClose: () => void; initial?: FinanceActivity }) {
  const { refresh, notify } = useFinanceFeedback();
  const dialog = useFinanceDialog(onClose);
  const replay = useRef<{ payload: string; key: string } | null>(null);
  const { options, optionsError, retry } = useFinanceOptions();
  const [error, setError] = useState("");
  const { pending, begin, finish } = useMutationPending();
  const [kind, setKind] = useState<ActivityKind>(initial?.kind ?? "expense");
  const [amount, setAmount] = useState(initial ? minorToInput(initial.baseAmountMinor, initial.exponent) : "");
  const [accountId, setAccountId] = useState(initial?.sourceAssetId ?? initial?.destinationAssetId ?? "");
  const [destinationId, setDestinationId] = useState(initial?.destinationAssetId ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [occurredAt, setOccurredAt] = useState(localDate(initial?.occurredAt));
  const [note, setNote] = useState(initial?.note ?? "");
  const [charges, setCharges] = useState<ChargeEditorRow[]>(
    initial?.kind === "expense" ? initial.charges.map((charge) => ({
      id: charge.id, typeId: charge.typeId, amount: minorToInput(charge.amountMinor, initial.exponent),
    })) : []);
  const [fee, setFee] = useState(initial?.kind === "transfer" && initial.charges[0]
    ? minorToInput(initial.charges[0].amountMinor, initial.exponent) : "");
  const [chargesEnabled, setChargesEnabled] = useState(initial?.kind === "expense" && initial.charges.length > 0);
  const [feeEnabled, setFeeEnabled] = useState(initial?.kind === "transfer" && initial.charges.length > 0);

  const active = options?.assets ?? [];
  const account = accountId ? active.find((item) => item.id === accountId) : active[0];
  const currency = account?.currency ?? "IDR";
  const exponent = account?.exponent ?? 0;
  const destinationOptions = active.filter((item) => item.id !== account?.id && item.currency === currency);
  const destination = destinationId ? destinationOptions.find((item) => item.id === destinationId) : destinationOptions[0];
  const categories = options?.catalogs.transactionCategories.filter((item) => item.appliesTo === kind) ?? [];
  const chargeTypes = options?.catalogs.chargeTypes.filter((item) => item.systemKey !== "transfer_fee") ?? [];

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!begin()) return; setError("");
    try {
      if (!account) throw new Error("Buat aset terlebih dahulu.");
      if (kind === "transfer" && !destination) throw new Error("Pilih dua aset aktif dengan mata uang yang sama.");
      const draft: ActivityDraft = {
        kind, amountMinor: inputToMinor(amount, exponent), occurredAt: new Date(occurredAt).toISOString(), note,
        ...(kind === "income" ? { destinationAssetId: account.id } : { sourceAssetId: account.id }),
        ...(kind === "transfer" ? { destinationAssetId: destination!.id,
          transferFeeMinor: feeEnabled && fee.trim() ? inputToMinor(fee, exponent) : undefined } : {}),
        ...(kind !== "transfer" ? { categoryId: categoryId || undefined } : {}),
        ...(kind === "expense" ? { charges: (chargesEnabled ? charges : []).map((charge) => ({
          typeId: charge.typeId, amountMinor: inputToMinor(charge.amount, exponent),
        })) } : {}),
      };
      const payload = JSON.stringify({ id: initial?.id, draft });
      if (replay.current?.payload !== payload) replay.current = { payload, key: crypto.randomUUID() };
      await financeRequest(initial ? "replace" : "post", { id: initial?.id, draft, idempotencyKey: replay.current.key });
      refresh(); notify(initial ? "Transaksi berhasil dikoreksi." : "Transaksi berhasil dicatat."); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Transaksi gagal disimpan."); }
    finally { finish(); }
  }

  return <dialog ref={dialog} className="finance-dialog transaction-dialog" aria-labelledby="transaction-editor-title"
    onCancel={(event) => { if (pending) event.preventDefault(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">CATAT PERGERAKAN</span><h2 id="transaction-editor-title">{initial ? "Koreksi transaksi" : "Transaksi baru"}</h2></div>
      <button className="icon-button" type="button" onClick={() => dialog.current?.close()} aria-label="Tutup" disabled={pending}><X size={20} /></button></div>
    {initial && <p className="finance-hint">Koreksi membalik catatan lama dan menyimpan penggantinya. Riwayat lama tetap tersedia.</p>}
    {!options ? <FinanceOptionsStatus error={optionsError} retry={retry} /> : <form onSubmit={save} aria-busy={pending}><fieldset className="finance-fieldset" disabled={pending}>
      {!active.length && <p className="finance-hint">Buat aset di halaman Assets sebelum mencatat transaksi.</p>}
      <div className="field"><span>Jenis transaksi</span><div className="segmented" role="group" aria-label="Jenis transaksi">
        {(["expense", "income", "transfer"] as const).map((item) => <button type="button" key={item} className={kind === item ? "selected" : ""}
          onClick={() => { setKind(item); setCategoryId(""); }}>{item === "expense" ? "Pengeluaran" : item === "income" ? "Pemasukan" : "Transfer"}</button>)}
      </div></div>
      <label className="field transaction-amount-field"><span>Jumlah ({currency})</span><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></label>
      <label className="field"><span>{kind === "income" ? "Aset penerima" : "Aset sumber"}</span><select required value={account?.id ?? ""}
        onChange={(event) => setAccountId(event.target.value)}><option value="">Pilih aset aktif</option>{active.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {formatMinor(item.balanceMinor, item.currency, item.exponent)}</option>)}</select></label>
      {kind === "transfer" && <><label className="field"><span>Aset tujuan</span><select required value={destination?.id ?? ""}
        onChange={(event) => setDestinationId(event.target.value)}><option value="">Pilih aset tujuan</option>{destinationOptions.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {formatMinor(item.balanceMinor, item.currency, item.exponent)}</option>)}</select></label>
        <OptionalFormSection label="Ada biaya transfer" enabled={feeEnabled} onChange={setFeeEnabled}>
          <label className="field"><span>Biaya transfer ({currency})</span><input inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} placeholder="0" /></label>
        </OptionalFormSection></>}
      {kind !== "transfer" && <label className="field"><span>Kategori (opsional)</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
        <option value="">Tanpa kategori</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>}
      {kind === "expense" && <OptionalChargesEditor enabled={chargesEnabled} onEnabledChange={setChargesEnabled}
        rows={charges} onChange={setCharges} chargeTypes={chargeTypes} maxRows={20} />}
      <details className="transaction-optional" open={Boolean(initial) || undefined}><summary>Waktu & catatan <span>opsional</span></summary>
        <div className="field-grid"><label className="field"><span>Waktu</span><input required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
          <label className="field"><span>Catatan</span><textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Tambahkan keterangan bila perlu" /></label></div>
      </details>
      {error && <p className="finance-error" role="alert">{error}</p>}
      <div className="finance-actions"><button type="button" className="finance-secondary" onClick={() => dialog.current?.close()} disabled={pending}>Batal</button>
        <button type="submit" className="button-primary" disabled={pending || !active.length} aria-busy={pending}>{pending ? <LoadingIndicator>{initial ? "Memperbarui…" : "Menyimpan…"}</LoadingIndicator> : initial ? "Simpan koreksi" : "Simpan transaksi"}</button></div>
    </fieldset></form>}
  </dialog>;
}
