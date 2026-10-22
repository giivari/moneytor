"use client";

import { sortTemporal } from "@/lib/list-order";
import { useListSort } from "./use-list-sort";
import { ListSortControl } from "./list-sort-control";

import { useEffect, useRef, useState } from "react";
import { Bank, CheckCircle, PencilSimple, Plus, X } from "@phosphor-icons/react";
import { resolveProviderMark } from "@/lib/domain/provider-marks";
import {
  computeCreditBills,
  encodeCreditNote,
  formatShortDueIso,
  isCreditAsset,
  nextMonthlyDueDayIso,
  parseCreditMeta,
} from "@/lib/domain/credit";
import { ProviderBrandMark } from "./provider-brand-mark";
import { financeRequest, requestJson } from "@/lib/finance/client";
import { ExportMenuButton } from "./export-menu-button";
import { FinanceOptionsStatus, useFinanceDialog, useFinanceOptions } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import type { AssetOpeningHistory } from "@/lib/repositories/assets";
import type { ActivityDraft, FinanceAsset } from "@/lib/finance/types";
import type { InvestmentTotal } from "@/lib/investments/types";
import { SectionHeading } from "./section-heading";
import { InvestmentSummary } from "./investment-summary";
import { useMobileViewport } from "./use-mobile-viewport";

function AssetForm({
  initial,
  onClose,
}: {
  initial?: FinanceAsset;
  onClose: () => void;
}) {
  const { refresh, notify } = useFinanceFeedback();
  const dialog = useFinanceDialog(onClose);
  const { options, optionsError, retry } = useFinanceOptions();
  const [error, setError] = useState("");
  const { pending, begin, finish } = useMutationPending();
  const [operation, setOperation] = useState<"save" | "archive">("save");
  const [confirmArchive, setConfirmArchive] = useState(false);

  const initialMeta = parseCreditMeta(initial?.note);
  const initialBills = initial ? computeCreditBills(initial) : null;
  const [isCredit, setIsCredit] = useState<boolean>(
    initial ? isCreditAsset(initial) : false,
  );
  const [dueDay, setDueDay] = useState<string>(
    initial ? String(initialMeta.dueDay) : "1",
  );
  const [cutoffDay, setCutoffDay] = useState<string>(
    initial ? String(initialMeta.cutoffDay) : "20",
  );
  const [creditLimit, setCreditLimit] = useState<string>(
    initial && initialMeta.limitMinor > 0n
      ? minorToInput(initialMeta.limitMinor.toString(), initial.exponent)
      : "",
  );
  const [currentBillInput, setCurrentBillInput] = useState<string>(
    initialBills && initialBills.currentBillMinor > 0n
      ? minorToInput(initialBills.currentBillMinor.toString(), initial!.exponent)
      : "",
  );
  const [nextBillInput, setNextBillInput] = useState<string>(
    initialBills && initialBills.nextBillMinor > 0n
      ? minorToInput(initialBills.nextBillMinor.toString(), initial!.exponent)
      : "",
  );

  const [name, setName] = useState(initial?.displayName ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? "IDR");
  const [opening, setOpening] = useState("");
  const [typeId, setTypeId] = useState(initial?.assetTypeId ?? "");
  const [groupId, setGroupId] = useState(initial?.assetGroupId ?? "");
  const [providerId, setProviderId] = useState(initial?.providerId ?? "");
  const [networkId, setNetworkId] = useState(initial?.paymentNetworkId ?? "");
  const [liquid, setLiquid] = useState(initial?.normallyLiquid ?? true);
  const [spendable, setSpendable] = useState(initial?.normallySpendable ?? true);
  const [suffix, setSuffix] = useState(initial?.safeSuffix ?? "");
  const [note, setNote] = useState(initialMeta.cleanNote);
  const exponent = options?.currencies.find((item) => item.code === currency)?.exponent ?? 0;

  const parsedDueNum = Number(dueDay) >= 1 && Number(dueDay) <= 31 ? Number(dueDay) : 1;
  const previewCurrentDue = formatShortDueIso(nextMonthlyDueDayIso(parsedDueNum, 0));
  const previewNextDue = formatShortDueIso(nextMonthlyDueDayIso(parsedDueNum, 1));

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!begin()) return;
    setError("");
    setOperation("save");
    try {
      const parsedDue = dueDay.trim() ? Number(dueDay.trim()) : 1;
      const parsedCutoff = cutoffDay.trim() ? Number(cutoffDay.trim()) : 20;
      const limitMinor = creditLimit.trim()
        ? BigInt(inputToMinor(creditLimit.trim(), exponent))
        : 0n;
      const desiredCurrentMinor = currentBillInput.trim()
        ? BigInt(inputToMinor(currentBillInput.trim(), exponent))
        : 0n;
      const desiredNextMinor = nextBillInput.trim()
        ? BigInt(inputToMinor(nextBillInput.trim(), exponent))
        : 0n;
      const existingBalance = initial ? BigInt(initial.balanceMinor) : 0n;

      // Ensure computeCreditBills returns exact desiredCurrentMinor and desiredNextMinor
      const carryCurrentMinor = desiredCurrentMinor + existingBalance;
      const carryNextMinor = desiredNextMinor;

      const encodedNote = encodeCreditNote(note, isCredit, {
        dueDay: parsedDue,
        cutoffDay: parsedCutoff,
        limitMinor,
        carryCurrentMinor,
        carryNextMinor,
        deferredMinor: 0n,
      });

      const openingMinorStr = initial
        ? undefined
        : isCredit
          ? "0"
          : inputToMinor(opening.trim() || "0", exponent);

      const body = {
        id: initial?.id,
        displayName: name,
        currency,
        openingAmountMinor: openingMinorStr,
        openingEffectiveAt: new Date().toISOString(),
        assetTypeId: typeId || options?.catalogs.assetTypes[0]?.id,
        assetGroupId: groupId || undefined,
        providerId: providerId || undefined,
        paymentNetworkId: networkId || undefined,
        normallyLiquid: isCredit ? false : liquid,
        normallySpendable: isCredit ? false : spendable,
        safeSuffix: suffix || undefined,
        note: encodedNote,
      };
      await financeRequest(initial ? "asset-update" : "asset-create", body);
      refresh();
      notify(
        initial
          ? "Data berhasil diperbarui."
          : isCredit
            ? "Akun Kredit / PayLater berhasil ditambahkan."
            : "Aset berhasil ditambahkan.",
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data gagal disimpan.");
    } finally {
      finish();
    }
  }

  async function archive() {
    if (!initial || !begin()) return;
    setError("");
    setOperation("archive");
    try {
      await financeRequest("asset-archive", { id: initial.id });
      refresh();
      notify("Akun berhasil diarsipkan.");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Akun gagal diarsipkan.");
    } finally {
      finish();
    }
  }

  return (
    <dialog
      ref={dialog}
      className="finance-dialog"
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
      aria-labelledby="asset-form-title"
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">{isCredit ? "FASILITAS KREDIT & PAYLATER" : "ASET TERCATAT"}</span>
          <h2 id="asset-form-title">
            {initial
              ? isCredit
                ? "Ubah Kredit / PayLater"
                : "Ubah aset"
              : isCredit
                ? "Tambah Kredit / PayLater"
                : "Aset baru"}
          </h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => dialog.current?.close()}
          aria-label="Tutup"
          disabled={pending}
        >
          <X size={20} />
        </button>
      </div>
      {!options ? (
        <FinanceOptionsStatus error={optionsError} retry={retry} />
      ) : (
        <form onSubmit={save} aria-busy={pending}>
          <fieldset className="finance-fieldset" disabled={pending}>
            <div className="field">
              <span>Kategori akun</span>
              <div className="segmented" role="group" aria-label="Kategori akun">
                <button
                  type="button"
                  className={!isCredit ? "selected" : ""}
                  onClick={() => setIsCredit(false)}
                >
                  Rekening / Aset
                </button>
                <button
                  type="button"
                  className={isCredit ? "selected" : ""}
                  onClick={() => {
                    setIsCredit(true);
                    setLiquid(false);
                    setSpendable(false);
                  }}
                >
                  Kredit & PayLater
                </button>
              </div>
            </div>

            <label className="field">
              <span>{isCredit ? "Nama PayLater / Kartu Kredit" : "Nama aset"}</span>
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={isCredit ? "Mis. SPayLater, GoPayLater, Kartu Kredit BCA" : "Mis. BNI Taplus Muda"}
              />
            </label>

            {!isCredit && !initial && (
              <div className="field-grid">
                <label className="field">
                  <span>Mata uang</span>
                  <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                    {options.currencies.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Saldo awal (opsional)</span>
                  <input
                    inputMode="decimal"
                    value={opening}
                    onChange={(event) => setOpening(event.target.value)}
                    placeholder="0"
                  />
                </label>
              </div>
            )}

            {isCredit && (
              <>
                <div className="field-grid">
                  {!initial && (
                    <label className="field">
                      <span>Mata uang</span>
                      <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                        {options.currencies.map((item) => (
                          <option key={item.code} value={item.code}>
                            {item.code}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="field">
                    <span>Limit Kredit / PayLater ({currency})</span>
                    <input
                      inputMode="decimal"
                      value={creditLimit}
                      onChange={(event) => setCreditLimit(event.target.value)}
                      placeholder="0"
                    />
                    <small>Opsional. Untuk memantau sisa limit yang masih tersedia.</small>
                  </label>
                </div>

                <div className="field-grid">
                  <label className="field">
                    <span>Batas tgl transaksi / Cutoff (1–31)</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={cutoffDay}
                      onChange={(event) => setCutoffDay(event.target.value)}
                      placeholder="20"
                    />
                    <small>Transaksi di atas tgl ini otomatis masuk ke tagihan bulan berikutnya.</small>
                  </label>
                  <label className="field">
                    <span>Tanggal jatuh tempo bulanan (1–31)</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={dueDay}
                      onChange={(event) => setDueDay(event.target.value)}
                      placeholder="1"
                    />
                    <small>Mis. tgl 1 awal bulan atau tgl 25 akhir bulan.</small>
                  </label>
                </div>

                <div className="field-grid">
                  <label className="field">
                    <span>Tagihan jatuh tempo terdekat ({previewCurrentDue})</span>
                    <input
                      inputMode="decimal"
                      value={currentBillInput}
                      onChange={(event) => setCurrentBillInput(event.target.value)}
                      placeholder="0"
                    />
                    <small>Isi jika sudah ada tagihan berjalan yang jatuh tempo pada {previewCurrentDue}.</small>
                  </label>
                  <label className="field">
                    <span>Tagihan periode berikutnya ({previewNextDue})</span>
                    <input
                      inputMode="decimal"
                      value={nextBillInput}
                      onChange={(event) => setNextBillInput(event.target.value)}
                      placeholder="0"
                    />
                    <small>Isi jika sudah ada tagihan untuk periode bulan depan ({previewNextDue}).</small>
                  </label>
                </div>
              </>
            )}

            <div className="field-grid">
              <label className="field">
                <span>Jenis aset</span>
                <select
                  required
                  value={typeId || options.catalogs.assetTypes[0]?.id || ""}
                  onChange={(event) => setTypeId(event.target.value)}
                >
                  {initial?.assetTypeId &&
                    !options.catalogs.assetTypes.some((item) => item.id === initial.assetTypeId) && (
                      <option value={initial.assetTypeId}>{initial.assetTypeName} (diarsipkan)</option>
                    )}
                  {options.catalogs.assetTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Grup aset</span>
                <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                  <option value="">Tanpa grup</option>
                  {initial?.assetGroupId &&
                    !options.catalogs.assetGroups.some((item) => item.id === initial.assetGroupId) && (
                      <option value={initial.assetGroupId}>{initial.assetGroupName} (diarsipkan)</option>
                    )}
                  {options.catalogs.assetGroups.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>Penyedia</span>
                <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
                  <option value="">Tanpa penyedia</option>
                  {initial?.providerId &&
                    !options.catalogs.providers.some((item) => item.id === initial.providerId) && (
                      <option value={initial.providerId}>{initial.providerName} (diarsipkan)</option>
                    )}
                  {options.catalogs.providers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Jaringan kartu</span>
                <select value={networkId} onChange={(event) => setNetworkId(event.target.value)}>
                  <option value="">Tidak ada</option>
                  {initial?.paymentNetworkId &&
                    !options.catalogs.paymentNetworks.some((item) => item.id === initial.paymentNetworkId) && (
                      <option value={initial.paymentNetworkId}>{"Jaringan tersimpan"} (diarsipkan)</option>
                    )}
                  {options.catalogs.paymentNetworks.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {!isCredit ? (
              <div className="finance-checks">
                <label>
                  <input
                    type="checkbox"
                    checked={liquid}
                    onChange={(event) => {
                      setLiquid(event.target.checked);
                      if (!event.target.checked) setSpendable(false);
                    }}
                  />{" "}
                  Dana likuid
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={spendable}
                    disabled={!liquid}
                    onChange={(event) => setSpendable(event.target.checked)}
                  />{" "}
                  Dapat digunakan
                </label>
              </div>
            ) : (
              <p className="finance-hint">
                Transaksi s.d. tanggal <strong>{cutoffDay || 20}</strong> masuk ke tagihan jatuh tempo terdekat (<strong>{previewCurrentDue}</strong>), sedangkan transaksi di atas tanggal <strong>{cutoffDay || 20}</strong> otomatis masuk ke tagihan periode berikutnya (<strong>{previewNextDue}</strong>).
              </p>
            )}

            <div className="field-grid">
              <label className="field">
                <span>4 digit/karakter terakhir (opsional)</span>
                <input
                  maxLength={4}
                  value={suffix}
                  onChange={(event) => setSuffix(event.target.value)}
                />
                <small>Untuk membedakan rekening atau kartu tanpa menyimpan nomor lengkap.</small>
              </label>
              <label className="field">
                <span>Catatan</span>
                <textarea
                  rows={2}
                  maxLength={850}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Opsional"
                />
              </label>
            </div>

            {error && (
              <p role="alert" className="finance-error">
                {error}
              </p>
            )}
            {confirmArchive && (
              <div className="finance-confirm">
                <p>
                  Arsipkan akun ini? Riwayat dan saldonya tetap tersimpan, tetapi akun tidak tersedia untuk transaksi baru. Anda dapat memulihkannya nanti.
                </p>
                <button
                  type="button"
                  className="finance-danger"
                  onClick={archive}
                  disabled={pending}
                  aria-busy={pending && operation === "archive"}
                >
                  {pending && operation === "archive" ? (
                    <LoadingIndicator>Mengarsipkan…</LoadingIndicator>
                  ) : (
                    "Ya, arsipkan"
                  )}
                </button>
                <button
                  type="button"
                  className="finance-secondary"
                  onClick={() => setConfirmArchive(false)}
                >
                  Batal
                </button>
              </div>
            )}
            <div className="finance-actions">
              {initial && !confirmArchive && (
                <button
                  type="button"
                  className="finance-danger"
                  onClick={() => setConfirmArchive(true)}
                >
                  Arsipkan
                </button>
              )}
              <button
                type="submit"
                className="button-primary"
                disabled={pending}
                aria-busy={pending && operation === "save"}
              >
                {pending && operation === "save" ? (
                  <LoadingIndicator>{initial ? "Memperbarui…" : "Menyimpan…"}</LoadingIndicator>
                ) : isCredit ? (
                  "Simpan Kredit / PayLater"
                ) : (
                  "Simpan aset"
                )}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </dialog>
  );
}

function PayCreditBillDialog({
  creditAsset,
  regularAssets,
  onClose,
}: {
  creditAsset: FinanceAsset;
  regularAssets: FinanceAsset[];
  onClose: () => void;
}) {
  const dialog = useFinanceDialog(onClose);
  const { refresh, notify } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const replay = useRef<{ payload: string; key: string } | null>(null);
  const eligibleSources = regularAssets.filter(
    (item) => item.isActive && item.currency === creditAsset.currency,
  );
  const bills = computeCreditBills(creditAsset);
  const defaultPayMinor =
    bills.currentBillMinor > 0n ? bills.currentBillMinor : bills.totalUnpaidMinor;
  const [sourceId, setSourceId] = useState(eligibleSources[0]?.id ?? "");
  const [amount, setAmount] = useState(
    defaultPayMinor > 0n ? minorToInput(defaultPayMinor.toString(), creditAsset.exponent) : "",
  );
  const [fee, setFee] = useState("");
  const [note, setNote] = useState(
    `Pelunasan tagihan ${creditAsset.displayName} (${formatShortDueIso(bills.currentDueIso)})`,
  );
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!begin()) return;
    setError("");
    try {
      if (!sourceId) throw new Error("Pilih rekening sumber pembayaran.");
      const draft: ActivityDraft = {
        kind: "transfer",
        amountMinor: inputToMinor(amount, creditAsset.exponent),
        sourceAssetId: sourceId,
        destinationAssetId: creditAsset.id,
        transferFeeMinor: fee.trim() ? inputToMinor(fee, creditAsset.exponent) : undefined,
        occurredAt: new Date().toISOString(),
        note: note.trim() || `Pelunasan tagihan ${creditAsset.displayName}`,
      };
      const payload = JSON.stringify({ draft });
      if (replay.current?.payload !== payload) {
        replay.current = { payload, key: crypto.randomUUID() };
      }
      await financeRequest("post", { draft, idempotencyKey: replay.current.key });
      refresh();
      notify(`Tagihan ${creditAsset.displayName} berhasil dibayar.`);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pembayaran tagihan gagal disimpan.");
    } finally {
      finish();
    }
  }

  return (
    <dialog
      ref={dialog}
      className="finance-dialog"
      aria-labelledby="pay-credit-bill-title"
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">PELUNASAN KREDIT & PAYLATER</span>
          <h2 id="pay-credit-bill-title">Bayar tagihan {creditAsset.displayName}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Tutup"
          disabled={pending}
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
      </div>
      <p className="finance-hint">
        Pelunasan dicatat sebagai transfer dari rekening pembayar ke <strong>{creditAsset.displayName}</strong> agar saldo tagihan berkurang tanpa menghitung pengeluaran dua kali.
      </p>
      {!eligibleSources.length ? (
        <p className="finance-error" role="alert">
          Belum ada rekening/aset aktif dalam mata uang {creditAsset.currency} untuk membayar tagihan ini.
        </p>
      ) : (
        <form onSubmit={submit} aria-busy={pending}>
          <fieldset className="finance-fieldset" disabled={pending}>
            <dl className="investment-preview">
              <div>
                <dt>Jatuh tempo terdekat ({formatShortDueIso(bills.currentDueIso)})</dt>
                <dd className="pnl-negative">
                  {formatMinor(bills.currentBillMinor.toString(), creditAsset.currency, creditAsset.exponent)}
                </dd>
              </div>
              {bills.nextBillMinor > 0n && (
                <div>
                  <dt>Periode berikutnya ({formatShortDueIso(bills.nextDueIso)})</dt>
                  <dd>
                    {formatMinor(bills.nextBillMinor.toString(), creditAsset.currency, creditAsset.exponent)}
                  </dd>
                </div>
              )}
            </dl>
            <label className="field">
              <span>Bayar dari rekening ({creditAsset.currency})</span>
              <select
                required
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
              >
                {eligibleSources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} · {formatMinor(item.balanceMinor, item.currency, item.exponent)}
                  </option>
                ))}
              </select>
            </label>
            <div className="field-grid">
              <label className="field">
                <span>Jumlah bayar ({creditAsset.currency})</span>
                <input
                  required
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0"
                />
              </label>
              <label className="field">
                <span>Biaya admin / bunga tambahan (opsional)</span>
                <input
                  inputMode="decimal"
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                  placeholder="0"
                />
              </label>
            </div>
            <label className="field">
              <span>Catatan</span>
              <input
                maxLength={240}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="finance-error">
                {error}
              </p>
            )}
            <div className="finance-actions">
              <button
                type="button"
                className="finance-secondary"
                onClick={() => dialog.current?.close()}
              >
                Batal
              </button>
              <button type="submit" className="button-primary" disabled={pending} aria-busy={pending}>
                {pending ? <LoadingIndicator>Memproses pembayaran…</LoadingIndicator> : "Bayar tagihan"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </dialog>
  );
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
      <label className="field"><span>Saldo awal yang benar ({history.currency})</span><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></label>
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
  const [payingCredit, setPayingCredit] = useState<FinanceAsset | null>(null);
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
  const regularActive = active.filter((item) => !isCreditAsset(item));
  const creditActive = active.filter((item) => isCreditAsset(item));
  const archived = assets.filter((item) => !item.isActive);

  return <div className="page finance-assets-page"><div className="page-heading finance-heading"><div><span className="eyebrow">POSISI KEUANGAN</span><h1>Assets</h1>
    </div><div className="page-heading-actions"><ExportMenuButton dataset="assets" label="Ekspor Aset" /><button className="button-primary" type="button" onClick={openNewAsset}><Plus size={17} /> Tambah aset</button></div></div>
    <div className="asset-overview-grid">{!!totals.length && <section className="asset-total finance-asset-total"><div className="finance-total-heading"><span className="finance-total-icon"><Bank size={17} weight="bold" /></span><span>Total aset tercatat</span></div>
      {totals.map((item) => <strong className="financial-value financial-value--summary" key={item.currency}>{formatMinor(item.amountMinor, item.currency, item.exponent)}</strong>)}
      </section>}
    <InvestmentSummary totals={investmentTotals} /></div>
    {!regularActive.length ? <section className="surface finance-empty"><h2>{archived.length ? "Tidak ada aset aktif" : "Belum ada aset"}</h2><p>{archived.length ? "Tampilkan yang diarsipkan untuk memulihkan aset, atau tambahkan aset baru." : "Buat akun atau aset pertama, lalu catat saldo awalnya."}</p>
      <button className="button-primary" type="button" onClick={openNewAsset}>Tambah aset</button></section> : <section className="surface"><SectionHeading title="Akun & nilai tercatat" eyebrow="ASET AKTIF" action={<div className="section-heading-actions"><span className="count-pill">{regularActive.length} aset</span><ExportMenuButton dataset="assets" label="Ekspor Aset" /></div>} />
      <div className="asset-list">{regularActive.map((asset) => {
        const mark = resolveProviderMark(asset.providerName, asset.displayName, asset.normallySpendable ? "blue" : asset.normallyLiquid ? "cyan" : "violet");
        return <article className="asset-row data-list-row data-list-row--entity" key={asset.id}>
        <div className="data-list-identity"><ProviderBrandMark mark={mark} />
          <div className="asset-copy"><strong>{asset.displayName}</strong><span>{[asset.providerName, asset.assetTypeName, asset.safeSuffix ? `•••• ${asset.safeSuffix}` : null].filter(Boolean).join(" · ")}</span>
            {!mobile && asset.assetGroupName && <small>{asset.assetGroupName}</small>}</div></div>
        <div className="data-list-management"><strong className="asset-amount financial-value financial-value--entity">{formatMinor(asset.balanceMinor, asset.currency, asset.exponent)}</strong>
        <div className="data-list-actions"><button type="button" className="row-action" onClick={() => setEditing(asset)}><PencilSimple size={14} weight="bold" /> Ubah</button><button type="button" className="row-action" onClick={() => setCorrecting(asset)}>Koreksi saldo awal</button></div></div></article>;
      })}</div></section>}

    {creditActive.length > 0 && (
      <section className="surface credit-assets-section">
        <SectionHeading
          title="Kredit & PayLater"
          eyebrow="TAGIHAN BERJALAN & FASILITAS KREDIT"
          action={
            <div className="section-heading-actions">
              <span className="count-pill">{creditActive.length} akun</span>
            </div>
          }
        />
        <div className="asset-list">
          {creditActive.map((asset) => {
            const mark = resolveProviderMark(asset.providerName, asset.displayName, "coral");
            const meta = parseCreditMeta(asset.note);
            const bills = computeCreditBills(asset);
            const hasBill = bills.totalUnpaidMinor > 0n;
            return (
              <article className="asset-row data-list-row data-list-row--entity credit-asset-row" key={asset.id}>
                <div className="data-list-identity">
                  <ProviderBrandMark mark={mark} />
                  <div className="asset-copy">
                    <strong>{asset.displayName}</strong>
                    <span>
                      {[
                        asset.providerName,
                        `Cutoff tgl ${bills.cutoffDay} · Jatuh tempo tgl ${bills.dueDay}`,
                        asset.safeSuffix ? `•••• ${asset.safeSuffix}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {bills.availableLimitMinor !== null && (
                      <small>
                        Sisa limit: <strong>{formatMinor(bills.availableLimitMinor.toString(), asset.currency, asset.exponent)}</strong> dari {formatMinor(bills.limitMinor.toString(), asset.currency, asset.exponent)}
                      </small>
                    )}
                    {meta.cleanNote && <small>{meta.cleanNote}</small>}
                  </div>
                </div>
                <div className="data-list-management">
                  {hasBill ? (
                    <div className="credit-bill-stack">
                      <strong className="asset-amount financial-value financial-value--entity pnl-negative">
                        Tagihan {formatShortDueIso(bills.currentDueIso)}: {formatMinor(bills.currentBillMinor.toString(), asset.currency, asset.exponent)}
                      </strong>
                      {bills.nextBillMinor > 0n && (
                        <small className="credit-next-bill-label">
                          Periode {formatShortDueIso(bills.nextDueIso)}: <strong>{formatMinor(bills.nextBillMinor.toString(), asset.currency, asset.exponent)}</strong>
                        </small>
                      )}
                    </div>
                  ) : (
                    <strong className="asset-amount financial-value financial-value--entity pnl-positive credit-settled-pill">
                      <CheckCircle size={15} weight="fill" /> Lunas ({formatMinor("0", asset.currency, asset.exponent)})
                    </strong>
                  )}
                  <div className="data-list-actions">
                    {hasBill && (
                      <button
                        type="button"
                        className="button-primary credit-pay-button"
                        onClick={() => setPayingCredit(asset)}
                      >
                        Bayar tagihan
                      </button>
                    )}
                    <button
                      type="button"
                      className="row-action"
                      onClick={() => setEditing(asset)}
                    >
                      <PencilSimple size={14} weight="bold" /> Ubah / Atur tagihan
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    )}

    {archived.length > 0 && <><label className="finance-history-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Tampilkan yang diarsipkan ({archived.length})</label>
      {showArchived && <section className="surface finance-archived"><SectionHeading title="Aset diarsipkan" />
      <div className="asset-list">{archived.map((asset) => {
        const mark = resolveProviderMark(asset.providerName, asset.displayName, asset.normallySpendable ? "blue" : asset.normallyLiquid ? "cyan" : "violet");
        return <div className="asset-row data-list-row data-list-row--entity" key={asset.id}><div className="data-list-identity"><ProviderBrandMark mark={mark} /><div className="asset-copy"><strong>{asset.displayName}</strong><small>Diarsipkan</small></div></div><div className="data-list-management"><strong className="asset-amount financial-value financial-value--entity">{formatMinor(asset.balanceMinor, asset.currency, asset.exponent)}</strong><div className="data-list-actions"><button type="button" className="row-action" onClick={() => setCorrecting(asset)}>Riwayat saldo awal</button><button type="button" className="row-action" disabled={pending || refreshing} aria-busy={pending && restoringId === asset.id} onClick={() => void restore(asset.id)}>{pending && restoringId === asset.id ? <LoadingIndicator>Memulihkan...</LoadingIndicator> : "Pulihkan"}</button></div></div></div>;
      })}</div><details className="context-help"><summary>Tentang aset diarsipkan</summary><p className="finance-hint supporting-prose">Saldo awal dan riwayat tetap tersimpan. Aset tidak dihapus permanen; pulihkan untuk menggunakannya kembali.</p></details></section>}</>}
    {error && <p className="finance-error" role="alert">{error}</p>}
    <details className="context-help"><summary>Cara membaca aset & PayLater</summary><p className="finance-hint supporting-prose supporting-prose--section">Saldo aset positif berasal dari saldo awal dan seluruh pergerakan yang tercatat. Untuk menambahkan akun PayLater atau Kartu Kredit, klik Tambah aset lalu pilih tab Kredit & PayLater.</p></details>
    {editing && (
      <AssetForm
        key={editing === "new" ? "new" : editing.id}
        initial={editing === "new" ? undefined : editing}
        onClose={() => setEditing(null)}
      />
    )}
    {payingCredit && (
      <PayCreditBillDialog
        key={payingCredit.id}
        creditAsset={payingCredit}
        regularAssets={regularActive}
        onClose={() => setPayingCredit(null)}
      />
    )}
    {correcting && <AssetOpeningCorrection key={correcting.id} asset={correcting} onClose={() => setCorrecting(null)} />}
  </div>;
}
