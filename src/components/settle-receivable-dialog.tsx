"use client";

import { useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { CompactChoice } from "./compact-choice";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { useFinanceDialog, useFinanceOptions } from "./finance-form-hooks";
import { LoadingIndicator } from "./loading-indicator";
import { isCreditAsset, isReceivableAsset } from "@/lib/domain/credit";
import { planReceivableSettlement, type SettlementMode } from "@/lib/domain/receivable-settlement";
import { financeRequest } from "@/lib/finance/client";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import type { FinanceAsset } from "@/lib/finance/types";

const MODE_OPTIONS = [
  { value: "partial", label: "Bayar sebagian (sisa tetap di piutang)" },
  { value: "close_with_adjustment", label: "Tutup lunas (selisih dicatat sebagai pengeluaran/pembulatan)" },
] as const satisfies readonly { value: SettlementMode; label: string }[];

/** Terima pelunasan piutang/talangan: pilih rekening tujuan bebas, nominal diterima, dan cara menangani selisih pembulatan. */
export function SettleReceivableDialog({ receivableAssetId, assets, onClose }: {
  receivableAssetId: string; assets?: FinanceAsset[]; onClose: () => void;
}) {
  const { options, optionsError } = useFinanceOptions();
  const all = assets ?? options?.assets;
  const receivable = all?.find((item) => item.id === receivableAssetId);
  return receivable
    ? <SettleForm receivable={receivable} assets={all ?? []} onClose={onClose} />
    : <SettleShell title="Terima pelunasan" onClose={onClose}>
        {() => optionsError ? <p className="finance-error" role="alert">{optionsError}</p> : <LoadingIndicator>Memuat akun…</LoadingIndicator>}
      </SettleShell>;
}

function SettleShell({ title, onClose, pending = false, children }: { title: string; onClose: () => void; pending?: boolean; children: (close: () => void) => React.ReactNode }) {
  const dialog = useFinanceDialog(onClose);
  return (
    <dialog ref={dialog} className="finance-dialog" aria-labelledby="settle-receivable-title" onCancel={(event) => { if (pending) event.preventDefault(); }}>
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">PELUNASAN PIUTANG &amp; TALANGAN</span>
          <h2 id="settle-receivable-title">{title}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Tutup" disabled={pending} onClick={() => dialog.current?.close()}><X size={20} /></button>
      </div>
      {children(() => dialog.current?.close())}
    </dialog>
  );
}

function SettleForm({ receivable, assets, onClose }: { receivable: FinanceAsset; assets: FinanceAsset[]; onClose: () => void }) {
  const { refresh, notify } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const replay = useRef<{ payload: string; key: string; at: string } | null>(null);
  const destinations = assets.filter((item) => item.isActive && item.id !== receivable.id && item.currency === receivable.currency
    && !isCreditAsset(item) && !isReceivableAsset(item));
  const remainingMinor = BigInt(receivable.balanceMinor);
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? "");
  const [amount, setAmount] = useState(remainingMinor > 0n ? minorToInput(remainingMinor.toString(), receivable.exponent) : "");
  const [mode, setMode] = useState<SettlementMode>("partial");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const money = (value: bigint) => formatMinor(value.toString(), receivable.currency, receivable.exponent);

  let receivedMinor: bigint | null = null;
  try { receivedMinor = amount.trim() ? BigInt(inputToMinor(amount, receivable.exponent)) : null; } catch { receivedMinor = null; }
  const differs = receivedMinor !== null && receivedMinor > 0n && receivedMinor !== remainingMinor;
  const plan = receivedMinor !== null && receivedMinor > 0n && remainingMinor > 0n
    ? planReceivableSettlement({ remainingMinor, receivedMinor, mode }) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!begin()) return;
    setError("");
    try {
      if (!destinationId) throw new Error("Pilih rekening tujuan penerimaan.");
      if (receivedMinor === null || receivedMinor <= 0n) throw new Error("Nominal diterima harus lebih dari nol.");
      const body = { receivableAssetId: receivable.id, destinationAssetId: destinationId, receivedAmountMinor: receivedMinor.toString(),
        settlementMode: mode, note: note.trim() };
      const payload = JSON.stringify(body);
      if (replay.current?.payload !== payload) replay.current = { payload, key: crypto.randomUUID(), at: new Date().toISOString() };
      await financeRequest("settle-receivable", { ...body, occurredAt: replay.current.at, idempotencyKey: replay.current.key });
      refresh();
      notify(`Pelunasan ${receivable.displayName} berhasil dicatat.`);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pelunasan gagal disimpan.");
    } finally {
      finish();
    }
  }

  return (
    <SettleShell title={`Terima pelunasan ${receivable.displayName}`} onClose={onClose} pending={pending}>
      {(close) => remainingMinor <= 0n ? (
        <p className="finance-error" role="alert">Piutang ini tidak memiliki sisa saldo untuk dilunasi.</p>
      ) : !destinations.length ? (
        <p className="finance-error" role="alert">Belum ada rekening aktif dalam mata uang {receivable.currency} untuk menerima pelunasan ini.</p>
      ) : (
        <form onSubmit={submit} aria-busy={pending}>
          <fieldset className="finance-fieldset" disabled={pending}>
            <dl className="investment-preview">
              <div><dt>Sisa piutang</dt><dd className="pnl-positive">{money(remainingMinor)}</dd></div>
            </dl>
            <label className="field">
              <span>Masuk ke rekening ({receivable.currency})</span>
              <select required value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
                {destinations.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {formatMinor(item.balanceMinor, item.currency, item.exponent)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Nominal diterima ({receivable.currency})</span>
              <input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
            </label>
            {differs && receivedMinor !== null && receivedMinor > remainingMinor && (
              <p className="finance-hint" role="status">
                Piutang dilunasi penuh dan selisih +{money(receivedMinor - remainingMinor)} dicatat sebagai pemasukan pembulatan.
              </p>
            )}
            {differs && receivedMinor !== null && receivedMinor < remainingMinor && (
              <>
                <CompactChoice label="Penanganan selisih" value={mode} options={MODE_OPTIONS} onChange={setMode} required />
                {plan && <p className="finance-hint" role="status">
                  {plan.outcome === "partial"
                    ? `Sisa ${money(plan.remainingAfterMinor)} tetap tercatat di piutang.`
                    : `Selisih ${money(remainingMinor - receivedMinor)} dicatat sebagai pengeluaran pembulatan; piutang menjadi lunas.`}
                </p>}
              </>
            )}
            <label className="field">
              <span>Catatan (opsional)</span>
              <input maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} placeholder={`Pelunasan piutang · ${receivable.displayName}`} />
            </label>
            {error && <p role="alert" className="finance-error">{error}</p>}
            <div className="finance-actions">
              <button type="button" className="finance-secondary" onClick={close}>Batal</button>
              <button type="submit" className="button-primary" disabled={pending} aria-busy={pending}>
                {pending ? <LoadingIndicator>Memproses pelunasan…</LoadingIndicator> : "Terima Pelunasan"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </SettleShell>
  );
}
