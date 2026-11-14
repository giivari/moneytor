"use client";

import { investmentCashMinor } from "@/lib/record-values";
import { sortTemporal, sortNamed } from "@/lib/list-order";
import { useListSort } from "./use-list-sort";
import { ListSortControl } from "./list-sort-control";
import { AppLink as Link } from "@/components/app-link";
import { PageTabs } from "./page-tabs";
import { useRef, useState } from "react";
import { ExportMenuButton } from "./export-menu-button";
import { SectionHeading } from "./section-heading";
import { useMobileViewport } from "./use-mobile-viewport";
import { ArrowClockwise, ChartLineUp, Check, PencilSimple, Plus, Receipt, Trash, X } from "@phosphor-icons/react";
import { Amount, Chip, PageHeading } from "./ui";
import { ExcelStatusBar } from "./excel-status-bar";
import { useInspector, useInspectorSync, type InspectorEntry } from "./inspector";
import { InspectorFacts } from "./inspector-facts";
import { useFinanceDialog } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import { investmentWorkflow } from "@/lib/investments/workflow";
import { requestJson } from "@/lib/finance/client";
import { decimal, decimalString, replayPosition, tradeCash } from "@/lib/investments/math";
import { formatInvestmentPrice, formatQuantity } from "@/lib/investments/display";
import type { FinanceAsset } from "@/lib/finance/types";
import type { Holding, InvestmentSnapshot, InvestmentTrade, TradeDraft, PricePoint, RecordedOpening, OpeningCorrection } from "@/lib/investments/types";

type Workspace = { snapshot: InvestmentSnapshot; assets: FinanceAsset[]; providers: { id: string; displayName: string }[]; currencies: { code: string; exponent: number }[] };
type FormMode = "portfolio" | "instrument" | "type" | "opening" | "opening-correct" | "trade" | "price" | "price-correct" | "rename";
type FormState = { mode: FormMode; price?: PricePoint; opening?: RecordedOpening; kind?: "buy" | "sell"; portfolioId?: string; instrumentId?: string; trade?: InvestmentTrade; rename?: { kind: "portfolio" | "instrument"; id: string; displayName: string; symbol?: string; market?: string; priceSymbol?: string } };
type Confirmation = { operation: "void" | "archive" | "delete"; id: string; kind?: "portfolio" | "instrument"; title: string; description: string };
type OpeningHistoryState = { status: "idle" } | { status: "pending"; showLoader: boolean } | { status: "loaded"; rows: OpeningCorrection[] } | { status: "error"; message: string };
const localDate = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
function decimalInput(raw: string) { return decimalString(decimal(raw.trim().replace(",", "."))); }
function Pnl({ value, currency, exponent }: { value: string | null; currency: string; exponent: number }) {
  return <strong className={value === null ? "" : BigInt(value) < 0n ? "pnl-negative" : BigInt(value) > 0n ? "pnl-positive" : ""}>{value === null ? "Belum ada harga" : formatMinor(value, currency, exponent)}</strong>;
}
function OpeningHistory({ opening, currency, exponent }: { opening: RecordedOpening; currency: string; exponent: number }) {
  const [history, setHistory] = useState<OpeningHistoryState>({ status: "idle" });
  const disclosure = useRef<HTMLDetailsElement>(null);
  const requestGeneration = useRef(0);
  const activeRequest = useRef<number | null>(null);
  const loadingTimer = useRef<{ generation: number; handle: ReturnType<typeof setTimeout> } | null>(null);
  function clearLoadingTimer(generation?: number) {
    const timer = loadingTimer.current;
    if (!timer || (generation !== undefined && timer.generation !== generation)) return;
    clearTimeout(timer.handle);
    loadingTimer.current = null;
  }
  function cancelPending() {
    requestGeneration.current += 1;
    activeRequest.current = null;
    clearLoadingTimer();
    setHistory((current) => current.status === "pending" ? { status: "idle" } : current);
  }
  async function load() {
    if (activeRequest.current !== null || history.status === "loaded") return;
    const generation = ++requestGeneration.current;
    activeRequest.current = generation;
    setHistory({ status: "pending", showLoader: false });
    const handle = setTimeout(() => {
      if (activeRequest.current === generation && disclosure.current?.open) {
        setHistory((current) => current.status === "pending" ? { ...current, showLoader: true } : current);
      }
    }, 120);
    loadingTimer.current = { generation, handle };
    try {
      const rows = (await requestJson<{ corrections: OpeningCorrection[] }>(`/api/investments/opening-history?id=${encodeURIComponent(opening.id)}`, { cache: "no-store" })).corrections;
      if (activeRequest.current === generation) {
        clearLoadingTimer(generation);
        setHistory({ status: "loaded", rows });
      }
    } catch {
      if (activeRequest.current === generation) {
        clearLoadingTimer(generation);
        setHistory({ status: "error", message: "Riwayat belum dapat dimuat." });
      }
    } finally {
      clearLoadingTimer(generation);
      if (activeRequest.current === generation) activeRequest.current = null;
    }
  }
  const correctionSort = useListSort(`investments.${opening.id}.opening-corrections`);
  const loadedRows = history.status === "loaded" ? history.rows : null;
  const showHistoryLoader = history.status === "pending" && history.showLoader && loadedRows === null;
  return <details ref={disclosure} className="investment-price-history" onToggle={(event) => {
    if (event.currentTarget.open) {
      if (history.status === "idle") void load();
    } else if (activeRequest.current !== null) cancelPending();
  }}>
    <summary>Posisi asli & riwayat koreksi</summary>
    {showHistoryLoader && <p className="inline-disclosure-loading" role="status" aria-live="polite">Memuat riwayat...</p>}
    {history.status === "error" && <p className="inline-disclosure-error" role="alert">{history.message} <button type="button" className="inline-disclosure-retry" onClick={() => void load()}>Coba lagi</button></p>}
    {history.status !== "pending" && <>
    <dl className="investment-opening-state">
      <div><dt>Posisi asli</dt><dd>{formatQuantity(opening.originalQuantity)} unit · {formatMinor(opening.originalCostBasisMinor, currency, exponent)}</dd></div>
      <div><dt>Posisi efektif saat ini</dt><dd>{formatQuantity(opening.quantity)} unit · {formatMinor(opening.costBasisMinor, currency, exponent)}</dd></div>
    </dl>
    {history.status === "loaded" && history.rows.length === 0 && <p>Belum ada koreksi.</p>}
    {history.status === "loaded" && history.rows.length > 0 ? <div className="investment-opening-history"><ListSortControl {...correctionSort} />{sortTemporal(history.rows, correctionSort.direction, item => item.createdAt, item => item.id).map((item) => <article className="investment-correction-entry" key={item.id}>
      <small>{new Date(item.createdAt).toLocaleString("id-ID")}</small>
      <p><strong>Kuantitas:</strong> {formatQuantity(item.previousQuantity)} → {formatQuantity(item.correctedQuantity)} unit</p>
      <p><strong>Nilai perolehan:</strong> {formatMinor(item.previousCostBasisMinor, currency, exponent)} → {formatMinor(item.correctedCostBasisMinor, currency, exponent)}</p>
      {item.note && <p className="investment-correction-note">Alasan: {item.note}</p>}
    </article>)}</div> : null}
    </>}
  </details>;
}
async function request(operation: string, body: object) {
  return requestJson<Record<string, unknown>>(`/api/investments/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
}
function InvestmentForm({ workspace, state, onClose }: { workspace: Workspace; state: FormState; onClose: () => void }) {
  const { snapshot, assets, providers, currencies } = workspace;
  const { refresh, notify } = useFinanceFeedback();
  const dialog = useFinanceDialog(onClose);
  const { pending, begin, finish } = useMutationPending();
  const [error, setError] = useState("");
  const replay = useRef<{ payload: string; key: string } | null>(null);
  const initial = state.trade;
  const defaultPortfolio = state.instrumentId
    ? snapshot.portfolios.find((p) => p.isActive && p.currency === snapshot.instruments.find((i) => i.id === state.instrumentId)?.currency)
    : investmentWorkflow(snapshot, assets.map((asset) => asset.currency)).portfolio;
  const [kind, setKind] = useState<"buy" | "sell">(initial?.kind ?? state.kind ?? "buy");
  const [portfolioId, setPortfolioId] = useState(initial?.portfolioId ?? state.portfolioId ?? defaultPortfolio?.id ?? "");
  const portfolio = snapshot.portfolios.find((p) => p.id === portfolioId);
  const [instrumentId, setInstrumentId] = useState(initial?.instrumentId ?? state.instrumentId ?? snapshot.instruments.find((i) => i.isActive && i.currency === portfolio?.currency)?.id ?? "");
  const instrument = snapshot.instruments.find((i) => i.id === instrumentId);
  const [currency, setCurrency] = useState(portfolio?.currency ?? currencies[0]?.code ?? "IDR");
  const currentCurrency = ["trade", "opening", "opening-correct"].includes(state.mode) ? portfolio?.currency ?? currency : ["price", "price-correct"].includes(state.mode) ? instrument?.currency ?? currency : currency;
  const exponent = currencies.find((c) => c.code === currentCurrency)?.exponent ?? 0;
  const [displayName, setDisplayName] = useState(state.rename?.displayName ?? "");
  const [providerId, setProviderId] = useState("");
  const [typeId, setTypeId] = useState(snapshot.instrumentTypes.find((t) => t.isActive)?.id ?? "");
  const [symbol, setSymbol] = useState(state.rename?.symbol ?? "");
  const [market, setMarket] = useState(state.rename?.market ?? "");
  const [priceSymbol, setPriceSymbol] = useState(state.rename?.priceSymbol ?? "");
  const [quantity, setQuantity] = useState(state.opening?.quantity ?? initial?.quantity ?? "");
  const [unitPrice, setUnitPrice] = useState(state.price?.price ?? initial?.unitPrice ?? "");
  const [costBasis, setCostBasis] = useState(state.opening ? minorToInput(state.opening.costBasisMinor, exponent) : "");
  const [fee, setFee] = useState(initial ? minorToInput(initial.feeMinor, exponent) : "0");
  const [cashAssetId, setCashAssetId] = useState(initial?.cashAssetId ?? "");
  const [occurredAt, setOccurredAt] = useState(localDate(state.price?.asOf ?? initial?.occurredAt));
  const [note, setNote] = useState(initial?.note ?? "");
  const holding = snapshot.holdings.find((h) => h.portfolioId === portfolioId && h.instrumentId === instrumentId);
  const titles: Record<FormMode, string> = { portfolio: "Portofolio baru", instrument: "Instrumen baru", type: "Jenis instrumen baru", opening: "Investasi yang sudah dimiliki", "opening-correct": "Koreksi posisi awal", trade: initial ? "Koreksi transaksi investasi" : "Catat beli / jual", price: "Harga pasar manual", "price-correct": "Koreksi harga manual", rename: state.rename?.kind === "instrument" ? "Ubah instrumen" : "Ubah nama" };
  let preview: { gross: bigint; fee: bigint; cash: bigint } | null = null;
  if (state.mode === "trade") try { preview = tradeCash(kind, decimalInput(quantity), decimalInput(unitPrice), inputToMinor(fee || "0", exponent), exponent); } catch { /* Incomplete input is expected while typing. */ }
  let openingPreview: ReturnType<typeof replayPosition> | null = null;
  let openingPreviewError = "";
  if (state.mode === "opening-correct" && state.opening) try {
    const candidate = { quantity: decimalInput(quantity), costBasisMinor: inputToMinor(costBasis, exponent), occurredAt: state.opening.occurredAt };
    const events = snapshot.trades.filter((trade) => trade.status === "posted" && trade.portfolioId === state.opening!.portfolioId && trade.instrumentId === state.opening!.instrumentId)
      .map((trade) => ({ id: trade.id, kind: trade.kind, quantity: trade.quantity, grossMinor: trade.grossMinor, feeMinor: trade.feeMinor, occurredAt: trade.occurredAt, order: trade.order }));
    openingPreview = replayPosition(candidate, events, exponent);
  } catch (cause) { openingPreviewError = cause instanceof Error ? cause.message : "Pratinjau belum tersedia."; }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!begin()) return; setError("");
    try {
      let operation: string = state.mode;
      let body: Record<string, unknown>;
      const instant = () => new Date(occurredAt).toISOString();
      if (state.mode === "portfolio") { operation = "portfolio-create"; body = { displayName, currency, providerId: providerId || undefined, note }; }
      else if (state.mode === "instrument") { operation = "instrument-create"; body = { displayName, currency, typeId, symbol, market, priceSymbol }; }
      else if (state.mode === "type") { operation = "type-create"; body = { displayName }; }
      else if (state.mode === "rename") { body = state.rename?.kind === "instrument" ? { ...state.rename, displayName, symbol, market, priceSymbol } : { ...state.rename, displayName }; }
      else if (state.mode === "opening") { body = { draft: { portfolioId, instrumentId, quantity: decimalInput(quantity), costBasisMinor: inputToMinor(costBasis, exponent), occurredAt: instant(), initialPrice: unitPrice ? decimalInput(unitPrice) : undefined } }; }
      else if (state.mode === "opening-correct") { body = { draft: { openingId: state.opening!.id,
        expectedQuantity: state.opening!.quantity, expectedCostBasisMinor: state.opening!.costBasisMinor,
        quantity: decimalInput(quantity), costBasisMinor: inputToMinor(costBasis, exponent), note } }; }
      else if (state.mode === "price-correct") { body = { id: state.price!.id, price: decimalInput(unitPrice) }; }
      else if (state.mode === "price") { body = { draft: { instrumentId, price: decimalInput(unitPrice), asOf: instant() } }; }
      else {
        operation = initial ? "replace" : "trade";
        const draft: TradeDraft = { kind, portfolioId, instrumentId, cashAssetId, quantity: decimalInput(quantity), unitPrice: decimalInput(unitPrice), feeMinor: inputToMinor(fee || "0", exponent), occurredAt: instant(), note };
        body = { id: initial?.id, draft };
      }
      const payload = JSON.stringify({ operation, body });
      if (replay.current?.payload !== payload) replay.current = { payload, key: crypto.randomUUID() };
      await request(operation, { ...body, idempotencyKey: replay.current.key });
      refresh(); notify(["price", "price-correct"].includes(state.mode) ? "Harga pasar berhasil disimpan." : state.mode === "trade" ? "Transaksi investasi berhasil disimpan." : "Data investasi berhasil disimpan."); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Perubahan gagal disimpan."); }
    finally { finish(); }
  }
  const moneyField = (title: string, value: string, change: (value: string) => void, required = true) => <label className="field"><span>{title}</span><input inputMode="decimal" required={required} value={value} onChange={(e) => change(e.target.value)} placeholder="0" /></label>;
  const providerHint = snapshot.providerConfigured
    ? "Gunakan format penyedia (mis. coingecko:bitcoin, twelvedata:BBCA, atau simbol penyedia aktif) untuk memuat harga otomatis."
    : "Referensi simbol untuk penyedia harga otomatis bila dikonfigurasi di server.";
  return <dialog ref={dialog} className="finance-dialog investment-dialog" aria-labelledby="investment-form-title" onCancel={(e) => { if (pending) e.preventDefault(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">INVESTASI TERCATAT</span><h2 id="investment-form-title">{titles[state.mode]}</h2></div><button type="button" className="icon-button" disabled={pending} aria-label="Tutup" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
    <form onSubmit={save} aria-busy={pending}><fieldset className="finance-fieldset" disabled={pending}>
      {["portfolio", "instrument", "type", "rename"].includes(state.mode) && <label className="field"><span>Nama</span><input autoFocus required maxLength={120} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>}
      {state.mode === "instrument" && <p className="finance-hint">Instrumen adalah aset yang unit dan harganya Anda pantau, misalnya saham atau reksa dana.</p>}
      {["portfolio", "instrument"].includes(state.mode) && <label className="field"><span>Mata uang</span><select value={currency} onChange={(e) => setCurrency(e.target.value)}>{currencies.map((c) => <option key={c.code}>{c.code}</option>)}</select></label>}
      {state.mode === "portfolio" && <><label className="field"><span>Penyedia (opsional)</span><select value={providerId} onChange={(e) => setProviderId(e.target.value)}><option value="">Tanpa penyedia</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label><p className="finance-hint">Portofolio adalah tempat mengelompokkan investasi, misalnya akun broker. Saldo kas dicatat terpisah di Assets.</p></>}
      {state.mode === "instrument" && <><label className="field"><span>Jenis instrumen</span><select value={typeId} onChange={(e) => setTypeId(e.target.value)}>{snapshot.instrumentTypes.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}</select></label><details className="investment-optional"><summary>Detail tambahan <span>opsional</span></summary><div className="field-grid"><label className="field"><span>Simbol / kode (opsional)</span><input maxLength={80} value={symbol} onChange={(e) => setSymbol(e.target.value)} /></label><label className="field"><span>Pasar (opsional)</span><input maxLength={80} value={market} onChange={(e) => setMarket(e.target.value)} /></label></div><label className="field"><span>Referensi penyedia harga (opsional)</span><input maxLength={120} value={priceSymbol} onChange={(e) => setPriceSymbol(e.target.value)} placeholder="mis. coingecko:bitcoin" /></label><p className="finance-hint">{providerHint}</p></details></>}
      {state.mode === "rename" && state.rename?.kind === "instrument" && <><div className="field-grid"><label className="field"><span>Simbol / kode (opsional)</span><input maxLength={80} value={symbol} onChange={(e) => setSymbol(e.target.value)} /></label><label className="field"><span>Pasar (opsional)</span><input maxLength={80} value={market} onChange={(e) => setMarket(e.target.value)} /></label></div><label className="field"><span>Referensi penyedia harga (opsional)</span><input maxLength={120} value={priceSymbol} onChange={(e) => setPriceSymbol(e.target.value)} placeholder="mis. coingecko:bitcoin" /></label><p className="finance-hint">{providerHint}</p></>}
      {state.mode === "trade" && <div className="field"><span>Jenis transaksi</span><div className="segmented investment-kind" data-kind={kind} role="group" aria-label="Beli atau jual">{(["buy", "sell"] as const).map((k) => <button type="button" key={k} aria-pressed={kind === k} className={kind === k ? "selected" : ""} onClick={() => setKind(k)}>{k === "buy" ? "Beli" : "Jual"}</button>)}</div></div>}
      {state.mode === "trade" && <p className="finance-hint">Beli memindahkan kas menjadi unit investasi. Jual melepas unit dan mengembalikan hasil ke aset kas.</p>}
      {["trade", "opening"].includes(state.mode) && <label className="field"><span>Portofolio</span><select required value={portfolioId} onChange={(e) => { setPortfolioId(e.target.value); setInstrumentId(""); setCashAssetId(""); }}><option value="">Pilih portofolio</option>{snapshot.portfolios.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.displayName} · {p.currency}</option>)}</select></label>}
      {["trade", "opening", "price"].includes(state.mode) && <label className="field"><span>Instrumen</span><select required value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}><option value="">Pilih instrumen</option>{snapshot.instruments.filter((i) => i.isActive && (state.mode === "price" || i.currency === portfolio?.currency)).map((i) => <option key={i.id} value={i.id}>{i.displayName} · {i.currency}</option>)}</select></label>}
      {["trade", "opening"].includes(state.mode) && <>{moneyField("Jumlah unit", quantity, setQuantity)}{state.mode === "trade" && kind === "sell" && <p className="finance-hint">Tersedia saat ini: {formatQuantity(holding?.quantity ?? "0")} unit. Riwayat pada tanggal transaksi juga harus mencukupi.</p>}</>}
      {state.mode === "opening" && <>{moneyField(`Total biaya pembelian dulu (${currentCurrency})`, costBasis, setCostBasis)}{moneyField(`Harga pasar awal (${currentCurrency}, opsional)`, unitPrice, setUnitPrice, false)}<p className="finance-hint">Posisi awal dipakai untuk investasi yang sudah Anda miliki, bukan pembelian baru. Tidak ada kas yang dipindahkan. Jangan catat nilai investasi ini lagi sebagai saldo kas.</p></>}
      {state.mode === "opening-correct" && <><dl className="investment-preview"><div><dt>Posisi awal asli</dt><dd>{formatQuantity(state.opening!.originalQuantity)} unit · {formatMinor(state.opening!.originalCostBasisMinor, currentCurrency, exponent)}</dd></div><div><dt>Posisi awal saat ini</dt><dd>{formatQuantity(state.opening!.quantity)} unit · {formatMinor(state.opening!.costBasisMinor, currentCurrency, exponent)}</dd></div></dl>{moneyField("Jumlah unit yang benar", quantity, setQuantity)}{moneyField(`Biaya perolehan awal yang benar (${currentCurrency})`, costBasis, setCostBasis)}{openingPreview ? <dl className="investment-preview"><div><dt>Perkiraan unit sesudah koreksi</dt><dd>{formatQuantity(openingPreview.quantity)}</dd></div><div><dt>Perkiraan biaya perolehan tersisa</dt><dd>{formatMinor(openingPreview.costBasisMinor, currentCurrency, exponent)}</dd></div></dl> : openingPreviewError && <p className="finance-error" role="status">{openingPreviewError}</p>}<p className="finance-hint">Seluruh transaksi berikutnya akan diperiksa ulang. Kas dan harga pasar tidak berubah; posisi serta laba/rugi dapat berubah.</p><label className="field"><span>Alasan koreksi (opsional)</span><textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label></>}
      {state.mode === "opening-correct" && <OpeningHistory opening={state.opening!} currency={currentCurrency} exponent={exponent} />}
      {["trade", "price", "price-correct"].includes(state.mode) && moneyField(`${state.mode === "trade" ? "Harga eksekusi" : "Harga pasar"} per unit (${currentCurrency})`, unitPrice, setUnitPrice)}
      {state.mode === "price-correct" && <p className="finance-hint">Harga {formatInvestmentPrice(state.price!.price, currentCurrency, exponent)} pada {new Date(state.price!.asOf).toLocaleString("id-ID")} akan digantikan oleh catatan baru pada waktu yang sama. Versi lama tetap tersimpan. Transaksi dan biaya perolehan tidak berubah.</p>}
      {state.mode === "trade" && <><label className="field"><span>{kind === "buy" ? "Aset kas pembayar" : "Aset kas penerima"}</span><select required value={cashAssetId} onChange={(e) => setCashAssetId(e.target.value)}><option value="">Pilih aset kas</option>{assets.filter((a) => a.currency === currentCurrency).map((a) => <option key={a.id} value={a.id}>{a.displayName} · {formatMinor(a.balanceMinor, a.currency, a.exponent)}</option>)}</select></label>{moneyField(`Biaya transaksi (${currentCurrency})`, fee, setFee)}
        {preview && <dl className="investment-preview"><div><dt>{kind === "buy" ? "Nilai pembelian" : "Nilai penjualan"}</dt><dd>{formatMinor(preview.gross, currentCurrency, exponent)}</dd></div><div><dt>Biaya</dt><dd>{formatMinor(preview.fee, currentCurrency, exponent)}</dd></div><div><dt>{kind === "buy" ? "Total kas keluar" : "Kas diterima"}</dt><dd>{formatMinor(preview.cash, currentCurrency, exponent)}</dd></div></dl>}
        <p className="finance-hint">Pokok {kind === "buy" ? "pembelian" : "penjualan"} bukan {kind === "buy" ? "pengeluaran" : "pemasukan"} biasa. Harga eksekusi tidak otomatis menjadi harga pasar.</p></>}
      {state.mode === "trade" && <details className="investment-optional" open={Boolean(initial)}><summary>Waktu & catatan <span>opsional</span></summary><label className="field"><span>Waktu transaksi</span><input required type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></label><label className="field"><span>Catatan (opsional)</span><textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label></details>}
      {["opening", "price"].includes(state.mode) && <label className="field"><span>{["price", "price-correct"].includes(state.mode) ? "Harga per tanggal" : "Waktu pencatatan"}</span><input required type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></label>}
      {state.mode === "portfolio" && <label className="field"><span>Catatan (opsional)</span><textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>}
      {initial && <p className="finance-hint">Koreksi mempertahankan catatan lama dan memeriksa ulang semua transaksi berikutnya. Laba/rugi penjualan berikutnya dapat berubah.</p>}
      {error && <p className="finance-error" role="alert">{error}</p>}
      <div className="finance-actions"><button type="button" className="finance-secondary" disabled={pending} onClick={() => dialog.current?.close()}>Batal</button><button className="button-primary" type="submit" disabled={pending || (state.mode === "opening-correct" && (!openingPreview || (quantity === state.opening?.quantity && inputToMinor(costBasis, exponent) === state.opening?.costBasisMinor)))} aria-busy={pending}>{pending ? <LoadingIndicator>{state.mode === "trade" ? "Mencatat transaksi..." : ["price", "price-correct"].includes(state.mode) ? "Menyimpan harga..." : "Menyimpan..."}</LoadingIndicator> : state.mode === "trade" ? "Catat transaksi" : "Simpan"}</button></div>
    </fieldset></form>
  </dialog>;
}
function InvestmentConfirmation({ action, onClose }: { action: Confirmation; onClose: () => void }) {
  const dialog = useFinanceDialog(onClose);
  const { pending, begin, finish } = useMutationPending();
  const { refresh, notify } = useFinanceFeedback();
  const [error, setError] = useState("");
  const key = useRef<string | null>(null);
  async function confirm() {
    if (!begin()) return; setError(""); key.current ??= crypto.randomUUID();
    try { await request(action.operation, { id: action.id, kind: action.kind, idempotencyKey: key.current }); refresh(); notify(action.operation === "void" ? "Transaksi investasi dibatalkan." : action.operation === "delete" ? "Data investasi dihapus permanen." : "Data diarsipkan; dapat dipulihkan nanti."); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Perubahan gagal."); } finally { finish(); }
  }
  return <dialog ref={dialog} className="security-confirm" aria-labelledby="investment-confirm-title" aria-describedby="investment-confirm-copy" onCancel={(e) => { if (pending) e.preventDefault(); }}><h2 id="investment-confirm-title">{action.title}</h2><p id="investment-confirm-copy">{action.description}</p>{error && <p role="alert" className="finance-error">{error}</p>}<div className="security-confirm-actions"><button autoFocus type="button" className="finance-secondary" disabled={pending} onClick={() => dialog.current?.close()}>Batal</button><button type="button" className="finance-danger" disabled={pending} aria-busy={pending} onClick={() => void confirm()}>{pending ? <LoadingIndicator>{action.operation === "void" ? "Membatalkan..." : action.operation === "delete" ? "Menghapus..." : "Mengarsipkan..."}</LoadingIndicator> : action.operation === "void" ? "Batalkan transaksi" : action.operation === "delete" ? "Hapus permanen" : "Arsipkan"}</button></div></dialog>;
}
function InvestmentTradeDetails({ workspace, trade, refreshing, onClose, onCorrect, onVoid }: {
  workspace: Workspace; trade: InvestmentTrade; refreshing: boolean;
  onClose: () => void; onCorrect: () => void; onVoid: () => void;
}) {
  const dialog = useFinanceDialog(onClose);
  const instrument = workspace.snapshot.instruments.find(item => item.id === trade.instrumentId)!;
  const money = (value: string) => formatMinor(value, trade.currency, instrument.exponent);
  return <dialog ref={dialog} className="finance-dialog detail-dialog finance-detail" aria-labelledby="investment-detail-title"
    onClick={event => { if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
    } }}>
    <div className="dialog-heading"><div><span className="eyebrow">RINCIAN TRANSAKSI</span><h2 id="investment-detail-title">{trade.kind === "buy" ? "Beli" : "Jual"} · {instrument.displayName}</h2></div>
      <button autoFocus type="button" className="icon-button" onClick={() => dialog.current?.close()} aria-label="Tutup rincian"><X size={20} /></button></div>
    <dl className="detail-list">
      <div><dt>Status</dt><dd>{trade.status === "posted" ? "Aktif" : trade.status === "voided" ? "Dibatalkan" : "Dikoreksi"}</dd></div>
      <div><dt>Tanggal</dt><dd>{new Date(trade.occurredAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</dd></div>
      <div><dt>Portofolio</dt><dd>{workspace.snapshot.portfolios.find(item => item.id === trade.portfolioId)?.displayName}</dd></div>
      <div><dt>Aset kas</dt><dd>{workspace.assets.find(asset => asset.id === trade.cashAssetId)?.displayName ?? "Aset kas tersimpan"}</dd></div>
      <div><dt>Unit</dt><dd>{formatQuantity(trade.quantity)}</dd></div>
      <div><dt>Harga / unit</dt><dd>{formatInvestmentPrice(trade.unitPrice, trade.currency, instrument.exponent)}</dd></div>
      <div><dt>Pokok</dt><dd>{money(trade.grossMinor)}</dd></div>
      <div><dt>Biaya</dt><dd>{money(trade.feeMinor)}</dd></div>
      <div className="detail-total"><dt>Kas {trade.kind === "buy" ? "keluar" : "masuk"}</dt><dd>{money(investmentCashMinor(trade))}</dd></div>
      {trade.realizedMinor !== null && <div><dt>Hasil terealisasi</dt><dd><Pnl value={trade.realizedMinor} currency={trade.currency} exponent={instrument.exponent} /></dd></div>}
      {trade.removedMinor !== null && <div><dt>Biaya perolehan dilepas</dt><dd>{money(trade.removedMinor)}</dd></div>}
      {trade.note && <div><dt>Catatan</dt><dd>{trade.note}</dd></div>}
    </dl>
    {trade.replacesId && <p className="finance-hint">Koreksi catatan sebelumnya; riwayat lama tetap tersimpan.</p>}
    {trade.status === "posted" && <div className="investment-row-actions">
      <button type="button" className="row-action" disabled={refreshing} onClick={onCorrect}><PencilSimple size={14} /> Koreksi</button>
      <button type="button" className="row-action" data-tone="danger" disabled={refreshing} onClick={onVoid}><Trash size={14} /> Batalkan</button>
    </div>}
  </dialog>;
}

function tickerBadgeText(symbol?: string | null, displayName?: string): string {
  const cleanSym = (symbol ?? "").trim().toUpperCase();
  if (cleanSym) return cleanSym.slice(0, 5);
  const words = (displayName ?? "INV").trim().split(/\s+/);
  if (words.length >= 2) {
    return words
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 4);
  }
  return (displayName ?? "INV").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) || "INV";
}

export function InvestmentManager(workspace: Workspace) {
  const { snapshot } = workspace;
  const { open, close } = useInspector();
  useInspectorSync("holding:", snapshot, (id) => snapshot.holdings.find((item) => `holding:${item.portfolioId}:${item.instrumentId}` === id),
    (holding, update) => openHoldingInspector(holding, null, update));
  const [form, setForm] = useState<FormState | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<InvestmentTrade | null>(null);
  const [history, setHistory] = useState(false);
  const tradeSort = useListSort("investments.history");
  const [showMoreTrades, setShowMoreTrades] = useState(false);
  const mobile = useMobileViewport();
  const [showArchived, setShowArchived] = useState(false);
  const [pendingTarget, setPendingTarget] = useState("");
  const { pending, begin, finish } = useMutationPending();
  const { notify, refresh, refreshing } = useFinanceFeedback();
  const [error, setError] = useState("");

  const workflow = investmentWorkflow(
    snapshot,
    workspace.assets.map((asset) => asset.currency)
  );
  const hasPair = snapshot.portfolios.some(
    (p) => p.isActive && snapshot.instruments.some((i) => i.isActive && i.currency === p.currency)
  );
  const trades = sortTemporal(
    snapshot.trades.filter((trade) => history || trade.status === "posted"),
    tradeSort.direction,
    (item) => item.occurredAt,
    (item) => item.id
  );
  const tradeLimit = mobile ? 8 : 15;
  const visibleTrades = showMoreTrades ? trades : trades.slice(0, tradeLimit);

  function openTradeDetails(trade: InvestmentTrade) {
    if (!refreshing) setSelectedTrade(trade);
  }

  const identity = (holding: Holding) => ({
    portfolio: snapshot.portfolios.find((p) => p.id === holding.portfolioId)!,
    instrument: snapshot.instruments.find((i) => i.id === holding.instrumentId)!,
  });

  async function restore(kind: "portfolio" | "instrument", id: string) {
    if (refreshing || !begin()) return;
    setError("");
    setPendingTarget(id);
    try {
      await request("restore", { kind, id });
      refresh();
      notify("Data investasi berhasil dipulihkan.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data belum dapat dipulihkan.");
    } finally {
      finish();
    }
  }

  function restoreButton(kind: "portfolio" | "instrument", id: string, label = "Pulihkan") {
    return (
      <button
        type="button"
        className="row-action"
        disabled={pending || refreshing}
        aria-busy={pending && pendingTarget === id}
        onClick={() => void restore(kind, id)}
      >
        {pending && pendingTarget === id ? <LoadingIndicator>Memulihkan...</LoadingIndicator> : label}
      </button>
    );
  }

  function deleteButton(
    kind: "portfolio" | "instrument",
    item: { id: string; displayName: string; canDelete?: boolean }
  ) {
    return item.canDelete ? (
      <button
        type="button"
        className="row-action"
        data-tone="danger"
        disabled={pending || refreshing}
        onClick={() =>
          setConfirmation({
            operation: "delete",
            kind,
            id: item.id,
            title: `Hapus permanen ${item.displayName}?`,
            description:
              "Data ini belum memiliki referensi atau riwayat. Penghapusan tidak dapat dibatalkan. Server akan memeriksa ulang sebelum menghapus.",
          })
        }
      >
        Hapus permanen
      </button>
    ) : (
      <small className="finance-hint">Memiliki riwayat / referensi; tidak dapat dihapus.</small>
    );
  }

  async function refreshPrice(instrumentId: string) {
    if (!begin()) return;
    setError("");
    setPendingTarget(instrumentId);
    try {
      await request("price-refresh", { instrumentId, idempotencyKey: crypto.randomUUID() });
      refresh();
      notify("Harga berhasil diperbarui.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Harga belum dapat dimuat. Gunakan harga manual."
      );
    } finally {
      finish();
    }
  }

  function openHoldingInspector(holding: Holding, trigger?: HTMLElement | null, emit: (entry: InspectorEntry, trigger?: HTMLElement | null) => void = open) {
    const { portfolio, instrument } = identity(holding);
    const money = (v: string) => formatMinor(v, instrument.currency, instrument.exponent);
    const ticker = tickerBadgeText(instrument.symbol, instrument.displayName);
    const canTradeInstrument =
      portfolio.isActive &&
      instrument.isActive &&
      workspace.assets.some((a) => a.currency === instrument.currency);
    const canSellInstrument = canTradeInstrument && decimal(holding.quantity, true) > 0n;
    const pnlBig = holding.unrealizedMinor !== null ? BigInt(holding.unrealizedMinor) : null;
    const pnlSign = pnlBig !== null ? (pnlBig > 0n ? "+" : pnlBig < 0n ? "−" : "") : "";
    const pnlAbs =
      pnlBig !== null ? (pnlBig < 0n ? (-pnlBig).toString() : pnlBig.toString()) : null;

    emit(
      {
        id: `holding:${portfolio.id}:${instrument.id}`,
        title: "Rincian Portofolio",
        subtitle: `${instrument.displayName} · ${portfolio.displayName}`,
        body: (
          <div className="inspector-cards">
            {/* Kartu 1: Ringkasan Hero Posisi */}
            <section className="inspector-card inspector-card--hero">
              <div className="inspector-card-top">
                <span className="inspector-ref-badge">{ticker}</span>
                <Chip tone="info">{instrument.typeName}</Chip>
              </div>
              <div className="inspector-hero-metric">
                <span className="inspector-hero-caption">Nilai Pasar Saat Ini (Market Value)</span>
                <div className="inspector-hero-amount">
                  <Amount
                    value={
                      holding.marketMinor === null
                        ? "Belum ada harga"
                        : money(holding.marketMinor)
                    }
                    level="summary"
                    tone={
                      pnlBig !== null && pnlBig < 0n
                        ? "negative"
                        : pnlBig !== null && pnlBig > 0n
                        ? "positive"
                        : ""
                    }
                  />
                </div>
              </div>
              <p className="inspector-hero-title">{instrument.displayName}</p>
              <div className="inspector-meta-grid">
                <div>
                  <span className="inspector-meta-label">Platform / Sekuritas</span>
                  <strong className="inspector-meta-value">{portfolio.displayName}</strong>
                </div>
                <div>
                  <span className="inspector-meta-label">Kepemilikan Aktif</span>
                  <strong className="inspector-meta-value">
                    {formatQuantity(holding.quantity)} unit
                  </strong>
                </div>
              </div>
            </section>

            {/* Kartu 2: Bedah Valuasi & Harga Pasar */}
            <section className="inspector-card inspector-card--breakdown">
              <h3 className="inspector-card-heading">Bedah Valuasi &amp; Harga Pasar</h3>
              <InspectorFacts
                items={[
                  {
                    label: "Biaya perolehan tersisa (Modal Pokok)",
                    value: <Amount value={money(holding.costBasisMinor)} />,
                  },
                  {
                    label: "Harga beli rata-rata / unit",
                    value: formatInvestmentPrice(
                      holding.averageCost,
                      instrument.currency,
                      instrument.exponent
                    ),
                  },
                  {
                    label: "Harga pasar terakhir / unit",
                    value: holding.price
                      ? formatInvestmentPrice(
                          holding.price.price,
                          instrument.currency,
                          instrument.exponent
                        )
                      : "Belum diatur",
                  },
                  ...(holding.price
                    ? [
                        {
                          label: "Sumber & waktu harga",
                          value: `${
                            holding.price.sourceType === "manual"
                              ? "Manual"
                              : holding.price.sourceId
                          } · ${new Date(holding.price.asOf).toLocaleDateString("id-ID")}`,
                        },
                      ]
                    : []),
                  {
                    label: "Laba/rugi belum terealisasi",
                    value:
                      pnlAbs !== null ? (
                        <Amount
                          value={`${pnlSign}${money(pnlAbs)}${
                            holding.unrealizedPercent !== null
                              ? ` (${pnlBig! > 0n ? "+" : ""}${holding.unrealizedPercent}%)`
                              : ""
                          }`}
                          tone={pnlBig! < 0n ? "negative" : pnlBig! > 0n ? "positive" : ""}
                        />
                      ) : (
                        "Belum ada harga"
                      ),
                  },
                  {
                    label: "Laba/rugi terealisasi",
                    value: (
                      <Pnl
                        value={holding.realizedMinor}
                        currency={instrument.currency}
                        exponent={instrument.exponent}
                      />
                    ),
                  },
                ]}
              />
              {holding.opening && (
                <OpeningHistory
                  opening={holding.opening}
                  currency={instrument.currency}
                  exponent={instrument.exponent}
                />
              )}
            </section>

            {/* Kartu 3: Tindakan Transaksi & Harga */}
            <section className="inspector-card inspector-card--actions">
              <div className="inv-inspector-actions">
                <button
                  type="button"
                  className="button-primary"
                  disabled={!canTradeInstrument || refreshing}
                  onClick={() => {
                    close();
                    setForm({
                      mode: "trade",
                      kind: "buy",
                      portfolioId: portfolio.id,
                      instrumentId: instrument.id,
                    });
                  }}
                >
                  Beli
                </button>
                <button
                  type="button"
                  className="finance-secondary"
                  disabled={!canSellInstrument || refreshing}
                  onClick={() => {
                    close();
                    setForm({
                      mode: "trade",
                      kind: "sell",
                      portfolioId: portfolio.id,
                      instrumentId: instrument.id,
                    });
                  }}
                >
                  Jual
                </button>
                <button
                  type="button"
                  className="finance-secondary"
                  disabled={!instrument.isActive || refreshing}
                  onClick={() => {
                    close();
                    setForm({ mode: "price", instrumentId: instrument.id });
                  }}
                >
                  {holding.price ? "Ubah Harga" : "Tambah Harga"}
                </button>
                {snapshot.providerConfigured &&
                  instrument.isActive &&
                  Boolean(instrument.priceSymbol || instrument.symbol) && (
                    <button
                      type="button"
                      className="finance-secondary"
                      disabled={pending || refreshing}
                      onClick={() => {
                        close();
                        void refreshPrice(instrument.id);
                      }}
                    >
                      <ArrowClockwise size={14} aria-hidden="true" />
                      <span>Harga Otomatis</span>
                    </button>
                  )}
                {holding.opening && (
                  <button
                    type="button"
                    className="finance-secondary"
                    disabled={!portfolio.isActive || !instrument.isActive || refreshing}
                    onClick={() => {
                      close();
                      setForm({
                        mode: "opening-correct",
                        portfolioId: portfolio.id,
                        instrumentId: instrument.id,
                        opening: holding.opening!,
                      });
                    }}
                  >
                    Koreksi Posisi Awal
                  </button>
                )}
              </div>
            </section>
          </div>
        ),
      },
      trigger ?? (document.activeElement as HTMLElement | null)
    );
  }

  const primaryTotal = snapshot.totals[0];
  const pCurr = primaryTotal?.currency ?? "IDR";

  const heading = (
    <PageHeading
      title="Portofolio Investasi"
      summary={
        primaryTotal ? (
          <>
            <span>
              Nilai Pasar:{" "}
              <strong>
                {formatMinor(primaryTotal.marketMinor, primaryTotal.currency, primaryTotal.exponent)}
              </strong>
            </span>
            <span aria-hidden="true">|</span>
            <span>
              Modal Pokok:{" "}
              <strong>
                {formatMinor(
                  primaryTotal.costBasisMinor,
                  primaryTotal.currency,
                  primaryTotal.exponent
                )}
              </strong>
            </span>
          </>
        ) : undefined
      }
      actions={
        <>
          <ExportMenuButton dataset="investments" label="Ekspor Portofolio" />
          <button
            type="button"
            className="button-primary"
            disabled={refreshing}
            onClick={() =>
              setForm({
                mode: workflow.canTrade
                  ? "trade"
                  : !snapshot.portfolios.length
                  ? "portfolio"
                  : !snapshot.instruments.length
                  ? "instrument"
                  : "opening",
              })
            }
          >
            <Plus size={16} weight="bold" aria-hidden="true" />
            <span>{workflow.canTrade ? "Catat Beli / Jual" : "Mulai Investasi"}</span>
          </button>
        </>
      }
    />
  );

  // Strip Ringkasan Kompak (Menggantikan 4 Kartu KPI Raksasa & Tidak Terjepit 3 Kolom di Mobile)
  const summaryStrip =
    snapshot.totals.length > 0 ? (
      <div className="investment-kpis">
        {snapshot.totals.map((total) => {
          const money = (value: string) => formatMinor(value, total.currency, total.exponent);
          const unrealizedBig =
            total.unrealizedMinor !== null ? BigInt(total.unrealizedMinor) : null;
          const realizedBig = total.realizedMinor !== null ? BigInt(total.realizedMinor) : null;
          return (
            <div key={total.currency} className="inv-summary-wrap">
              <section
                className="inv-summary-strip"
                aria-label={`Ringkasan investasi ${total.currency}`}
              >
                <div className="inv-summary-cell">
                  <span className="inv-summary-label">Modal Pokok Investasi</span>
                  <strong className="inv-summary-val">{money(total.costBasisMinor)}</strong>
                  <small className="inv-summary-sub">Rata-rata tertimbang · {total.currency}</small>
                </div>
                <div className="inv-summary-cell">
                  <span className="inv-summary-label">Nilai Pasar Saat Ini</span>
                  <strong className="inv-summary-val">{money(total.marketMinor)}</strong>
                  <small className="inv-summary-sub">
                    {snapshot.holdings.length} posisi instrumen aktif
                  </small>
                </div>
                <div className="inv-summary-cell">
                  <span className="inv-summary-label">Unrealized Profit / Loss</span>
                  <strong
                    className={`inv-summary-val ${
                      unrealizedBig !== null && unrealizedBig < 0n
                        ? "pnl-negative"
                        : unrealizedBig !== null && unrealizedBig > 0n
                        ? "pnl-positive"
                        : ""
                    }`}
                  >
                    {total.unrealizedMinor === null
                      ? "Belum ada harga"
                      : `${unrealizedBig! > 0n ? "+" : ""}${money(total.unrealizedMinor)}`}
                  </strong>
                  <small className="inv-summary-sub">Selisih nilai pasar vs modal</small>
                </div>
                <div className="inv-summary-cell">
                  <span className="inv-summary-label">Realized Profit / Loss</span>
                  <strong
                    className={`inv-summary-val ${
                      realizedBig !== null && realizedBig < 0n
                        ? "pnl-negative"
                        : realizedBig !== null && realizedBig > 0n
                        ? "pnl-positive"
                        : ""
                    }`}
                  >
                    {total.realizedMinor === null
                      ? "—"
                      : `${realizedBig! > 0n ? "+" : ""}${money(total.realizedMinor)}`}
                  </strong>
                  <small className="inv-summary-sub">Hasil penjualan tercatat</small>
                </div>
              </section>
              {total.unpricedCount > 0 && (
                <p className="ui-notice" data-tone="warning">
                  {total.unpricedCount} posisi belum memiliki harga pasar. Klik baris instrumen untuk memperbarui harga.
                </p>
              )}
            </div>
          );
        })}
      </div>
    ) : undefined;

  const sortedHoldings = sortNamed(
    snapshot.holdings,
    (holding) =>
      `${snapshot.portfolios.find((p) => p.id === holding.portfolioId)?.displayName ?? ""} ${
        snapshot.instruments.find((i) => i.id === holding.instrumentId)?.displayName ?? ""
      }`,
    (holding) => `${holding.portfolioId}/${holding.instrumentId}`
  );

  // Tab 1: Posisi & Valuasi (Tabel 7->5 Kolom Desktop & Daftar Baris Ajaib/Bibit Mobile)
  const holdingsPanel = (
    <div className="inv-workspace">
      {workflow.stage !== "ready" && workflow.stage !== "price" && (
        <section className="surface investment-onboarding" aria-labelledby="investment-start-title">
          <span className="eyebrow">MULAI DARI SINI</span>
          <h2 id="investment-start-title">
            {workflow.stage === "portfolio"
              ? "Di mana investasi Anda disimpan?"
              : workflow.stage === "instrument"
              ? "Apa yang Anda miliki?"
              : workflow.stage === "ownership"
              ? "Sudah dimiliki atau pembelian baru?"
              : "Lengkapi nilai pasar"}
          </h2>
          <ol className="investment-steps">
            {(["portfolio", "instrument", "ownership", "price"] as const).map((step, index) => {
              const current = ["portfolio", "instrument", "ownership", "price"].indexOf(
                workflow.stage
              );
              return (
                <li
                  key={step}
                  aria-current={workflow.stage === step ? "step" : undefined}
                  data-complete={index < current}
                >
                  <span>{index < current ? <Check size={14} aria-hidden="true" /> : index + 1}</span>
                  {["Portofolio", "Instrumen", "Kepemilikan", "Harga pasar"][index]}
                </li>
              );
            })}
          </ol>
          <div className="investment-row-actions">
            {workflow.stage === "portfolio" && (
              <button
                className="button-primary"
                type="button"
                disabled={refreshing}
                onClick={() => setForm({ mode: "portfolio" })}
              >
                <Plus size={16} /> Buat portofolio
              </button>
            )}
            {workflow.stage === "instrument" && (
              <button
                className="button-primary"
                type="button"
                disabled={refreshing}
                onClick={() =>
                  setForm({ mode: "instrument", portfolioId: workflow.portfolio?.id })
                }
              >
                <Plus size={16} /> Tambah instrumen
              </button>
            )}
            {workflow.stage === "ownership" && (
              <>
                <button
                  className="button-primary"
                  type="button"
                  disabled={refreshing}
                  onClick={() =>
                    setForm({
                      mode: "opening",
                      portfolioId: workflow.portfolio?.id,
                      instrumentId: workflow.instrument?.id,
                    })
                  }
                >
                  Sudah saya miliki (Posisi Awal)
                </button>
                {workflow.canTrade ? (
                  <button
                    className="finance-secondary"
                    type="button"
                    disabled={refreshing}
                    onClick={() =>
                      setForm({
                        mode: "trade",
                        kind: "buy",
                        portfolioId: workflow.portfolio?.id,
                        instrumentId: workflow.instrument?.id,
                      })
                    }
                  >
                    Beli baru
                  </button>
                ) : (
                  <Link className="finance-secondary" href="/assets">
                    Siapkan aset kas untuk membeli
                  </Link>
                )}
              </>
            )}
            {workflow.stage === "price" && (
              <button
                className="button-primary"
                type="button"
                disabled={refreshing}
                onClick={() =>
                  setForm({ mode: "price", instrumentId: workflow.unpriced?.instrumentId })
                }
              >
                Tambahkan harga manual
              </button>
            )}
          </div>
        </section>
      )}

      <div className="inv-toolbar-bar">
        <span className="inv-toolbar-caption">
          Klik baris instrumen untuk membuka rincian valuasi, ubah harga pasar, atau mencatat beli/jual.
        </span>
        <div className="inv-toolbar-actions">
          <button
            type="button"
            className="finance-secondary inv-btn-sm"
            disabled={!hasPair || refreshing}
            onClick={() => setForm({ mode: "opening" })}
          >
            <Plus size={14} weight="bold" aria-hidden="true" />
            <span>Posisi Awal</span>
          </button>
          <button
            type="button"
            className="finance-secondary inv-btn-sm"
            disabled={refreshing}
            onClick={() => setForm({ mode: "instrument" })}
          >
            <Plus size={14} weight="bold" aria-hidden="true" />
            <span>Tambah Instrumen</span>
          </button>
        </div>
      </div>

      {!sortedHoldings.length ? (
        <section className="surface finance-empty">
          <ChartLineUp size={26} />
          <h2>Belum ada posisi instrumen aktif</h2>
          <p>
            Mulai dengan membuat portofolio dan instrumen di tab Platform &amp; Instrumen, lalu catat posisi awal atau transaksi pembelian.
          </p>
        </section>
      ) : (
        <>
          {/* Desktop Adaptive 7->5 Column Table (Zero Horizontal Scroll) */}
          <div className="inv-table-wrap inv-desktop-only">
            <table className="inv-table">
              <thead>
                <tr>
                  <th className="inv-col-name">Instrumen &amp; Platform</th>
                  <th className="inv-col-class inv-col-secondary">Kelas Aset</th>
                  <th className="inv-col-unit inv-text-right">Unit</th>
                  <th className="inv-col-avg inv-col-secondary inv-text-right">Harga Rata-Rata</th>
                  <th className="inv-col-price inv-text-right">Harga Pasar</th>
                  <th className="inv-col-market inv-text-right">Nilai Pasar</th>
                  <th className="inv-col-pnl inv-text-right">Unrealized P/L</th>
                </tr>
              </thead>
              <tbody>
                {sortedHoldings.map((holding) => {
                  const { portfolio, instrument } = identity(holding);
                  const ticker = tickerBadgeText(instrument.symbol, instrument.displayName);
                  const money = (v: string) =>
                    formatMinor(v, instrument.currency, instrument.exponent);
                  const pnlBig =
                    holding.unrealizedMinor !== null ? BigInt(holding.unrealizedMinor) : null;
                  const pnlSign =
                    pnlBig !== null ? (pnlBig > 0n ? "+" : pnlBig < 0n ? "−" : "") : "";
                  const pnlAbs =
                    pnlBig !== null
                      ? pnlBig < 0n
                        ? (-pnlBig).toString()
                        : pnlBig.toString()
                      : null;

                  return (
                    <tr
                      key={`${portfolio.id}/${instrument.id}`}
                      onClick={(e) => openHoldingInspector(holding, e.currentTarget)}
                      title="Klik untuk membuka rincian portofolio & aksi"
                    >
                      <td className="inv-col-name">
                        <div className="inv-instrument-cell">
                          <span className="inv-ticker-badge">{ticker}</span>
                          <div className="inv-instrument-copy">
                            <strong className="inv-truncate">{instrument.displayName}</strong>
                            <span className="inv-sub-truncate">
                              {portfolio.displayName} · Pokok {money(holding.costBasisMinor)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="inv-col-class inv-col-secondary">
                        <Chip tone="info">{instrument.typeName}</Chip>
                      </td>
                      <td className="inv-col-unit inv-text-right inv-tabular">
                        {formatQuantity(holding.quantity)}
                      </td>
                      <td className="inv-col-avg inv-col-secondary inv-text-right inv-tabular">
                        {formatInvestmentPrice(
                          holding.averageCost,
                          instrument.currency,
                          instrument.exponent
                        )}
                      </td>
                      <td className="inv-col-price inv-text-right inv-tabular">
                        {holding.price ? (
                          <span className="inv-price-val">
                            {formatInvestmentPrice(
                              holding.price.price,
                              instrument.currency,
                              instrument.exponent
                            )}
                          </span>
                        ) : (
                          <span className="inv-unpriced-tag">Set Harga</span>
                        )}
                      </td>
                      <td className="inv-col-market inv-text-right inv-tabular">
                        <strong>
                          {holding.marketMinor === null
                            ? "Belum ada harga"
                            : money(holding.marketMinor)}
                        </strong>
                      </td>
                      <td className="inv-col-pnl inv-text-right inv-tabular">
                        {pnlAbs !== null ? (
                          <div className="inv-pnl-inline">
                            <strong
                              className={
                                pnlBig! < 0n
                                  ? "pnl-negative"
                                  : pnlBig! > 0n
                                  ? "pnl-positive"
                                  : ""
                              }
                            >
                              {pnlSign}
                              {money(pnlAbs)}
                            </strong>
                            {holding.unrealizedPercent !== null && (
                              <span
                                className={`inv-pct-pill ${
                                  pnlBig! < 0n
                                    ? "inv-pct-pill--neg"
                                    : pnlBig! > 0n
                                    ? "inv-pct-pill--pos"
                                    : ""
                                }`}
                              >
                                {pnlBig! > 0n ? "+" : ""}
                                {holding.unrealizedPercent}%
                              </span>
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile 2-Sided Compact Holding List (Ajaib / Bibit style from 095853.png) */}
          <div className="inv-mobile-list inv-mobile-only" role="list" aria-label="Daftar kepemilikan investasi">
            {sortedHoldings.map((holding) => {
              const { portfolio, instrument } = identity(holding);
              const ticker = tickerBadgeText(instrument.symbol, instrument.displayName);
              const money = (v: string) =>
                formatMinor(v, instrument.currency, instrument.exponent);
              const pnlBig =
                holding.unrealizedMinor !== null ? BigInt(holding.unrealizedMinor) : null;
              const pnlSign =
                pnlBig !== null ? (pnlBig > 0n ? "+" : pnlBig < 0n ? "−" : "") : "";
              const pnlAbs =
                pnlBig !== null
                  ? pnlBig < 0n
                    ? (-pnlBig).toString()
                    : pnlBig.toString()
                  : null;

              return (
                <div
                  key={`${portfolio.id}/${instrument.id}`}
                  role="listitem"
                  className="inv-mobile-row"
                  onClick={(e) => openHoldingInspector(holding, e.currentTarget)}
                >
                  <div className="inv-mobile-left">
                    <span className="inv-ticker-badge">{ticker}</span>
                    <div className="inv-instrument-copy">
                      <strong className="inv-truncate">{instrument.displayName}</strong>
                      <span className="inv-sub-truncate">
                        {formatQuantity(holding.quantity)} unit · Avg{" "}
                        {formatInvestmentPrice(
                          holding.averageCost,
                          instrument.currency,
                          instrument.exponent
                        )}
                      </span>
                      <span className="inv-sub-truncate">{portfolio.displayName}</span>
                    </div>
                  </div>
                  <div className="inv-mobile-right">
                    <strong className="inv-tabular">
                      {holding.marketMinor === null
                        ? "Belum ada harga"
                        : money(holding.marketMinor)}
                    </strong>
                    {pnlAbs !== null ? (
                      <span
                        className={`inv-mobile-pnl inv-tabular ${
                          pnlBig! < 0n ? "pnl-negative" : pnlBig! > 0n ? "pnl-positive" : ""
                        }`}
                      >
                        {pnlSign}
                        {money(pnlAbs)}
                        {holding.unrealizedPercent !== null
                          ? ` (${pnlBig! > 0n ? "+" : ""}${holding.unrealizedPercent}%)`
                          : ""}
                      </span>
                    ) : (
                      <span className="inv-unpriced-tag">Ketuk set harga</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

  // Tab 2: Riwayat Transaksi Beli & Jual (Tabel Desktop & Baris 2-Sisi Rapi di Mobile)
  const historyPanel = (
    <div className="inv-workspace">
      <div className="inv-toolbar-bar">
        <div className="inv-toolbar-actions">
          <ListSortControl {...tradeSort} />
          <label className="finance-history-toggle">
            <input
              type="checkbox"
              checked={history}
              onChange={(e) => {
                setHistory(e.target.checked);
                setShowMoreTrades(false);
              }}
            />{" "}
            Tampilkan koreksi &amp; pembatalan
          </label>
        </div>
        <ExportMenuButton dataset="investments" label="Ekspor Mutasi" />
      </div>

      {!trades.length ? (
        <section className="surface finance-empty">
          <Receipt size={26} />
          <h2>Belum ada riwayat transaksi investasi</h2>
          <p>Transaksi pembelian dan penjualan instrumen akan tercatat secara kronologis di sini.</p>
        </section>
      ) : (
        <>
          {/* Desktop History Table */}
          <div className="inv-table-wrap inv-desktop-only">
            <table className="inv-table">
              <thead>
                <tr>
                  <th className="inv-col-date">Tanggal</th>
                  <th className="inv-col-name">Instrumen &amp; Portofolio</th>
                  <th className="inv-col-kind">Aksi</th>
                  <th className="inv-col-unit inv-text-right">Unit</th>
                  <th className="inv-col-price inv-col-secondary inv-text-right">Harga / Unit</th>
                  <th className="inv-col-market inv-text-right">Arus Kas</th>
                  <th className="inv-col-status inv-col-secondary">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleTrades.map((trade) => {
                  const instrument = snapshot.instruments.find(
                    (i) => i.id === trade.instrumentId
                  )!;
                  const portfolio = snapshot.portfolios.find((p) => p.id === trade.portfolioId);
                  const cash = investmentCashMinor(trade);
                  const dateStr = new Date(trade.occurredAt).toLocaleDateString("id-ID", {
                    timeZone: "Asia/Jakarta",
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  });
                  return (
                    <tr key={trade.id} onClick={() => openTradeDetails(trade)}>
                      <td className="inv-col-date">{dateStr}</td>
                      <td className="inv-col-name">
                        <strong className="inv-truncate">{instrument.displayName}</strong>
                        <span className="inv-sub-truncate">{portfolio?.displayName}</span>
                      </td>
                      <td className="inv-col-kind">
                        <Chip tone={trade.kind === "buy" ? "info" : "positive"}>
                          {trade.kind === "buy" ? "Beli" : "Jual"}
                        </Chip>
                      </td>
                      <td className="inv-col-unit inv-text-right inv-tabular">
                        {formatQuantity(trade.quantity)}
                      </td>
                      <td className="inv-col-price inv-col-secondary inv-text-right inv-tabular">
                        {formatInvestmentPrice(
                          trade.unitPrice,
                          trade.currency,
                          instrument.exponent
                        )}
                      </td>
                      <td className="inv-col-market inv-text-right inv-tabular">
                        <strong className={trade.kind === "buy" ? "pnl-negative" : "pnl-positive"}>
                          {trade.kind === "buy" ? "−" : "+"}
                          {formatMinor(cash, trade.currency, instrument.exponent)}
                        </strong>
                      </td>
                      <td className="inv-col-status inv-col-secondary">
                        {trade.status === "posted"
                          ? "Aktif"
                          : trade.status === "voided"
                          ? "Dibatalkan"
                          : "Dikoreksi"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile 2-Sided History List (Fixes 095900.png & 095532.png padding/squishing) */}
          <div className="inv-mobile-list inv-mobile-only" role="list" aria-label="Riwayat transaksi investasi">
            {visibleTrades.map((trade) => {
              const instrument = snapshot.instruments.find((i) => i.id === trade.instrumentId)!;
              const portfolio = snapshot.portfolios.find((p) => p.id === trade.portfolioId);
              const cash = investmentCashMinor(trade);
              const dateStr = new Date(trade.occurredAt).toLocaleDateString("id-ID", {
                timeZone: "Asia/Jakarta",
                day: "2-digit",
                month: "short",
                year: "numeric",
              });
              return (
                <div
                  key={trade.id}
                  role="listitem"
                  className="inv-mobile-row"
                  onClick={() => openTradeDetails(trade)}
                >
                  <div className="inv-mobile-left">
                    <span className="inv-ticker-badge">
                      {trade.kind === "buy" ? "BELI" : "JUAL"}
                    </span>
                    <div className="inv-instrument-copy">
                      <strong className="inv-truncate">{instrument.displayName}</strong>
                      <span className="inv-sub-truncate">
                        {dateStr} · {formatQuantity(trade.quantity)} unit
                      </span>
                      <span className="inv-sub-truncate">{portfolio?.displayName}</span>
                    </div>
                  </div>
                  <div className="inv-mobile-right">
                    <strong
                      className={`inv-tabular ${
                        trade.kind === "buy" ? "pnl-negative" : "pnl-positive"
                      }`}
                    >
                      {trade.kind === "buy" ? "−" : "+"}
                      {formatMinor(cash, trade.currency, instrument.exponent)}
                    </strong>
                    <span className="inv-sub-truncate">
                      Kas {trade.kind === "buy" ? "keluar" : "masuk"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {(trades.length > tradeLimit || showMoreTrades) && (
            <button
              type="button"
              className="text-link list-disclosure"
              aria-expanded={showMoreTrades}
              onClick={() => setShowMoreTrades((value) => !value)}
            >
              {showMoreTrades
                ? "Tampilkan lebih sedikit"
                : `Lihat riwayat lainnya (${trades.length - tradeLimit})`}
            </button>
          )}
        </>
      )}
    </div>
  );

  // Tab 3: Platform & Instrumen (Pengelolaan Master Portofolio & Ticker Harga Pasar)
  const marketPanel = (
    <div className="inv-workspace">
      <div className="inv-toolbar-bar">
        <label className="finance-history-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />{" "}
          Tampilkan yang diarsipkan (
          {snapshot.portfolios.filter((p) => !p.isActive).length +
            snapshot.instruments.filter((i) => !i.isActive).length}
          )
        </label>
        <div className="inv-toolbar-actions">
          <button
            type="button"
            className="finance-secondary inv-btn-sm"
            disabled={refreshing}
            onClick={() => setForm({ mode: "portfolio" })}
          >
            <Plus size={14} weight="bold" aria-hidden="true" />
            <span>Tambah Portofolio</span>
          </button>
          <button
            type="button"
            className="button-primary inv-btn-sm"
            disabled={refreshing}
            onClick={() => setForm({ mode: "instrument" })}
          >
            <Plus size={14} weight="bold" aria-hidden="true" />
            <span>Tambah Instrumen</span>
          </button>
        </div>
      </div>

      <div className="investment-management-grid">
        <section className="surface inv-master-card">
          <SectionHeading
            title="Tempat Investasi (Portofolio / RDN)"
            action={
              <button
                type="button"
                className="row-action"
                disabled={refreshing}
                onClick={() => setForm({ mode: "portfolio" })}
              >
                <Plus size={14} /> Tambah
              </button>
            }
          />
          {!snapshot.portfolios.some((p) => showArchived || p.isActive) ? (
            <p className="finance-hint">Belum ada portofolio pada tampilan ini.</p>
          ) : (
            <div className="inv-master-list">
              {snapshot.portfolios
                .filter((p) => showArchived || p.isActive)
                .map((p) => (
                  <div className="inv-master-item" key={p.id}>
                    <div className="inv-master-info">
                      <strong>{p.displayName}</strong>
                      <small>
                        {p.providerName ?? "Tanpa penyedia"} · {p.currency}
                        {!p.isActive ? " · Diarsipkan" : ""}
                      </small>
                    </div>
                    <div className="investment-row-actions">
                      <button
                        type="button"
                        className="row-action"
                        disabled={refreshing}
                        onClick={() =>
                          setForm({
                            mode: "rename",
                            rename: { kind: "portfolio", id: p.id, displayName: p.displayName },
                          })
                        }
                      >
                        <PencilSimple size={14} /> Ubah
                      </button>
                      {!p.isActive && (
                        <>
                          {restoreButton("portfolio", p.id)}
                          {deleteButton("portfolio", p)}
                        </>
                      )}
                      {p.isActive && (
                        <button
                          type="button"
                          className="row-action"
                          data-tone="warning"
                          disabled={refreshing}
                          onClick={() =>
                            setConfirmation({
                              operation: "archive",
                              kind: "portfolio",
                              id: p.id,
                              title: `Arsipkan ${p.displayName}?`,
                              description:
                                "Transaksi baru akan ditolak. Posisi terbuka dan seluruh riwayat tetap terlihat.",
                            })
                          }
                        >
                          Arsipkan
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>

        <section className="surface inv-master-card">
          <SectionHeading
            title="Daftar Instrumen &amp; Harga Pasar"
            action={
              <button
                type="button"
                className="row-action"
                disabled={refreshing}
                onClick={() => setForm({ mode: "instrument" })}
              >
                <Plus size={14} /> Tambah
              </button>
            }
          />
          {!snapshot.instruments.some((i) => showArchived || i.isActive) ? (
            <p className="finance-hint">Belum ada instrumen pada tampilan ini.</p>
          ) : (
            <div className="inv-master-list">
              {snapshot.instruments
                .filter((i) => showArchived || i.isActive)
                .map((i) => (
                  <div className="inv-master-item" key={i.id}>
                    <div className="inv-master-info">
                      <strong>{i.displayName}</strong>
                      <small>
                        {[i.symbol, i.market, i.typeName, i.currency, !i.isActive ? "Diarsipkan" : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </div>
                    <div className="investment-row-actions">
                      {i.isActive && (
                        <button
                          type="button"
                          className="row-action"
                          disabled={refreshing}
                          onClick={() => setForm({ mode: "price", instrumentId: i.id })}
                        >
                          Ubah Harga
                        </button>
                      )}
                      <button
                        type="button"
                        className="row-action"
                        disabled={refreshing}
                        onClick={() =>
                          setForm({
                            mode: "rename",
                            rename: {
                              kind: "instrument",
                              id: i.id,
                              displayName: i.displayName,
                              symbol: i.symbol ?? "",
                              market: i.market ?? "",
                              priceSymbol: i.priceSymbol ?? "",
                            },
                          })
                        }
                      >
                        <PencilSimple size={14} /> Ubah
                      </button>
                      {!i.isActive && (
                        <>
                          {restoreButton("instrument", i.id)}
                          {deleteButton("instrument", i)}
                        </>
                      )}
                      {i.isActive && (
                        <button
                          type="button"
                          className="row-action"
                          data-tone="warning"
                          disabled={refreshing}
                          onClick={() =>
                            setConfirmation({
                              operation: "archive",
                              kind: "instrument",
                              id: i.id,
                              title: `Arsipkan ${i.displayName}?`,
                              description:
                                "Transaksi baru akan ditolak. Posisi yang masih dimiliki tetap dihitung.",
                            })
                          }
                        >
                          Arsipkan
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );

  return (
    <div className="page investment-page">
      <PageTabs
        label="Tampilan Portofolio Investasi"
        heading={heading}
        shared={summaryStrip}
        tabs={[
          { id: "holdings", label: "Posisi & Valuasi", panel: holdingsPanel },
          { id: "history", label: "Riwayat Transaksi", panel: historyPanel },
          { id: "market", label: "Platform & Instrumen", panel: marketPanel },
        ]}
      />

      {error && (
        <p className="finance-error" role="alert">
          {error}
        </p>
      )}

      <ExcelStatusBar
        rowCount={snapshot.holdings.length}
        totalIn={
          primaryTotal
            ? formatMinor(primaryTotal.marketMinor, primaryTotal.currency, primaryTotal.exponent)
            : undefined
        }
        totalOut={
          primaryTotal
            ? formatMinor(primaryTotal.costBasisMinor, primaryTotal.currency, primaryTotal.exponent)
            : undefined
        }
        customNetLabel="Unrealized P/L"
        customNetValue={
          primaryTotal?.unrealizedMinor
            ? formatMinor(
                primaryTotal.unrealizedMinor,
                primaryTotal.currency,
                primaryTotal.exponent
              )
            : undefined
        }
        isNetNegative={
          primaryTotal?.unrealizedMinor ? BigInt(primaryTotal.unrealizedMinor) < 0n : false
        }
        extraLabel={`${pCurr} Mark-to-Market`}
      />

      {selectedTrade && (
        <InvestmentTradeDetails
          workspace={workspace}
          trade={selectedTrade}
          refreshing={refreshing}
          onClose={() => setSelectedTrade(null)}
          onCorrect={() => {
            setSelectedTrade(null);
            setForm({ mode: "trade", trade: selectedTrade });
          }}
          onVoid={() => {
            setSelectedTrade(null);
            setConfirmation({
              operation: "void",
              id: selectedTrade.id,
              title: "Batalkan transaksi investasi?",
              description:
                "Pergerakan kas akan dibalik dan riwayat posisi dihitung ulang. Pembatalan ditolak bila penjualan berikutnya akan kekurangan unit.",
            });
          }}
        />
      )}

      {form && (
        <InvestmentForm
          key={JSON.stringify(form)}
          workspace={workspace}
          state={form}
          onClose={() => setForm(null)}
        />
      )}

      {confirmation && (
        <InvestmentConfirmation action={confirmation} onClose={() => setConfirmation(null)} />
      )}
    </div>
  );
}
