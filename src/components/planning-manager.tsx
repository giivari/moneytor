"use client";

import { sortTemporal, sortNamed } from "@/lib/list-order";
import { orderPlanning, planningSortOptions } from "@/lib/planning/list-order";
import { ListToolbar } from "./list-toolbar";
import { useListPreference, useListSort } from "./use-list-sort";
import { ListOrderControl, ListSortControl } from "./list-sort-control";

import { useRef, useState } from "react";
import { ExportMenuButton } from "./export-menu-button";
import { SectionHeading } from "./section-heading";
import { ResponsiveDisclosure } from "./responsive-disclosure";
import { Archive, ArrowCounterClockwise, CalendarBlank, PencilSimple, PiggyBank, Plus, ShieldCheck, Target } from "@phosphor-icons/react";
import { useFinanceDialog } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { requestJson } from "@/lib/finance/client";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import { horizonDay, planningPosition, type PlanKind, type ReservePurpose } from "@/lib/domain/planning";
import type { PlanningData, PlanningItem, PlanningLabel } from "@/lib/planning/repository";

type Position = { currency: string; exponent: number; liquidMinor: string; eligibleMinor: string };
type Source = { id: string; name: string; currency: string; balanceMinor: string };
const kinds = [
  { kind: "budget", name: "Batas pengeluaran", icon: Target, description: "Pengeluaran nyata terhadap batas." },
  { kind: "goal", name: "Target tabungan", icon: PiggyBank, description: "Kemajuan dari cadangan tertaut." },
  { kind: "reserve", name: "Dana cadangan", icon: ShieldCheck, description: "Sisihkan dana tanpa mengubah saldo aset." },
  { kind: "obligation", name: "Kewajiban", icon: CalendarBlank, description: "Tagihan dan jatuh tempo." },
] as const;
const purposeNames: Record<ReservePurpose,string> = { general: "Umum", emergency: "Darurat", restricted: "Dibatasi", goal: "Untuk target", obligation: "Untuk kewajiban" };
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Perubahan belum dapat disimpan."; }
function fmtDay(day: string) { return new Date(`${day}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }); }
function percent(value: string, target: string) {
  const ratio = BigInt(value) * 100n / BigInt(target);
  return { text: ratio.toString(), width: Number(ratio > 100n ? 100n : ratio) };
}
function usePlanningRequest() {
  const last = useRef<{ signature: string; key: string } | null>(null);
  return async (body: Record<string, unknown>) => {
    const signature = JSON.stringify(body);
    if (last.current?.signature !== signature) last.current = { signature, key: crypto.randomUUID() };
    return requestJson<{ id: string }>("/api/planning", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, idempotencyKey: last.current.key }), cache: "no-store" });
  };
}
function todayFromEnd(throughDay: string) {
  const date = new Date(`${throughDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 30);
  return date.toISOString().slice(0,10);
}

function PlanningForm({ kind, initial, data, sources, positions, today, onClose }: {
  kind: PlanKind; initial?: PlanningItem; data: PlanningData; sources: Source[]; positions: Position[]; today: string; onClose: () => void;
}) {
  const dialog = useFinanceDialog(onClose), send = usePlanningRequest();
  const { refresh, notify } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const [error, setError] = useState("");
  const [name, setName] = useState(initial?.title ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? data.currencies[0]?.code ?? "IDR");
  const exponent = data.currencies.find((row) => row.code === currency)?.exponent ?? 0;
  const [labelId, setLabelId] = useState(initial?.labelId ?? data.labels.find((row) => row.kind === kind && row.isActive)?.id ?? "");
  const [number, setNumber] = useState(initial ? minorToInput(initial.kind === "budget" ? initial.limitMinor : initial.kind === "goal" ? initial.targetMinor : initial.amountMinor, initial.exponent) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [categoryId, setCategoryId] = useState(initial?.kind === "budget" ? initial.categoryId ?? "" : "");
  const monthStart = `${today.slice(0,7)}-01`;
  const nextMonth = new Date(`${monthStart}T00:00:00Z`); nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1);
  const [periodStart, setPeriodStart] = useState(initial?.kind === "budget" ? initial.periodStart : monthStart);
  const [periodEnd, setPeriodEnd] = useState(initial?.kind === "budget" ? initial.periodEnd : nextMonth.toISOString().slice(0,10));
  const [targetOn, setTargetOn] = useState(initial?.kind === "goal" ? initial.targetOn ?? "" : "");
  const [dueOn, setDueOn] = useState(initial?.kind === "obligation" ? initial.dueOn : "");
  const [purpose, setPurpose] = useState<ReservePurpose>(initial?.kind === "reserve" ? initial.purpose : "general");
  const [sourceAssetId, setSourceAssetId] = useState(initial?.kind === "reserve" ? initial.sourceAssetId ?? "" : "");
  const [goalId, setGoalId] = useState(initial?.kind === "reserve" ? initial.goalId ?? "" : "");
  const [obligationId, setObligationId] = useState(initial?.kind === "reserve" ? initial.obligationId ?? "" : "");
  const activeGoals = data.goals.filter((row) => row.isActive && row.currency === currency);
  const openObligations = data.obligations.filter((row) => row.status === "open" && row.currency === currency);
  const eligibleSources = sources.filter((row) => row.currency === currency);
  const currentPosition = positions.find((row) => row.currency === currency);
  let allocationWarning = "";
  if (kind === "reserve" && number) {
    try {
      const current = data.reserves.filter((row) => row.isActive && row.currency === currency && row.id !== initial?.id)
        .reduce((total,row) => total + BigInt(row.amountMinor),0n);
      const proposed = BigInt(inputToMinor(number,exponent));
      if (currentPosition && current + proposed > BigInt(currentPosition.eligibleMinor)) allocationWarning = "Total cadangan melebihi dana yang dapat digunakan. Saldo tidak berubah, tetapi Spendable akan negatif.";
      const source = eligibleSources.find((row) => row.id === sourceAssetId);
      if (source && proposed > BigInt(source.balanceMinor)) allocationWarning = "Cadangan ini melebihi saldo aset sumber. Anda tetap dapat menyimpan; periksa alokasinya.";
    } catch { /* input error is shown on submission */ }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!begin()) return; setError("");
    try {
      const amountMinor = inputToMinor(number,exponent);
      const common = { action: `save-${kind}`,id: initial?.id,version: initial?.version,
        labelId,title: name,currency,note: note || undefined };
      const specific = kind === "budget" ? { limitMinor: amountMinor,periodStart,periodEnd,categoryId: categoryId || undefined }
        : kind === "goal" ? { targetMinor: amountMinor,targetOn: targetOn || undefined }
        : kind === "reserve" ? { amountMinor,purpose,sourceAssetId: sourceAssetId || undefined,
          goalId: purpose === "goal" ? goalId || undefined : undefined,obligationId: purpose === "obligation" ? obligationId || undefined : undefined }
        : { amountMinor,dueOn };
      await send({ ...common,...specific });
      notify(initial ? "Rencana diperbarui." : "Rencana ditambahkan."); refresh(); onClose();
    } catch (cause) { setError(errorMessage(cause)); } finally { finish(); }
  }
  return <dialog ref={dialog} className="finance-dialog planning-dialog" aria-labelledby="planning-form-title" onCancel={(event) => { if (pending) event.preventDefault(); }}>
    <div className="planning-dialog-heading"><h2 id="planning-form-title">{initial ? "Ubah" : "Tambah"} {kinds.find((row) => row.kind === kind)!.name.toLowerCase()}</h2>
      <button type="button" className="finance-secondary" aria-label="Tutup" disabled={pending} onClick={() => dialog.current?.close()}>×</button></div>
    <form onSubmit={(event) => void save(event)}>
      <label className="field"><span>Nama</span><input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <div className="planning-form-grid"><label className="field"><span>Jenis</span><select value={labelId} onChange={(event) => setLabelId(event.target.value)} required>
        {data.labels.filter((row) => row.kind === kind && (row.isActive || row.id === initial?.labelId)).map((row) => <option value={row.id} key={row.id}>{row.displayName}</option>)}</select></label>
        <label className="field"><span>Mata uang</span><select value={currency} disabled={!!initial} onChange={(event) => { setCurrency(event.target.value); setSourceAssetId(""); setGoalId(""); setObligationId(""); }}>
          {data.currencies.map((row) => <option value={row.code} key={row.code}>{row.code}</option>)}</select></label></div>
      <label className="field"><span>{kind === "budget" ? "Batas pengeluaran" : kind === "goal" ? "Target tabungan" : kind === "reserve" ? "Jumlah yang disisihkan" : "Jumlah kewajiban"}</span>
        <input inputMode="decimal" value={number} onChange={(event) => setNumber(event.target.value)} required placeholder="0" /></label>
      {kind === "budget" && <><div className="planning-form-grid"><label className="field"><span>Mulai (termasuk)</span><input type="date" required value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
        <label className="field"><span>Akhir (tidak termasuk)</span><input type="date" required value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label></div>
        <label className="field"><span>Kategori (opsional)</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Semua pengeluaran</option>
          {data.categories.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}
          {initial?.kind === "budget" && initial.categoryId && !data.categories.some((row) => row.id === initial.categoryId) &&
            <option value={initial.categoryId}>{initial.categoryName} · diarsipkan</option>}</select></label></>}
      {kind === "goal" && <label className="field"><span>Tanggal target (opsional)</span><input type="date" value={targetOn} onChange={(event) => setTargetOn(event.target.value)} /></label>}
      {kind === "obligation" && <label className="field"><span>Jatuh tempo</span><input type="date" required value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label>}
      {kind === "reserve" && <><label className="field"><span>Tujuan cadangan</span><select value={purpose} onChange={(event) => { setPurpose(event.target.value as ReservePurpose); setGoalId(""); setObligationId(""); }}>
        {Object.entries(purposeNames).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label className="field"><span>Aset sumber (opsional)</span><select value={sourceAssetId} onChange={(event) => setSourceAssetId(event.target.value)}><option value="">Pool dana {currency}</option>
          {eligibleSources.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        {purpose === "goal" && <label className="field"><span>Target terkait</span><select value={goalId} onChange={(event) => setGoalId(event.target.value)} required><option value="">Pilih target</option>
          {activeGoals.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>}
        {purpose === "obligation" && <label className="field"><span>Kewajiban terkait</span><select value={obligationId} onChange={(event) => setObligationId(event.target.value)} required><option value="">Pilih kewajiban</option>
          {openObligations.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>}
        {allocationWarning && <p className="planning-warning-copy" role="status">{allocationWarning}</p>}</>}
      <label className="field"><span>Catatan (opsional)</span><textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label>
      <p className="finance-hint">{kind === "budget" ? "Batas hanya membandingkan pengeluaran. Tidak ada dana yang disisihkan." : kind === "goal" ? "Kemajuan hanya berasal dari cadangan yang ditautkan." : kind === "reserve" ? "Cadangan mengurangi Spendable tanpa memindahkan uang." : "Menandai selesai tidak mencatat pembayaran. Catat transaksi terpisah."}</p>
      {error && <p className="finance-error" role="alert">{error}</p>}
      <div className="finance-actions"><button type="button" className="finance-secondary" disabled={pending} onClick={() => dialog.current?.close()}>Batal</button>
        <button type="submit" className="button-primary" disabled={pending} aria-busy={pending}>{pending ? <LoadingIndicator>Menyimpan...</LoadingIndicator> : "Simpan"}</button></div>
    </form>
  </dialog>;
}

function ConfirmAction({ item, action, onClose }: { item: PlanningItem; action: "archive" | "settle" | "cancel"; onClose: () => void }) {
  const dialog = useFinanceDialog(onClose), send = usePlanningRequest();
  const { notify,refresh } = useFinanceFeedback(); const { pending,begin,finish } = useMutationPending();
  const [error,setError] = useState("");
  const label = action === "archive" ? item.kind === "reserve" ? "Lepaskan cadangan" : "Arsipkan" : action === "settle" ? "Tandai selesai" : "Batalkan kewajiban";
  async function confirm() {
    if (!begin()) return; setError("");
    try { await send({ action,kind: item.kind,id: item.id,version: item.version });
      notify(action === "archive" ? "Rencana diarsipkan dan dapat dipulihkan." : "Status kewajiban diperbarui."); refresh(); onClose(); }
    catch (cause) { setError(errorMessage(cause)); } finally { finish(); }
  }
  return <dialog ref={dialog} className="security-confirm" aria-labelledby="planning-confirm-title" onCancel={(event) => { if (pending) event.preventDefault(); }}>
    <h2 id="planning-confirm-title">{label} {item.title}?</h2>
    <p>{action === "archive" ? "Rencana tidak lagi memengaruhi ringkasan. Riwayat tetap ada dan dapat dipulihkan." : "Status Planning berubah, tetapi tidak ada transaksi atau saldo aset yang berubah. Cadangan terkait tetap disisihkan sampai dilepaskan."}</p>
    {error && <p className="finance-error" role="alert">{error}</p>}
    <div className="security-confirm-actions"><button autoFocus type="button" className="finance-secondary" disabled={pending} onClick={() => dialog.current?.close()}>Batal</button>
      <button type="button" className={action === "settle" ? "finance-secondary planning-success" : "planning-warning"} disabled={pending} aria-busy={pending} onClick={() => void confirm()}>{pending ? <LoadingIndicator>Menyimpan...</LoadingIndicator> : label}</button></div>
  </dialog>;
}

function LabelManager({ data }: { data: PlanningData }) {
  const send = usePlanningRequest(), { notify,refresh } = useFinanceFeedback(), { pending,begin,finish } = useMutationPending();
  const [kind,setKind] = useState<PlanKind>("budget"), [name,setName] = useState(""), [editing,setEditing] = useState<string | null>(null);
  const [archive,setArchive] = useState<PlanningLabel | null>(null), [error,setError] = useState("");
  async function act(body: Record<string,unknown>, success: string) {
    if (!begin()) return; setError("");
    try { await send(body); notify(success); refresh(); setName(""); setEditing(null); setArchive(null); }
    catch (cause) { setError(errorMessage(cause)); } finally { finish(); }
  }
  return <details className="planning-labels"><summary>Kelola jenis rencana</summary><div className="configuration-grid"><div className="compact-management-body"><p className="finance-hint supporting-prose">Jenis bawaan tersedia; jenis buatan sendiri dapat ditambah, diubah, diarsipkan, dan dipulihkan.</p>
    <label className="field"><span>Kelompok</span><select value={kind} onChange={(event) => { setKind(event.target.value as PlanKind); setName(""); setEditing(null); }}>
      {kinds.map((row) => <option value={row.kind} key={row.kind}>{row.name}</option>)}</select></label>
    <div className="planning-label-list">{data.labels.filter((row) => row.kind === kind).map((row) => <div className="planning-label-row compact-management-item data-list-row data-list-row--actions" key={row.id}><span>{row.displayName} <small>{row.isBuiltIn ? "Bawaan" : row.isActive ? "Kustom" : "Diarsipkan"}</small></span>
      {!row.isBuiltIn && <span className="planning-row-actions compact-management-actions"><button type="button" className="finance-secondary" disabled={pending} onClick={() => { setEditing(row.id); setName(row.displayName); }}>Ubah</button>
        <button type="button" className="finance-secondary" disabled={pending} onClick={() => row.isActive ? setArchive(row) : void act({ action: "label-restore",id: row.id },"Jenis dipulihkan.")}>{pending ? <LoadingIndicator>Memproses...</LoadingIndicator> : row.isActive ? "Arsipkan" : "Pulihkan"}</button></span>}</div>)}</div>
    <form className="planning-label-form compact-form-block" onSubmit={(event) => { event.preventDefault(); void act({ action: "label-save",kind,id: editing ?? undefined,displayName: name },editing ? "Jenis diperbarui." : "Jenis ditambahkan."); }}><div className="inline-field-action">
      <label className="field"><span>{editing ? "Ubah nama jenis" : "Jenis baru"}</span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <button type="submit" className="finance-secondary" disabled={pending} aria-busy={pending}>{pending ? <LoadingIndicator>Menyimpan...</LoadingIndicator> : editing ? "Simpan" : "Tambah jenis"}</button></div>
      {editing && <button type="button" className="finance-text-button" onClick={() => { setEditing(null); setName(""); }}>Batal</button>}</form>
    {archive && <div className="finance-confirm"><p>Arsipkan {archive.displayName}? Jenis tidak tersedia untuk rencana baru, tetapi tetap tercatat dan dapat dipulihkan.</p>
      <button type="button" className="finance-secondary" disabled={pending} onClick={() => setArchive(null)}>Batal</button>
      <button type="button" className="planning-warning" disabled={pending} aria-busy={pending} onClick={() => void act({ action: "label-archive",id: archive.id },"Jenis diarsipkan.")}>{pending ? <LoadingIndicator>Mengarsipkan...</LoadingIndicator> : "Arsipkan"}</button></div>}
    {error && <p className="finance-error" role="alert">{error}</p>}
  </div></div></details>;
}

function PlanRow({ item, today, onEdit, onConfirm, onReactivate, busy }: {
  item: PlanningItem; today: string; onEdit: (item: PlanningItem) => void;
  onConfirm: (item: PlanningItem,action: "archive" | "settle" | "cancel") => void;
  onReactivate: (item: PlanningItem) => void; busy: string | null;
}) {
  const amount = item.kind === "budget" ? item.limitMinor : item.kind === "goal" ? item.targetMinor : item.amountMinor;
  const progress = item.kind === "budget" ? percent(item.spentMinor,item.limitMinor) : item.kind === "goal" ? percent(item.progressMinor,item.targetMinor) : null;
  const state = item.kind === "budget" && BigInt(item.spentMinor) > BigInt(item.limitMinor) ? "over"
    : item.kind === "budget" && BigInt(item.spentMinor)*10n >= BigInt(item.limitMinor)*8n ? "near"
    : item.kind === "obligation" && item.status === "open" && item.dueOn < today ? "over" : "normal";
  const archived = item.kind !== "obligation" && !item.isActive;
  const statusLabel = archived ? item.kind === "reserve" ? "Dilepaskan" : "Diarsipkan"
    : item.kind === "obligation" && item.status !== "open" ? item.status === "settled" ? "Selesai" : "Dibatalkan" : null;
  return <article className="planning-row" data-state={state}><div className="planning-row-main"><div className="planning-row-title"><h3>{item.title}</h3>
      {statusLabel && <span className={`planning-status${item.kind === "obligation" && item.status === "settled" ? " planning-status-positive" : ""}`}>{statusLabel}</span>}</div>
      {item.kind === "reserve" ? <><p>{item.obligationName ? `Untuk ${item.obligationName}` : item.goalName ? `Untuk ${item.goalName}` : purposeNames[item.purpose]}</p>
        <details className="history-detail"><summary>Rincian cadangan</summary>{item.sourceAssetName && <p>Sumber: {item.sourceAssetName}</p>}<p>{item.labelName} · {purposeNames[item.purpose]}</p>{item.goalName && item.obligationName && <p>Target: {item.goalName}</p>}{item.note && <p>{item.note}</p>}</details></> : <>
        <p>{item.labelName}{item.kind === "budget" ? ` · ${fmtDay(item.periodStart)} – ${fmtDay(item.periodEnd)}${item.categoryName ? ` · ${item.categoryName}` : " · Semua pengeluaran"}` :
          item.kind === "goal" ? item.targetOn ? ` · Target ${fmtDay(item.targetOn)}` : "" : ` · Jatuh tempo ${fmtDay(item.dueOn)}`}</p>
        {item.note && <details className="history-detail"><summary>Catatan</summary><p className="planning-note-text">{item.note}</p></details>}</>}
      {progress && <div className="planning-progress" aria-label={`${progress.text}% tercapai`} role="img"><span style={{ width: `${progress.width}%` }} /></div>}
      {item.kind === "budget" && <p>{progress!.text}% terpakai · sisa {formatMinor((BigInt(item.limitMinor)-BigInt(item.spentMinor)).toString(),item.currency,item.exponent)}</p>}
      {item.kind === "goal" && <p>{progress!.text}% terkumpul</p>}
      {item.kind === "obligation" && <p>{item.status === "open"
        ? `Dicadangkan ${formatMinor(item.coveredMinor,item.currency,item.exponent)} · belum tercakup ${formatMinor(item.uncoveredMinor,item.currency,item.exponent)}`
        : item.status === "settled" ? "Selesai — tidak lagi dihitung dalam kewajiban aktif."
        : "Dibatalkan — tidak lagi dihitung dalam kewajiban aktif."}</p>}</div>
    <div className="planning-row-end"><strong className="financial-value financial-value--entity">{formatMinor(amount,item.currency,item.exponent)}</strong>
      <div className="planning-row-actions">{archived ? <button type="button" className="row-action" disabled={busy !== null} aria-busy={busy === item.id} onClick={() => onReactivate(item)}>
        {busy === item.id ? <LoadingIndicator>Memulihkan...</LoadingIndicator> : <><ArrowCounterClockwise size={15} /> Pulihkan</>}</button> : item.kind === "obligation" ? item.status === "open" ? <>
        <button type="button" className="row-action" onClick={() => onEdit(item)}><PencilSimple size={15} /> Ubah</button>
        <button type="button" className="row-action" data-tone="positive" onClick={() => onConfirm(item,"settle")}>Selesai</button>
        <button type="button" className="row-action" data-tone="warning" onClick={() => onConfirm(item,"cancel")}>Batalkan</button></> :
        <button type="button" className="row-action" disabled={busy !== null} aria-busy={busy === item.id} onClick={() => onReactivate(item)}>
          {busy === item.id ? <LoadingIndicator>Membuka...</LoadingIndicator> : <><ArrowCounterClockwise size={15} /> Buka kembali</>}</button> : <>
        <button type="button" className="row-action" onClick={() => onEdit(item)}><PencilSimple size={15} /> Ubah</button>
        <button type="button" className="row-action" data-tone="warning" onClick={() => onConfirm(item,"archive")}><Archive size={15} /> {item.kind === "reserve" ? "Lepaskan" : "Arsipkan"}</button></>}</div></div>
  </article>;
}

export function PlanningManager({ data, positions, sources, throughDay }: {
  data: PlanningData; positions: Position[]; sources: Source[]; throughDay: string;
}) {
  const [horizon,setHorizon] = useState<7 | 30 | 90>(30), [showArchived,setShowArchived] = useState(false);
  const [form,setForm] = useState<{ kind: PlanKind; item?: PlanningItem } | null>(null);
  const [confirm,setConfirm] = useState<{ item: PlanningItem; action: "archive" | "settle" | "cancel" } | null>(null);
  const [busy,setBusy] = useState<string | null>(null), [error,setError] = useState("");
  const send = usePlanningRequest(), { notify,refresh } = useFinanceFeedback();
  const today = todayFromEnd(throughDay), end = horizonDay(today,horizon);
  const budgetSort = useListPreference("planning.budgets.contextual",planningSortOptions.budget.map(option=>option.value),planningSortOptions.budget[0].value);
  const goalSort = useListPreference("planning.goals.contextual",planningSortOptions.goal.map(option=>option.value),planningSortOptions.goal[0].value);
  const reserveSort = useListPreference("planning.reserves.contextual",planningSortOptions.reserve.map(option=>option.value),planningSortOptions.reserve[0].value);
  const obligationSort = useListPreference("planning.obligations.contextual",planningSortOptions.obligation.map(option=>option.value),planningSortOptions.obligation[0].value);
  const obligationHistorySort = useListSort("planning.obligations.history");
  const sorts = { budget: budgetSort, goal: goalSort, reserve: reserveSort, obligation: obligationSort };
  const all: PlanningItem[] = [...data.budgets,...data.goals,...data.reserves,...data.obligations];
  const empty = all.length === 0;
  async function reactivate(item: PlanningItem) {
    if (busy) return; setBusy(item.id); setError("");
    try { await send({ action: item.kind === "obligation" ? "reopen" : "restore",kind: item.kind,id: item.id,version: item.version });
      notify(item.kind === "obligation" ? "Kewajiban dibuka kembali." : "Rencana dipulihkan."); refresh(); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(null); }
  }
  function renderSection({ kind, name, description, icon: Icon }: typeof kinds[number]) {
    const filteredRows: PlanningItem[] = (kind === "budget" ? data.budgets : kind === "goal" ? data.goals : kind === "reserve" ? data.reserves : data.obligations)
      .filter((item) => item.kind === "obligation" || showArchived || item.isActive);
    const sort = sorts[kind];
    const closed = data.obligations.filter(item => item.status !== "open");
    const rows: PlanningItem[] = kind === "obligation" ? [
      ...orderPlanning(data.obligations.filter(item => item.status === "open"),sort.value,today),
      ...sortTemporal(closed, obligationHistorySort.direction, item => item.settledAt ?? item.cancelledAt ?? item.updatedAt, item => item.id),
    ] : orderPlanning(filteredRows,sort.value,today);
    return <section className="surface planning-section" data-kind={kind} key={kind}><SectionHeading title={name} helper={description} icon={<Icon size={21} aria-hidden="true" />}
      action={<button type="button" className="finance-secondary section-add-action" onClick={() => setForm({ kind })}><Plus size={16} /> Tambah</button>} />
      <ListToolbar label={`Urutan ${name}`}><ListOrderControl {...sort} options={planningSortOptions[kind]} />
        {kind === "obligation" && closed.length > 0 && <ListSortControl {...obligationHistorySort} label="Riwayat" />}</ListToolbar>
      {!rows.length ? <p className="planning-empty">Belum ada {name.toLowerCase()} aktif.</p> : <div className="planning-rows">{rows.map((item) => <PlanRow key={item.id} item={item} today={today}
        onEdit={(row) => setForm({ kind: row.kind,item: row })} onConfirm={(row,action) => setConfirm({ item: row,action })}
        onReactivate={(row) => void reactivate(row)} busy={busy} />)}</div>}</section>;
  }
  return <div className="page planning-page"><div className="page-heading finance-heading"><div><span className="eyebrow">RENCANA KEUANGAN</span><h1>Planning</h1>
    <p>Atur batas, target, dana yang disisihkan, dan kewajiban tanpa mengubah saldo aset.</p></div><div className="page-heading-actions"><ExportMenuButton dataset="planning" label="Ekspor Rencana" /></div></div>
    <label className="planning-horizon field"><span>Jangka kewajiban</span><select value={horizon} onChange={(event) => setHorizon(Number(event.target.value) as 7 | 30 | 90)}>
      <option value={7}>7 hari</option><option value={30}>30 hari</option><option value={90}>90 hari</option></select></label>
    <div className="planning-position-grid">{sortNamed(positions, entry => entry.currency, entry => entry.currency).map((entry) => {
      const total = planningPosition(entry.eligibleMinor,entry.currency,data.reserves.filter((row) => row.currency === entry.currency).map((row) => ({
        currency: row.currency,amountMinor: row.amountMinor,isActive: row.isActive,goalId: row.goalId,obligationId: row.obligationId })),
      data.obligations.filter((row) => row.currency === entry.currency).map((row) => ({
        id: row.id,currency: row.currency,amountMinor: row.amountMinor,dueOn: row.dueOn,status: row.status })),end);
      return <section className="surface planning-position" key={entry.currency} data-warning={BigInt(total.spendableMinor)<0n || BigInt(total.availableMinor)<0n}>
        <span className="eyebrow">{entry.currency} · RINGKASAN</span>
        <div className="planning-position-values"><div><span>Dapat digunakan</span><strong className="financial-value financial-value--summary">{formatMinor(total.spendableMinor,entry.currency,entry.exponent)}</strong></div>
          <div><span>Setelah kewajiban {horizon} hari</span><strong className="financial-value financial-value--summary">{formatMinor(total.availableMinor,entry.currency,entry.exponent)}</strong></div></div>
        <ResponsiveDisclosure label="Rincian perhitungan" desktopExpanded className="planning-calculation-details"><div className="planning-breakdown">
          <div><span>Likuid</span><strong>{formatMinor(entry.liquidMinor,entry.currency,entry.exponent)}</strong></div>
          <div><span>Cadangan</span><strong>{formatMinor(total.reservedMinor,entry.currency,entry.exponent)}</strong></div>
          <div><span>Kewajiban jatuh tempo</span><strong>{formatMinor(total.dueMinor,entry.currency,entry.exponent)}</strong></div>
          <div><span>Tercakup cadangan</span><strong>{formatMinor(total.coveredMinor,entry.currency,entry.exponent)}</strong></div>
          <div><span>Belum tercakup</span><strong>{formatMinor(total.uncoveredMinor,entry.currency,entry.exponent)}</strong></div>
        </div></ResponsiveDisclosure>
        {(BigInt(total.spendableMinor)<0n || BigInt(total.availableMinor)<0n) && <p className="planning-warning-copy">Komitmen melebihi dana yang dapat digunakan.</p>}
      </section>;
    })}</div>
    {!positions.length && <p className="planning-intro">Belum ada aset atau komitmen dalam mata uang yang tercatat.</p>}
    <details className="context-help"><summary>Cara menghitung</summary><p className="planning-intro supporting-prose supporting-prose--section">Setiap mata uang dihitung terpisah. Hanya cadangan aktif yang mengurangi dana dapat digunakan; kewajiban terbuka yang jatuh tempo mengurangi sisanya setelah memperhitungkan cadangan terkait. Saldo aset tidak berubah.</p></details>
    {empty ? <section className="surface planning-first-run"><h2>Belum ada perencanaan</h2><p>Pilih yang paling berguna sekarang. Perencanaan tidak wajib untuk menggunakan moneytor.</p>
      <div className="planning-first-actions">{kinds.map((row) => <button type="button" className="finance-secondary" key={row.kind} onClick={() => setForm({ kind: row.kind })}><Plus size={16} /> {row.kind === "reserve" ? "Sisihkan dana" : row.kind === "obligation" ? "Tambah kewajiban" : `Buat ${row.name.toLowerCase()}`}</button>)}</div></section> : <>
      <label className="finance-history-toggle planning-archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Tampilkan yang diarsipkan atau dilepaskan</label>
      <div className="planning-sections">
        <div className="planning-column">{kinds.filter(({ kind }) => kind === "budget" || kind === "reserve").map(renderSection)}</div>
        <div className="planning-column">{kinds.filter(({ kind }) => kind === "goal" || kind === "obligation").map(renderSection)}</div>
      </div></>}
    {error && <p className="finance-error" role="alert">{error}</p>}
    <LabelManager data={data} />
    {form && <PlanningForm key={form.item?.id ?? form.kind} kind={form.kind} initial={form.item} data={data} sources={sources} positions={positions} today={today} onClose={() => setForm(null)} />}
    {confirm && <ConfirmAction key={confirm.item.id + confirm.action} item={confirm.item} action={confirm.action} onClose={() => setConfirm(null)} />}
  </div>;
}
