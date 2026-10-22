"use client";

import { useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { OptionalChargesEditor, type ChargeEditorRow } from "./optional-charges-editor";
import { OptionalFormSection } from "./optional-form-section";
import { financeRequest, requestJson } from "@/lib/finance/client";
import { FinanceOptionsStatus, useFinanceDialog, useFinanceOptions } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import {
  creditBillMinor,
  isCreditAsset,
  nextMonthlyDueDayIso,
  parseCreditMeta,
  splitInstallmentMinor,
} from "@/lib/domain/credit";
import type { ActivityDraft, ActivityKind, FinanceActivity, FinanceAsset } from "@/lib/finance/types";

function localDate(iso?: string) {
  const date = iso ? new Date(iso) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formatAssetOptionLabel(item: FinanceAsset) {
  if (isCreditAsset(item)) {
    const bill = creditBillMinor(item.balanceMinor);
    return `${item.displayName} (Kredit/PayLater · Tagihan ${formatMinor(bill.toString(), item.currency, item.exponent)})`;
  }
  return `${item.displayName} · ${formatMinor(item.balanceMinor, item.currency, item.exponent)}`;
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
  const [tenorMonths, setTenorMonths] = useState<number>(1);
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

  const isCreditPurchase = !initial && kind === "expense" && Boolean(account && isCreditAsset(account));
  const creditMeta = parseCreditMeta(account?.note);
  const dueDay = creditMeta.dueDay ?? 25;

  let installmentPreview: { firstMonthMinor: string; futureInstallmentsMinor: string[] } | null = null;
  if (isCreditPurchase && tenorMonths > 1 && amount.trim()) {
    try {
      installmentPreview = splitInstallmentMinor(inputToMinor(amount, exponent), tenorMonths);
    } catch {
      installmentPreview = null;
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!begin()) return; setError("");
    try {
      if (!account) throw new Error("Buat aset terlebih dahulu.");
      if (kind === "transfer" && !destination) throw new Error("Pilih dua aset aktif dengan mata uang yang sama.");
      const rawTotalMinor = inputToMinor(amount, exponent);
      const split = isCreditPurchase && tenorMonths > 1
        ? splitInstallmentMinor(rawTotalMinor, tenorMonths)
        : { firstMonthMinor: rawTotalMinor, futureInstallmentsMinor: [] };

      const effectiveNote =
        isCreditPurchase && tenorMonths > 1
          ? `${note.trim() || account.displayName} (Cicilan 1/${tenorMonths})`
          : note;

      const draft: ActivityDraft = {
        kind, amountMinor: split.firstMonthMinor, occurredAt: new Date(occurredAt).toISOString(), note: effectiveNote,
        ...(kind === "income" ? { destinationAssetId: account.id } : { sourceAssetId: account.id }),
        ...(kind === "transfer" ? { destinationAssetId: destination!.id,
          transferFeeMinor: feeEnabled && fee.trim() ? inputToMinor(fee, exponent) : undefined } : {}),
        ...(kind !== "transfer" ? { categoryId: categoryId || undefined } : {}),
        ...(kind === "expense" ? { charges: (chargesEnabled ? charges : []).map((charge) => ({
          typeId: charge.typeId, amountMinor: inputToMinor(charge.amount, exponent),
        })) } : {}),
      };
      const payload = JSON.stringify({ id: initial?.id, draft, tenorMonths: isCreditPurchase ? tenorMonths : 1 });
      if (replay.current?.payload !== payload) replay.current = { payload, key: crypto.randomUUID() };
      await financeRequest(initial ? "replace" : "post", { id: initial?.id, draft, idempotencyKey: replay.current.key });

      if (isCreditPurchase && split.futureInstallmentsMinor.length > 0) {
        const labelBase = note.trim() || categories.find((c) => c.id === categoryId)?.displayName || account.displayName;
        const installments = split.futureInstallmentsMinor.map((amt, idx) => ({
          title: `Cicilan ${idx + 2}/${tenorMonths} · ${account.displayName} (${labelBase})`.slice(0, 120),
          amountMinor: amt,
          dueOn: nextMonthlyDueDayIso(dueDay, idx + 1),
          note: `Cicilan otomatis dari transaksi ${account.displayName} sebesar ${formatMinor(rawTotalMinor, currency, exponent)}`,
        }));
        await requestJson("/api/planning", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save-installments",
            title: `Cicilan ${account.displayName}`,
            currency,
            installments,
            idempotencyKey: crypto.randomUUID(),
          }),
          cache: "no-store",
        });
      }

      refresh();
      notify(
        initial
          ? "Transaksi berhasil dikoreksi."
          : isCreditPurchase && tenorMonths > 1
            ? `Cicilan 1/${tenorMonths} masuk tagihan bulan ini & ${tenorMonths - 1} cicilan berikutnya dijadwalkan di Kewajiban.`
            : "Transaksi berhasil dicatat.",
      );
      onClose();
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
        onChange={(event) => setAccountId(event.target.value)}><option value="">Pilih aset aktif</option>{active.map((item) => <option key={item.id} value={item.id}>{formatAssetOptionLabel(item)}</option>)}</select></label>

      {isCreditPurchase && (
        <div className="credit-payment-scheme">
          <label className="field">
            <span>Skema tagihan Kredit / PayLater</span>
            <select
              value={tenorMonths}
              onChange={(event) => setTenorMonths(Number(event.target.value))}
            >
              <option value={1}>Bayar penuh akhir bulan (1x bayar)</option>
              <option value={2}>Cicilan 2 bulan (2x)</option>
              <option value={3}>Cicilan 3 bulan (3x)</option>
              <option value={6}>Cicilan 6 bulan (6x)</option>
              <option value={12}>Cicilan 12 bulan (12x)</option>
              <option value={24}>Cicilan 24 bulan (24x)</option>
            </select>
          </label>
          {tenorMonths === 1 ? (
            <small className="finance-hint">
              Menambah tagihan berjalan <strong>{account?.displayName}</strong> bulan ini (jatuh tempo tgl {dueDay}) dan memotong KPI <strong>Setelah kewajiban</strong> di Home.
            </small>
          ) : installmentPreview ? (
            <small className="finance-hint">
              Tagihan bulan ini: <strong>{formatMinor(installmentPreview.firstMonthMinor, currency, exponent)}</strong> (1/{tenorMonths}). Sisa <strong>{tenorMonths - 1}x cicilan</strong> (@ {formatMinor(installmentPreview.futureInstallmentsMinor[0] ?? "0", currency, exponent)}) otomatis dijadwalkan ke <strong>Planning → Kewajiban</strong> tiap tgl {dueDay}.
            </small>
          ) : (
            <small className="finance-hint">
              Cicilan bulan pertama masuk ke tagihan berjalan bulan ini, dan sisa bulannya otomatis dijadwalkan ke menu Kewajiban.
            </small>
          )}
        </div>
      )}

      {kind === "transfer" && <><label className="field"><span>Aset tujuan</span><select required value={destination?.id ?? ""}
        onChange={(event) => setDestinationId(event.target.value)}><option value="">Pilih aset tujuan</option>{destinationOptions.map((item) => <option key={item.id} value={item.id}>{formatAssetOptionLabel(item)}</option>)}</select></label>
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
