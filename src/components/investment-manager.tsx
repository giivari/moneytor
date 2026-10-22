"use client";

import { investmentCashMinor } from "@/lib/record-values";
import { sortTemporal, sortNamed } from "@/lib/list-order";
import { useListSort } from "./use-list-sort";
import { ListSortControl } from "./list-sort-control";
import { AppLink as Link } from "@/components/app-link";
import { useRef, useState } from "react";
import { ExportMenuButton } from "./export-menu-button";
import { SectionHeading } from "./section-heading";
import { FinancialDataTable } from "./financial-data-table";
import { ListToolbar } from "./list-toolbar";
import { CompactFinancialRow } from "./compact-financial-row";
import { ResponsiveDisclosure } from "./responsive-disclosure";
import { useMobileViewport } from "./use-mobile-viewport";
import { ArrowLeft, ArrowClockwise, ChartLineUp, Check, PencilSimple, Plus, SpinnerGap, Trash, X } from "@phosphor-icons/react";
import { useFinanceDialog } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import { investmentWorkflow } from "@/lib/investments/workflow";
import { requestJson } from "@/lib/finance/client";
import { decimal, decimalString, replayPosition, tradeCash } from "@/lib/investments/math";
import { formatInvestmentPrice, formatQuantity } from "@/lib/investments/display";
import type { FinanceAsset } from "@/lib/finance/types";
import type { Holding, InvestmentSnapshot, InvestmentTotal, InvestmentTrade, TradeDraft, PricePoint, RecordedOpening, OpeningCorrection } from "@/lib/investments/types";

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
function TotalsData({ total }: { total?: InvestmentTotal }) {
  if (!total) return null;
  return <><dl className="investment-portfolio-values"><div><dt>Nilai pasar berharga</dt><dd>{formatMinor(total.marketMinor, total.currency, total.exponent)}</dd></div><div><dt>Biaya perolehan tersisa</dt><dd>{formatMinor(total.costBasisMinor, total.currency, total.exponent)}</dd></div><div><dt>Belum terealisasi{total.unpricedCount ? " (berharga)" : ""}</dt><dd><Pnl value={total.unrealizedMinor} currency={total.currency} exponent={total.exponent} /></dd></div><div><dt>Terealisasi</dt><dd><Pnl value={total.realizedMinor} currency={total.currency} exponent={total.exponent} /></dd></div></dl>{total.unpricedCount > 0 && <p className="investment-warning">{total.unpricedCount} posisi belum berharga.</p>}</>;
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
    {showHistoryLoader && <p className="inline-disclosure-loading" role="status"><SpinnerGap size={15} className="loading-spinner" aria-hidden="true" /> Memuat riwayat...</p>}
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

export function InvestmentManager(workspace: Workspace) {
  const { snapshot } = workspace;
  const [form, setForm] = useState<FormState | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<InvestmentTrade | null>(null);
  const [history, setHistory] = useState(false);
  const tradeSort = useListSort("investments.history");
  const priceSort = useListSort("investments.prices");
  const [showMoreTrades, setShowMoreTrades] = useState(false);
  const mobile = useMobileViewport();
  const [showArchived, setShowArchived] = useState(false);
  const [pendingTarget, setPendingTarget] = useState("");
  const { pending, begin, finish } = useMutationPending();
  const { notify, refresh, refreshing } = useFinanceFeedback();
  const [error, setError] = useState("");
  const workflow = investmentWorkflow(snapshot, workspace.assets.map((asset) => asset.currency));
  const hasPair = snapshot.portfolios.some((p) => p.isActive && snapshot.instruments.some((i) => i.isActive && i.currency === p.currency));
  const trades = sortTemporal(snapshot.trades.filter((trade) => history || trade.status === "posted"), tradeSort.direction, item => item.occurredAt, item => item.id);
  const tradeLimit = mobile ? 3 : 10;
  const visibleTrades = showMoreTrades ? trades : trades.slice(0, tradeLimit);
  function openTradeDetails(trade: InvestmentTrade) { if (!refreshing) setSelectedTrade(trade); }
  const identity = (holding: Holding) => ({ portfolio: snapshot.portfolios.find((p) => p.id === holding.portfolioId)!, instrument: snapshot.instruments.find((i) => i.id === holding.instrumentId)! });
  async function restore(kind: "portfolio" | "instrument", id: string) {
    if (refreshing || !begin()) return; setError(""); setPendingTarget(id);
    try { await request("restore", { kind, id }); refresh(); notify("Data investasi berhasil dipulihkan."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Data belum dapat dipulihkan."); }
    finally { finish(); }
  }
  function restoreButton(kind: "portfolio" | "instrument", id: string, label = "Pulihkan") {
    return <button type="button" className="row-action" disabled={pending || refreshing} aria-busy={pending && pendingTarget === id} onClick={() => void restore(kind, id)}>{pending && pendingTarget === id ? <LoadingIndicator>Memulihkan...</LoadingIndicator> : label}</button>;
  }
  function deleteButton(kind: "portfolio" | "instrument", item: { id: string; displayName: string; canDelete?: boolean }) {
    return item.canDelete ? <button type="button" className="row-action" data-tone="danger" disabled={pending || refreshing} onClick={() => setConfirmation({ operation: "delete", kind, id: item.id, title: `Hapus permanen ${item.displayName}?`, description: "Data ini belum memiliki referensi atau riwayat. Penghapusan tidak dapat dibatalkan. Server akan memeriksa ulang sebelum menghapus." })}>Hapus permanen</button> : <small className="finance-hint">Memiliki riwayat / referensi; tidak dapat dihapus.</small>;
  }
  async function refreshPrice(instrumentId: string) {
    if (!begin()) return; setError(""); setPendingTarget(instrumentId);
    try { await request("price-refresh", { instrumentId, idempotencyKey: crypto.randomUUID() }); refresh(); notify("Harga berhasil diperbarui."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Harga belum dapat dimuat. Gunakan harga manual."); } finally { finish(); }
  }
  return <div className="page investment-page"><Link className="settings-back" href="/assets"><ArrowLeft size={17} /> Assets</Link><div className="page-heading finance-heading"><div><span className="eyebrow">KEPEMILIKAN & NILAI</span><h1>Investasi</h1></div><div className="page-heading-actions"><ExportMenuButton dataset="investments" label="Ekspor Portofolio" />{workflow.recorded && workflow.canTrade && <button type="button" className="button-primary" disabled={refreshing} onClick={() => setForm({ mode: "trade" })}><Plus size={17} /> Catat transaksi</button>}</div></div>
    {workflow.stage !== "ready" && <section className="surface investment-onboarding" aria-labelledby="investment-start-title">
      <span className="eyebrow">MULAI DARI SINI</span><h2 id="investment-start-title">{workflow.stage === "portfolio" ? "Di mana investasi Anda disimpan?" : workflow.stage === "instrument" ? "Apa yang Anda miliki?" : workflow.stage === "ownership" ? "Sudah dimiliki atau pembelian baru?" : "Lengkapi nilai pasar"}</h2>
      <ol className="investment-steps">{(["portfolio", "instrument", "ownership", "price"] as const).map((step, index) => {
        const current = ["portfolio", "instrument", "ownership", "price"].indexOf(workflow.stage);
        return <li key={step} aria-current={workflow.stage === step ? "step" : undefined} data-complete={index < current}><span>{index < current ? <Check size={14} aria-hidden="true" /> : index + 1}</span>{["Portofolio", "Instrumen", "Kepemilikan", "Harga pasar"][index]}</li>;
      })}</ol>
      <p>{workflow.stage === "portfolio" ? "Buat satu portofolio untuk akun atau tempat menyimpan investasi. Kas tetap dicatat sebagai aset terpisah." : workflow.stage === "instrument" ? "Tambahkan saham, reksa dana, atau instrumen lain dengan mata uang yang sama dengan portofolio." : workflow.stage === "ownership" ? "Posisi awal mencatat investasi yang sudah ada tanpa memindahkan kas. Pembelian baru menggunakan aset kas." : "Unit sudah tercatat. Tambahkan harga per unit dan tanggalnya agar nilai pasar dapat dihitung."}</p>
      <div className="investment-row-actions">
        {workflow.stage === "portfolio" && <button className="button-primary" type="button" disabled={refreshing} onClick={() => setForm({ mode: "portfolio" })}><Plus size={17} /> Buat portofolio</button>}
        {workflow.stage === "instrument" && <button className="button-primary" type="button" disabled={refreshing} onClick={() => setForm({ mode: "instrument", portfolioId: workflow.portfolio?.id })}><Plus size={17} /> Tambah instrumen</button>}
        {workflow.stage === "ownership" && <><button className="button-primary" type="button" disabled={refreshing} onClick={() => setForm({ mode: "opening", portfolioId: workflow.portfolio?.id, instrumentId: workflow.instrument?.id })}>Sudah saya miliki</button>{workflow.canTrade ? <button className="finance-secondary" type="button" disabled={refreshing} onClick={() => setForm({ mode: "trade", kind: "buy", portfolioId: workflow.portfolio?.id, instrumentId: workflow.instrument?.id })}>Beli baru</button> : <Link className="finance-secondary" href="/assets">Siapkan aset kas untuk membeli</Link>}</>}
        {workflow.stage === "price" && <><button className="button-primary" type="button" disabled={refreshing} onClick={() => setForm({ mode: "price", instrumentId: workflow.unpriced?.instrumentId })}>Tambahkan harga manual</button>{snapshot.providerConfigured && workflow.unpriced && Boolean(snapshot.instruments.find((i) => i.id === workflow.unpriced?.instrumentId)?.priceSymbol || snapshot.instruments.find((i) => i.id === workflow.unpriced?.instrumentId)?.symbol) && <button className="finance-secondary" type="button" disabled={pending || refreshing} aria-busy={pending && pendingTarget === workflow.unpriced.instrumentId} onClick={() => void refreshPrice(workflow.unpriced!.instrumentId)}>{pending && pendingTarget === workflow.unpriced.instrumentId ? <LoadingIndicator>Memuat…</LoadingIndicator> : <><ArrowClockwise size={15} /> Harga otomatis</>}</button>}</>}
      </div>
    </section>}
    {error && <p className="finance-error" role="alert">{error}</p>}
    {!!snapshot.totals.length && <div className="investment-totals">{snapshot.totals.map((total) => <section className="surface" key={total.currency}><span className="eyebrow">{total.currency} · POSISI TERCATAT</span>
      <div className="investment-aggregate"><dl className="investment-totals-primary"><div><dt>{mobile ? "Nilai pasar" : "Nilai pasar berharga"}</dt><dd className="financial-value financial-value--summary">{formatMinor(total.marketMinor, total.currency, total.exponent)}</dd></div>
        <div><dt>{mobile ? "Unrealized" : `Laba/rugi belum terealisasi${total.unpricedCount ? " (berharga)" : ""}`}</dt><dd className="financial-value financial-value--summary"><Pnl value={total.unrealizedMinor} currency={total.currency} exponent={total.exponent} /></dd></div></dl>
        <ResponsiveDisclosure label="Rincian portofolio" desktopExpanded className="investment-aggregate-details"><dl className="investment-totals-secondary"><div><dt>Biaya perolehan tersisa</dt><dd>{formatMinor(total.costBasisMinor, total.currency, total.exponent)}</dd></div>
          <div><dt>Laba/rugi terealisasi</dt><dd><Pnl value={total.realizedMinor} currency={total.currency} exponent={total.exponent} /></dd></div></dl></ResponsiveDisclosure></div>
      {total.unpricedCount > 0 && <p className="investment-warning">{total.unpricedCount} posisi belum memiliki harga.</p>}</section>)}</div>}
    {workflow.recorded && <section className="investment-holdings"><SectionHeading title="Posisi instrumen" eyebrow="KEPEMILIKAN" action={<button type="button" className="finance-secondary section-add-action" disabled={!hasPair || refreshing} onClick={() => setForm({ mode: "opening" })}><Plus size={15} /> Posisi awal</button>} />
      {!snapshot.holdings.length ? <div className="finance-empty-inline"><ChartLineUp size={26} /><p>Mulai dengan portofolio dan instrumen di bawah. Catat posisi awal untuk investasi yang sudah dimiliki, atau beli menggunakan aset kas.</p></div> : sortNamed(snapshot.holdings, holding => `${snapshot.portfolios.find(p => p.id === holding.portfolioId)?.displayName ?? ""} ${snapshot.instruments.find(i => i.id === holding.instrumentId)?.displayName ?? ""}`, holding => `${holding.portfolioId}/${holding.instrumentId}`).map((holding) => { const { portfolio, instrument } = identity(holding);
        const priceAction = <button type="button" className="row-action" disabled={!instrument.isActive || refreshing} onClick={() => setForm({ mode: "price", instrumentId: instrument.id })}>{holding.price ? "Ubah harga" : "Tambahkan harga"}</button>;
        const autoPriceAction = snapshot.providerConfigured && instrument.isActive && Boolean(instrument.priceSymbol || instrument.symbol)
          ? <button type="button" className="row-action" disabled={pending || refreshing} aria-busy={pending && pendingTarget === instrument.id} onClick={() => void refreshPrice(instrument.id)}>{pending && pendingTarget === instrument.id ? <LoadingIndicator>Memuat…</LoadingIndicator> : <><ArrowClockwise size={14} /> Harga otomatis</>}</button>
          : null;
        return <article className="surface investment-holding" key={`${portfolio.id}/${instrument.id}`}><div className="investment-holding-heading"><div><strong>{instrument.displayName}</strong><span>{portfolio.displayName} · {instrument.typeName}{!portfolio.isActive || !instrument.isActive ? " · Diarsipkan" : ""}</span></div><span className="investment-units">{formatQuantity(holding.quantity)} unit</span></div>
        <dl className="investment-key-metrics" data-priced={holding.marketMinor !== null}><div data-wide={holding.marketMinor === null || formatMinor(holding.marketMinor,instrument.currency,instrument.exponent).length > 16}><dt>Nilai pasar</dt><dd className="financial-value financial-value--entity">{holding.marketMinor===null?"Belum ada harga pasar":formatMinor(holding.marketMinor, instrument.currency, instrument.exponent)}</dd></div>
          {holding.unrealizedMinor !== null && <div data-wide={formatMinor(holding.unrealizedMinor,instrument.currency,instrument.exponent).length > 16}><dt>{mobile ? "Unrealized P/L" : "Laba/rugi belum terealisasi"}</dt><dd className="financial-value financial-value--entity"><Pnl value={holding.unrealizedMinor} currency={instrument.currency} exponent={instrument.exponent} />{holding.unrealizedPercent !== null && <small>{holding.unrealizedPercent}%</small>}</dd></div>}{(!mobile || holding.marketMinor === null) && <div data-wide={formatMinor(holding.costBasisMinor,instrument.currency,instrument.exponent).length > 16}><dt>Biaya perolehan tersisa</dt><dd className="financial-value financial-value--entity">{formatMinor(holding.costBasisMinor,instrument.currency,instrument.exponent)}</dd></div>}</dl>
        {!mobile && holding.price ? <p className="investment-price-status">Harga pasar / unit <strong className="financial-value financial-value--supporting">{formatInvestmentPrice(holding.price.price, instrument.currency, instrument.exponent)}</strong>{holding.stale && <span className="investment-warning">Harga terakhir &gt;24 jam</span>}</p>
          : null}
        {mobile && holding.price && holding.stale && <p className="investment-warning investment-price-status">Harga terakhir lebih dari 24 jam.</p>}
        {(!portfolio.isActive || !instrument.isActive) && <div className="investment-row-actions">{!portfolio.isActive && restoreButton("portfolio", portfolio.id, "Pulihkan portofolio")}{!instrument.isActive && restoreButton("instrument", instrument.id, "Pulihkan instrumen")}</div>}
        <div className="investment-position-controls"><div className="investment-row-actions investment-trade-actions"><button type="button" className="finance-secondary" disabled={!portfolio.isActive || !instrument.isActive || !workspace.assets.some((a) => a.currency === instrument.currency) || refreshing} onClick={() => setForm({ mode: "trade", portfolioId: portfolio.id, instrumentId: instrument.id })}>Beli</button>
          <button type="button" className="finance-secondary" disabled={!portfolio.isActive || !instrument.isActive || !workspace.assets.some((a) => a.currency === instrument.currency) || decimal(holding.quantity, true) <= 0n || refreshing} onClick={() => setForm({ mode: "trade", kind: "sell", portfolioId: portfolio.id, instrumentId: instrument.id })}>Jual</button>{!mobile && <>{priceAction}{autoPriceAction}</>}</div>
        {mobile && !holding.price && <div className="investment-price-action">{priceAction}{autoPriceAction}</div>}
        <ResponsiveDisclosure label="Rincian posisi" className="investment-position-details">
          <dl className="investment-detail-metrics">
            {mobile && holding.marketMinor !== null && <div><dt>Biaya perolehan tersisa</dt><dd className="financial-value">{formatMinor(holding.costBasisMinor,instrument.currency,instrument.exponent)}</dd></div>}
            {mobile && holding.price && <div><dt>Harga pasar / unit</dt><dd>{formatInvestmentPrice(holding.price.price,instrument.currency,instrument.exponent)}</dd></div>}
            <div><dt>Rata-rata / unit</dt><dd><span title={holding.averageCost}>{formatInvestmentPrice(holding.averageCost, instrument.currency, instrument.exponent)}</span></dd></div>
            <div><dt>Laba/rugi terealisasi</dt><dd><Pnl value={holding.realizedMinor} currency={instrument.currency} exponent={instrument.exponent} /></dd></div></dl>
          {holding.price && <p className="finance-hint">{holding.price.sourceType === "manual" ? "Harga manual" : holding.price.sourceId} · {new Date(holding.price.asOf).toLocaleString("id-ID")}{holding.stale ? " · Lebih dari 24 jam; periksa kembali" : ""}</p>}
          {holding.opening && <p className="finance-hint">Posisi awal {formatQuantity(holding.opening.quantity)} unit · biaya {formatMinor(holding.opening.costBasisMinor, instrument.currency, instrument.exponent)} · {new Date(holding.opening.occurredAt).toLocaleDateString("id-ID")}</p>}
          {holding.opening && <OpeningHistory opening={holding.opening} currency={instrument.currency} exponent={instrument.exponent} />}
          <div className="investment-row-actions">{mobile && holding.price && <>{priceAction}{autoPriceAction}</>}{holding.opening && <button type="button" className="row-action" disabled={!portfolio.isActive || !instrument.isActive || refreshing} onClick={() => setForm({ mode: "opening-correct", portfolioId: portfolio.id, instrumentId: instrument.id, opening: holding.opening! })}>Koreksi posisi awal</button>}
            </div>
        </ResponsiveDisclosure></div>
      </article>; })}
    </section>}
    <details className="investment-management"><summary>Kelola portofolio & instrumen <span>{snapshot.portfolios.length} portofolio / {snapshot.instruments.length} instrumen</span></summary><label className="finance-history-toggle"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Tampilkan yang diarsipkan ({snapshot.portfolios.filter((p) => !p.isActive).length + snapshot.instruments.filter((i) => !i.isActive).length})</label><div className="investment-management-grid"><section className="compact-management-section"><SectionHeading title="Tempat investasi" action={<button type="button" className="finance-secondary section-add-action" disabled={refreshing} onClick={() => setForm({ mode: "portfolio" })}><Plus size={15} /> Tambah</button>} />{!snapshot.portfolios.some((p) => showArchived || p.isActive) && <p className="finance-hint">Belum ada portofolio pada tampilan ini.</p>}{snapshot.portfolios.filter((p) => showArchived || p.isActive).map((p) => <div className="investment-meta-row compact-management-item compact-management-item--stacked" key={p.id}><div className="compact-management-identity"><strong>{p.displayName}</strong><small>{p.providerName ?? "Tanpa penyedia"} · {p.currency}{!p.isActive ? " · Diarsipkan" : ""}</small>{p.note && <small>{p.note}</small>}<div className="management-disclosures"><details className="investment-price-history"><summary>Ringkasan posisi</summary><TotalsData total={snapshot.portfolioTotals.find((total) => total.portfolioId === p.id)} /></details></div></div><div className="investment-row-actions compact-management-actions"><button type="button" className="row-action" disabled={refreshing} onClick={() => setForm({ mode: "rename", rename: { kind: "portfolio", id: p.id, displayName: p.displayName } })}><PencilSimple size={14} /> Ubah</button>{!p.isActive && <>{restoreButton("portfolio", p.id)}{deleteButton("portfolio", p)}</>}{p.isActive && <button type="button" className="row-action" data-tone="warning" disabled={refreshing} onClick={() => setConfirmation({ operation: "archive", kind: "portfolio", id: p.id, title: `Arsipkan ${p.displayName}?`, description: "Transaksi baru akan ditolak. Posisi terbuka dan seluruh riwayat tetap terlihat. Anda dapat memulihkannya nanti." })}>Arsipkan</button>}</div></div>)}</section>
    <section className="compact-management-section"><SectionHeading title="Instrumen" action={<button type="button" className="finance-secondary section-add-action" disabled={refreshing} onClick={() => setForm({ mode: "instrument" })}><Plus size={15} /> Tambah</button>} />{!snapshot.instruments.some((i) => showArchived || i.isActive) && <p className="finance-hint">Belum ada instrumen pada tampilan ini.</p>}{snapshot.instruments.filter((i) => showArchived || i.isActive).map((i) => <div className="investment-meta-row compact-management-item compact-management-item--stacked" key={i.id}><div className="compact-management-identity"><strong>{i.displayName}</strong><small>{[i.symbol, i.market, i.priceSymbol ? `ref: ${i.priceSymbol}` : "", i.typeName, i.currency, !i.isActive ? "Diarsipkan" : ""].filter(Boolean).join(" · ")}</small><div className="management-disclosures"><details className="investment-price-history"><summary>Ringkasan posisi</summary><TotalsData total={snapshot.instrumentTotals.find((total) => total.instrumentId === i.id)} /></details><details className="investment-price-history"><summary>Riwayat harga</summary><ListSortControl {...priceSort} />{sortTemporal(snapshot.prices.filter((p) => p.instrumentId === i.id), priceSort.direction, item => item.asOf, item => item.id).map((p) => { const effective = snapshot.prices.find((point) => point.instrumentId === i.id && point.asOf === p.asOf)?.id === p.id; return <div className="investment-price-entry" key={p.id}><p>{formatInvestmentPrice(p.price, i.currency, i.exponent)} · {new Date(p.asOf).toLocaleString("id-ID")} · {p.sourceType === "manual" ? "manual" : p.sourceId} {effective ? "· Efektif pada waktu ini" : "· Digantikan"}</p>{effective && p.sourceType === "manual" && i.isActive && <button type="button" className="row-action" disabled={pending || refreshing} onClick={() => setForm({ mode: "price-correct", instrumentId: i.id, price: p })}><PencilSimple size={14} /> Koreksi harga</button>}</div>; })}{!snapshot.prices.some((p) => p.instrumentId === i.id) && <p>Belum ada harga.</p>}</details></div></div><div className="investment-row-actions compact-management-actions"><button type="button" className="row-action" disabled={refreshing} onClick={() => setForm({ mode: "rename", rename: { kind: "instrument", id: i.id, displayName: i.displayName, symbol: i.symbol ?? "", market: i.market ?? "", priceSymbol: i.priceSymbol ?? "" } })}><PencilSimple size={14} /> Ubah</button>{!i.isActive && <>{restoreButton("instrument", i.id)}{deleteButton("instrument", i)}</>}{i.isActive && <><button type="button" className="finance-secondary row-action" disabled={refreshing} onClick={() => setForm({ mode: "price", instrumentId: i.id })}>Harga manual</button>{snapshot.providerConfigured && <button type="button" className="finance-secondary row-action" disabled={pending || refreshing} aria-busy={pending && pendingTarget === i.id} onClick={() => void refreshPrice(i.id)}>{pending && pendingTarget === i.id ? <LoadingIndicator>Memuat…</LoadingIndicator> : <><ArrowClockwise size={15} /> Harga otomatis</>}</button>}<button type="button" className="row-action" data-tone="warning" disabled={refreshing} onClick={() => setConfirmation({ operation: "archive", kind: "instrument", id: i.id, title: `Arsipkan ${i.displayName}?`, description: "Transaksi baru akan ditolak. Posisi yang masih dimiliki tetap dihitung dan ditampilkan. Anda dapat memulihkannya nanti." })}>Arsipkan</button></>}</div></div>)}
      <details className="investment-types"><summary>Jenis instrumen</summary><Link className="finance-secondary" href="/settings/catalogs/instrument-types">Kelola jenis & yang diarsipkan</Link><p>{snapshot.instrumentTypes.filter((t) => t.isActive).map((t) => t.displayName).join(" · ")}</p><button type="button" className="finance-secondary" disabled={refreshing} onClick={() => setForm({ mode: "type" })}><Plus size={15} /> Tambah jenis kustom</button></details></section></div></details>
    {snapshot.trades.length > 0 && <section className="surface investment-history"><SectionHeading title="Riwayat investasi" /><ListToolbar label="Filter dan urutan investasi"
        visibility={<><label className="finance-history-toggle"><input type="checkbox" checked={history} onChange={(e) => { setHistory(e.target.checked); setShowMoreTrades(false); }} /> Tampilkan koreksi & pembatalan</label><ExportMenuButton dataset="investments" label="Ekspor Mutasi" /></>}><ListSortControl {...tradeSort} />
      </ListToolbar>
      {!trades.length && <p className="finance-hint">Belum ada transaksi pada tampilan ini.</p>}
      <FinancialDataTable label="Riwayat investasi" records={visibleTrades} identity={trade=>trade.id} rowAction={{ onActivate: openTradeDetails, disabled: refreshing }} columns={[
        {key:"date",heading:"Tanggal",render:trade=><time dateTime={trade.occurredAt}>{new Date(trade.occurredAt).toLocaleString("id-ID",{timeZone:"Asia/Jakarta",day:"numeric",month:"short",year:"numeric"})}</time>},
        {key:"instrument",heading:"Instrumen / aktivitas",render:trade=><><button type="button" className="record-title-button" disabled={refreshing} aria-haspopup="dialog" aria-label={`Buka rincian transaksi: ${trade.kind === "buy" ? "Beli" : "Jual"} ${snapshot.instruments.find(i=>i.id===trade.instrumentId)?.displayName}`} onClick={() => openTradeDetails(trade)}>{snapshot.instruments.find(i=>i.id===trade.instrumentId)?.displayName}</button><small>{trade.kind==="buy"?"Beli":"Jual"} · {snapshot.portfolios.find(p=>p.id===trade.portfolioId)?.displayName}</small></>},
        {key:"units",heading:"Unit",numeric:true,render:trade=><span className="financial-value">{formatQuantity(trade.quantity)}</span>},
        {key:"price",heading:"Harga / unit",numeric:true,secondary:true,render:trade=>formatInvestmentPrice(trade.unitPrice,trade.currency,snapshot.instruments.find(i=>i.id===trade.instrumentId)!.exponent)},
        {key:"value",heading:"Pokok",numeric:true,secondary:true,render:trade=>formatMinor(trade.grossMinor,trade.currency,snapshot.instruments.find(i=>i.id===trade.instrumentId)!.exponent)},
        {key:"cash",heading:"Arus kas",numeric:true,render:trade=><><strong className="financial-value financial-value--row">{trade.kind==="buy"?"−":"+"}{formatMinor(investmentCashMinor(trade),trade.currency,snapshot.instruments.find(i=>i.id===trade.instrumentId)!.exponent)}</strong><small>Kas {trade.kind==="buy"?"keluar":"masuk"} · termasuk biaya</small></>},
        {key:"status",heading:"Status",render:trade=><small>{trade.status==="posted"?"Aktif":trade.status==="voided"?"Dibatalkan":"Dikoreksi"}</small>},
      ]} compact={trade=>{const instrument = snapshot.instruments.find((i) => i.id === trade.instrumentId)!; const cash = investmentCashMinor(trade);return <button type="button" className="transaction-button" disabled={refreshing} aria-haspopup="dialog" aria-label={`Buka rincian transaksi: ${trade.kind === "buy" ? "Beli" : "Jual"} ${instrument.displayName}`} onClick={() => openTradeDetails(trade)}><CompactFinancialRow as="span" presentation="record" wideValue={formatMinor(cash,trade.currency,instrument.exponent).length > 18}
          identity={<>{trade.kind === "buy" ? "Beli" : "Jual"} · {instrument.displayName}</>}
          context={<>{new Date(trade.occurredAt).toLocaleString("id-ID", {timeZone:"Asia/Jakarta",day:"numeric",month:"short",year:"numeric"})} · {formatQuantity(trade.quantity)} unit</>}
          value={<><strong className="financial-value financial-value--row">{formatMinor(cash, trade.currency, instrument.exponent)}</strong><small>kas {trade.kind === "buy" ? "keluar" : "masuk"}</small></>}
          footer={trade.status !== "posted" ? <span>{trade.status === "voided" ? "Dibatalkan" : "Dikoreksi"}</span> : undefined} />
          </button>;}} />
      {(trades.length > tradeLimit || showMoreTrades) && <button type="button" className="text-link list-disclosure" aria-expanded={showMoreTrades} onClick={() => setShowMoreTrades((value) => !value)}>{showMoreTrades ? "Tampilkan lebih sedikit" : `Lihat riwayat lainnya (${trades.length - tradeLimit})`}</button>}
    </section>}
    <details className="context-help"><summary>Cara menghitung investasi</summary>
      {!snapshot.providerConfigured && <p className="investment-provider-note supporting-prose supporting-prose--section">Harga pasar diisi manual beserta tanggalnya. Harga transaksi tidak menggantikan harga pasar.</p>}
      <p className="page-footnote supporting-prose supporting-prose--section">Biaya perolehan menggunakan rata-rata tertimbang. Laba/rugi belum terealisasi (Unrealized) mengikuti harga pasar terakhir; posisi tanpa harga belum masuk nilai pasar dan total aset. Ini pencatatan pribadi, bukan laporan pajak. Nilai lintas mata uang tidak dijumlahkan.</p></details>
    {selectedTrade && <InvestmentTradeDetails workspace={workspace} trade={selectedTrade} refreshing={refreshing} onClose={() => setSelectedTrade(null)}
      onCorrect={() => { setSelectedTrade(null); setForm({ mode: "trade", trade: selectedTrade }); }}
      onVoid={() => { setSelectedTrade(null); setConfirmation({ operation: "void", id: selectedTrade.id, title: "Batalkan transaksi investasi?", description: "Pergerakan kas akan dibalik dan riwayat posisi dihitung ulang. Pembatalan ditolak bila penjualan berikutnya akan kekurangan unit." }); }} />}
    {form && <InvestmentForm key={JSON.stringify(form)} workspace={workspace} state={form} onClose={() => setForm(null)} />}{confirmation && <InvestmentConfirmation action={confirmation} onClose={() => setConfirmation(null)} />}
  </div>;
}
