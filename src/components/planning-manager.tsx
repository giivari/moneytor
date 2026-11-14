"use client";

import { sortTemporal, sortNamed } from "@/lib/list-order";
import { orderPlanning, planningSortOptions } from "@/lib/planning/list-order";
import { ListToolbar } from "./list-toolbar";
import { useListPreference, useListSort } from "./use-list-sort";
import { ListOrderControl, ListSortControl } from "./list-sort-control";

import { useRef, useState } from "react";
import { ExportMenuButton } from "./export-menu-button";
import { SectionHeading } from "./section-heading";
import { InlineCatalogSelect } from "./inline-catalog-select";
import { Archive, ArrowCounterClockwise, CalendarBlank, PencilSimple, PiggyBank, Plus, ShieldCheck, Target } from "@phosphor-icons/react";
import { Amount, Chip, PageHeading } from "./ui";
import { PageTabs } from "./page-tabs";
import { ExcelStatusBar } from "./excel-status-bar";
import { useInspector, useInspectorSync, type InspectorEntry } from "./inspector";
import { InspectorFacts } from "./inspector-facts";
import { useFinanceDialog } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { requestJson } from "@/lib/finance/client";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import { horizonDay, planningPosition, planningToday, type PlanKind, type ReservePurpose } from "@/lib/domain/planning";
import { isDedicatedCategory } from "@/lib/domain/catalog";
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
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [savingLabel, setSavingLabel] = useState(false);
  const [localLabels, setLocalLabels] = useState<{ id: string; displayName: string }[]>([]);
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
      <div className="planning-form-grid"><div className="inline-catalog-select"><label className="field"><span>Jenis</span><select value={labelId} onChange={(event) => {
        if (event.target.value === "__create_new__") { setCreatingLabel(true); return; }
        setLabelId(event.target.value);
      }} required>
        {data.labels.filter((row) => row.kind === kind && (row.isActive || row.id === initial?.labelId)).map((row) => <option value={row.id} key={row.id}>{row.displayName}</option>)}
        {localLabels.filter((created) => !data.labels.some((row) => row.id === created.id)).map((row) => <option value={row.id} key={row.id}>{row.displayName}</option>)}
        <option value="__create_new__">+ Tambah jenis rencana baru…</option></select></label>
        {creatingLabel && <div className="inline-catalog-creator"><div className="inline-field-action"><label className="field"><span>Jenis rencana baru</span><input autoFocus maxLength={120} disabled={savingLabel} value={newLabelName} onChange={(e) => setNewLabelName(e.target.value)} onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (newLabelName.trim() && !savingLabel) { setSavingLabel(true); void send({ action: "label-save", kind, displayName: newLabelName.trim() }).then((res) => { setLocalLabels((prev) => [...prev, { id: res.id, displayName: newLabelName.trim() }]); setLabelId(res.id); setNewLabelName(""); setCreatingLabel(false); notify("Jenis rencana ditambahkan."); refresh(); }).catch((err) => setError(errorMessage(err))).finally(() => setSavingLabel(false)); } }
        }} /></label>
        <button type="button" className="button-primary" disabled={savingLabel || !newLabelName.trim()} onClick={() => { setSavingLabel(true); void send({ action: "label-save", kind, displayName: newLabelName.trim() }).then((res) => { setLocalLabels((prev) => [...prev, { id: res.id, displayName: newLabelName.trim() }]); setLabelId(res.id); setNewLabelName(""); setCreatingLabel(false); notify("Jenis rencana ditambahkan."); refresh(); }).catch((err) => setError(errorMessage(err))).finally(() => setSavingLabel(false)); }}>{savingLabel ? <LoadingIndicator>Menambah…</LoadingIndicator> : "Tambah"}</button>
        <button type="button" className="finance-secondary" disabled={savingLabel} onClick={() => { setCreatingLabel(false); setNewLabelName(""); }}>Batal</button></div></div>}
      </div>
        <label className="field"><span>Mata uang</span><select value={currency} disabled={!!initial} onChange={(event) => { setCurrency(event.target.value); setSourceAssetId(""); setGoalId(""); setObligationId(""); }}>
          {data.currencies.map((row) => <option value={row.code} key={row.code}>{row.code}</option>)}</select></label></div>
      <label className="field"><span>{kind === "budget" ? "Batas pengeluaran" : kind === "goal" ? "Target tabungan" : kind === "reserve" ? "Jumlah yang disisihkan" : "Jumlah kewajiban"}</span>
        <input inputMode="decimal" value={number} onChange={(event) => setNumber(event.target.value)} required placeholder="0" /></label>
      {kind === "budget" && <><div className="planning-form-grid"><label className="field"><span>Mulai (termasuk)</span><input type="date" required value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
        <label className="field"><span>Akhir (tidak termasuk)</span><input type="date" required value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label></div>
        <InlineCatalogSelect
          label="Kategori (opsional)"
          catalog="transactionCategories"
          appliesTo="expense"
          value={categoryId}
          emptyLabel="Semua pengeluaran"
          items={data.categories
            .filter((row) => !isDedicatedCategory({ displayName: row.name }) || (initial?.kind === "budget" && row.id === initial.categoryId))
            .map((row) => ({ id: row.id, displayName: row.name }))}
          extraOptions={initial?.kind === "budget" && initial.categoryId && !data.categories.some((row) => row.id === initial.categoryId)
            ? <option value={initial.categoryId}>{initial.categoryName} · diarsipkan</option>
            : undefined}
          onChange={setCategoryId}
        /></>}
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

function ConfirmAction({ item, action, onClose }: { item: PlanningItem; action: "archive" | "settle" | "cancel" | "delete"; onClose: () => void }) {
  const dialog = useFinanceDialog(onClose), send = usePlanningRequest();
  const { notify,refresh } = useFinanceFeedback(); const { pending,begin,finish } = useMutationPending();
  const [error,setError] = useState("");
  const label = action === "delete" ? "Hapus" : action === "archive" ? item.kind === "reserve" ? "Lepaskan cadangan" : "Arsipkan" : action === "settle" ? "Tandai selesai" : "Batalkan kewajiban";
  async function confirm() {
    if (!begin()) return; setError("");
    try { await send({ action,kind: item.kind,id: item.id,version: item.version });
      notify(action === "delete" ? "Rencana berhasil dihapus." : action === "archive" ? "Rencana diarsipkan dan dapat dipulihkan." : "Status kewajiban diperbarui."); refresh(); onClose(); }
    catch (cause) { setError(errorMessage(cause)); } finally { finish(); }
  }
  return <dialog ref={dialog} className="security-confirm" aria-labelledby="planning-confirm-title" onCancel={(event) => { if (pending) event.preventDefault(); }}>
    <h2 id="planning-confirm-title">{label} {item.title}?</h2>
    <p>{action === "delete" ? "Rencana ini dikeluarkan dari daftar aktif dan cadangannya dilepas. Riwayatnya tetap tersimpan dan dapat dipulihkan." : action === "archive" ? "Rencana tidak lagi memengaruhi ringkasan. Riwayat tetap ada dan dapat dipulihkan." : "Status Planning berubah, tetapi tidak ada transaksi atau saldo aset yang berubah. Cadangan terkait tetap disisihkan sampai dilepaskan."}</p>
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

function safeDailyAllowance(item: PlanningItem, today: string): string | null {
  if (item.kind !== "budget" || !item.isActive) return null;
  const remaining = BigInt(item.limitMinor) - BigInt(item.spentMinor);
  if (remaining <= 0n) return formatMinor("0", item.currency, item.exponent);
  const startMs = new Date(`${today}T00:00:00+07:00`).getTime();
  const endMs = new Date(`${item.periodEnd}T00:00:00+07:00`).getTime();
  const diffDays = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24)));
  const dailyMinor = remaining / BigInt(diffDays);
  return formatMinor(dailyMinor.toString(), item.currency, item.exponent);
}

function PlanRow({
  item,
  today,
  onSelect,
  onEdit,
}: {
  item: PlanningItem;
  today: string;
  onSelect: (item: PlanningItem, trigger: HTMLElement | null) => void;
  onEdit: (item: PlanningItem) => void;
}) {
  const amount =
    item.kind === "budget"
      ? item.limitMinor
      : item.kind === "goal"
      ? item.targetMinor
      : item.amountMinor;
  const progress =
    item.kind === "budget"
      ? percent(item.spentMinor, item.limitMinor)
      : item.kind === "goal"
      ? percent(item.progressMinor, item.targetMinor)
      : null;
  const state =
    item.kind === "budget" && BigInt(item.spentMinor) > BigInt(item.limitMinor)
      ? "over"
      : item.kind === "budget" && BigInt(item.spentMinor) * 10n >= BigInt(item.limitMinor) * 8n
      ? "near"
      : item.kind === "obligation" && item.status === "open" && item.dueOn < today
      ? "over"
      : "normal";
  const archived = item.kind !== "obligation" && !item.isActive;
  const statusLabel = archived
    ? item.kind === "reserve"
      ? "Dilepaskan"
      : "Diarsipkan"
    : item.kind === "obligation" && item.status !== "open"
    ? item.status === "settled"
      ? "Selesai"
      : "Dibatalkan"
    : state === "over"
    ? item.kind === "budget"
      ? "Melebihi Plafon"
      : "Lewat Jatuh Tempo"
    : state === "near"
    ? "Hampir Penuh"
    : null;

  const dailySafe = safeDailyAllowance(item, today);
  const money = (v: string) => formatMinor(v, item.currency, item.exponent);

  return (
    <article
      className="planning-row"
      data-state={state}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button, a, input, select, textarea, summary")) return;
        onSelect(item, e.currentTarget);
      }}
      title="Klik untuk membuka rincian dan tindakan rencana"
    >
      <div className="planning-row-top">
        <div className="planning-row-title-col">
          <button
            type="button"
            className="planning-row-trigger"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item, e.currentTarget);
            }}
          >
            <strong>{item.title}</strong>
          </button>
          <small className="planning-row-sub">
            {item.kind === "reserve" ? (
              <>
                {item.sourceAssetName ? `Rekening: ${item.sourceAssetName} · ` : ""}
                {item.obligationName
                  ? `Untuk ${item.obligationName}`
                  : item.goalName
                  ? `Untuk ${item.goalName}`
                  : purposeNames[item.purpose]}
              </>
            ) : (
              <>
                {item.labelName}
                {item.kind === "budget"
                  ? ` · ${fmtDay(item.periodStart)} – ${fmtDay(item.periodEnd)}${
                      item.categoryName ? ` · ${item.categoryName}` : " · Semua pengeluaran"
                    }`
                  : item.kind === "goal"
                  ? item.targetOn
                    ? ` · Target ${fmtDay(item.targetOn)}`
                    : ""
                  : ` · Jatuh tempo ${fmtDay(item.dueOn)}`}
              </>
            )}
          </small>
        </div>
        <div className="planning-row-amount-col">
          <Amount value={money(amount)} />
          <small>
            {item.kind === "budget"
              ? "Plafon Anggaran"
              : item.kind === "goal"
              ? "Target Tabungan"
              : item.kind === "reserve"
              ? "Dana Dikunci"
              : "Nilai Tagihan"}
          </small>
        </div>
      </div>

      {progress && (
        <div className="planning-row-meter">
          <div
            className="ui-meter"
            data-tone={state === "over" ? "negative" : undefined}
            aria-label={`${progress.text}% tercapai`}
            role="img"
          >
            <span style={{ width: `${Math.min(100, progress.width)}%` }} />
          </div>
        </div>
      )}

      <div className="planning-row-bottom">
        <span className="planning-row-progress-text">
          {item.kind === "budget"
            ? `Terpakai ${money(item.spentMinor)} · Sisa ${money(
                (BigInt(item.limitMinor) - BigInt(item.spentMinor)).toString()
              )}`
            : item.kind === "goal"
            ? `Terkumpul ${money(item.progressMinor)} dari ${money(item.targetMinor)}`
            : item.kind === "obligation"
            ? item.status === "open"
              ? `Dicadangkan ${money(item.coveredMinor)} · Belum tercakup ${money(
                  item.uncoveredMinor
                )}`
              : item.status === "settled"
              ? "Selesai — tidak lagi dihitung dalam kewajiban aktif."
              : "Dibatalkan — tidak lagi dihitung dalam kewajiban aktif."
            : archived
            ? "Cadangan sudah dilepaskan."
            : "Dana disisihkan aktif."}
        </span>
        <div className="planning-row-badges">
          {dailySafe && (
            <span className="planning-daily-allowance">Aman harian {dailySafe}/hari</span>
          )}
          {progress && (
            <Chip
              tone={state === "over" ? "negative" : state === "near" ? "warning" : "info"}
            >
              {progress.text}%
            </Chip>
          )}
          {statusLabel && (
            <Chip
              tone={
                item.kind === "obligation" && item.status === "settled"
                  ? "positive"
                  : state === "over"
                  ? "negative"
                  : "warning"
              }
            >
              {statusLabel}
            </Chip>
          )}
          <div className="planning-row-desktop-actions">
            <button
              type="button"
              className="row-action"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(item);
              }}
            >
              <PencilSimple size={14} /> Ubah
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function PlanningManager({
  data,
  positions,
  sources,
  throughDay,
  creditDebt,
}: {
  data: PlanningData;
  positions: Position[];
  sources: Source[];
  throughDay: string;
  /** Credit bills due inside each horizon (7/30/90 days) per currency, minor units as strings. */
  creditDebt: Record<string, Record<number, string>>;
}) {
  const { open, close } = useInspector();
  useInspectorSync("plan:", data, (id) => [...data.budgets, ...data.goals, ...data.reserves, ...data.obligations]
    .find((item) => `plan:${item.kind}:${item.id}` === id), (item, update) => openPlanInspector(item, null, update));
  const [horizon, setHorizon] = useState<7 | 30 | 90>(30);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<{ kind: PlanKind; item?: PlanningItem } | null>(null);
  const [confirm, setConfirm] = useState<{
    item: PlanningItem;
    action: "archive" | "settle" | "cancel" | "delete";
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const send = usePlanningRequest();
  const { notify, refresh } = useFinanceFeedback();
  const today = planningToday(throughDay);
  const end = horizonDay(today, horizon);

  const budgetSort = useListPreference(
    "planning.budgets.contextual",
    planningSortOptions.budget.map((option) => option.value),
    planningSortOptions.budget[0].value
  );
  const goalSort = useListPreference(
    "planning.goals.contextual",
    planningSortOptions.goal.map((option) => option.value),
    planningSortOptions.goal[0].value
  );
  const reserveSort = useListPreference(
    "planning.reserves.contextual",
    planningSortOptions.reserve.map((option) => option.value),
    planningSortOptions.reserve[0].value
  );
  const obligationSort = useListPreference(
    "planning.obligations.contextual",
    planningSortOptions.obligation.map((option) => option.value),
    planningSortOptions.obligation[0].value
  );
  const obligationHistorySort = useListSort("planning.obligations.history");
  const sorts = {
    budget: budgetSort,
    goal: goalSort,
    reserve: reserveSort,
    obligation: obligationSort,
  };

  const all: PlanningItem[] = [
    ...data.budgets,
    ...data.goals,
    ...data.reserves,
    ...data.obligations,
  ];

  async function reactivate(item: PlanningItem) {
    if (busy) return;
    setBusy(item.id);
    setError("");
    try {
      await send({
        action: item.kind === "obligation" ? "reopen" : "restore",
        kind: item.kind,
        id: item.id,
        version: item.version,
      });
      notify(
        item.kind === "obligation" ? "Kewajiban dibuka kembali." : "Rencana dipulihkan."
      );
      refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  function openPlanInspector(item: PlanningItem, trigger: HTMLElement | null, emit: (entry: InspectorEntry, trigger?: HTMLElement | null) => void = open) {
    const money = (v: string) => formatMinor(v, item.currency, item.exponent);
    const amount =
      item.kind === "budget"
        ? item.limitMinor
        : item.kind === "goal"
        ? item.targetMinor
        : item.amountMinor;
    const archived = item.kind !== "obligation" && !item.isActive;
    const dailySafe = safeDailyAllowance(item, today);
    const kindMeta = kinds.find((k) => k.kind === item.kind)!;

    emit(
      {
        id: `plan:${item.kind}:${item.id}`,
        title: "Rincian Perencanaan",
        subtitle: `${kindMeta.name} · ${item.labelName}`,
        body: (
          <div className="inspector-cards">
            {/* Kartu 1: Ringkasan Hero Rencana */}
            <section className="inspector-card inspector-card--hero">
              <div className="inspector-card-top">
                <span className="inspector-ref-badge">{item.kind.toUpperCase()}</span>
                <Chip tone={archived ? "neutral" : "info"}>{kindMeta.name}</Chip>
              </div>
              <div className="inspector-hero-metric">
                <span className="inspector-hero-caption">
                  {item.kind === "budget"
                    ? "Plafon Anggaran Bulanan"
                    : item.kind === "goal"
                    ? "Target Tabungan"
                    : item.kind === "reserve"
                    ? "Dana Cadangan Terkunci"
                    : "Nominal Kewajiban"}
                </span>
                <div className="inspector-hero-amount">
                  <Amount value={money(amount)} level="summary" />
                </div>
              </div>
              <p className="inspector-hero-title">{item.title}</p>
              <div className="inspector-meta-grid">
                <div>
                  <span className="inspector-meta-label">Kelompok / Jenis</span>
                  <strong className="inspector-meta-value">{item.labelName}</strong>
                </div>
                <div>
                  <span className="inspector-meta-label">Status</span>
                  <strong className="inspector-meta-value">
                    {archived
                      ? "Diarsipkan / Dilepaskan"
                      : item.kind === "obligation"
                      ? item.status === "open"
                        ? "Terbuka"
                        : item.status === "settled"
                        ? "Selesai"
                        : "Dibatalkan"
                      : "Aktif"}
                  </strong>
                </div>
              </div>
            </section>

            {/* Kartu 2: Bedah Realisasi & Alokasi */}
            <section className="inspector-card inspector-card--breakdown">
              <h3 className="inspector-card-heading">Bedah Realisasi &amp; Ketentuan</h3>
              <InspectorFacts
                items={[
                  ...(item.kind === "budget"
                    ? [
                        {
                          label: "Periode anggaran",
                          value: `${fmtDay(item.periodStart)} – ${fmtDay(item.periodEnd)}`,
                        },
                        {
                          label: "Cakupan kategori",
                          value: item.categoryName || "Semua pengeluaran",
                        },
                        { label: "Realisasi terpakai", value: <Amount value={money(item.spentMinor)} /> },
                        {
                          label: "Sisa plafon anggaran",
                          value: (
                            <Amount
                              value={money(
                                (BigInt(item.limitMinor) - BigInt(item.spentMinor)).toString()
                              )}
                              tone={
                                BigInt(item.spentMinor) > BigInt(item.limitMinor)
                                  ? "negative"
                                  : "positive"
                              }
                            />
                          ),
                        },
                      ]
                    : []),
                  ...(item.kind === "goal"
                    ? [
                        {
                          label: "Terkumpul dari cadangan",
                          value: <Amount value={money(item.progressMinor)} tone="positive" />,
                        },
                        {
                          label: "Target tanggal",
                          value: item.targetOn ? fmtDay(item.targetOn) : "Fleksibel",
                        },
                      ]
                    : []),
                  ...(item.kind === "reserve"
                    ? [
                        { label: "Tujuan cadangan", value: purposeNames[item.purpose] },
                        {
                          label: "Rekening sumber",
                          value: item.sourceAssetName || `Pool dana ${item.currency}`,
                        },
                        ...(item.goalName ? [{ label: "Target terkait", value: item.goalName }] : []),
                        ...(item.obligationName
                          ? [{ label: "Kewajiban terkait", value: item.obligationName }]
                          : []),
                      ]
                    : []),
                  ...(item.kind === "obligation"
                    ? [
                        { label: "Tanggal jatuh tempo", value: fmtDay(item.dueOn) },
                        { label: "Sudah dicadangkan", value: <Amount value={money(item.coveredMinor)} /> },
                        {
                          label: "Belum tercakup cadangan",
                          value: (
                            <Amount
                              value={money(item.uncoveredMinor)}
                              tone={BigInt(item.uncoveredMinor) > 0n ? "negative" : ""}
                            />
                          ),
                        },
                      ]
                    : []),
                  ...(item.note ? [{ label: "Catatan", value: item.note }] : []),
                ]}
              />
              {dailySafe && (
                <div className="inspector-highlight-box">
                  <span>Batas Aman Belanja Harian</span>
                  <strong>{dailySafe} / hari</strong>
                </div>
              )}
            </section>

            {/* Kartu 3: Tindakan Rencana */}
            <section className="inspector-card inspector-card--actions">
              <div className="planning-inspector-actions">
                {archived ? (
                  <>
                    <button
                      type="button"
                      className="button-primary"
                      disabled={busy !== null}
                      onClick={() => {
                        close();
                        void reactivate(item);
                      }}
                    >
                      <ArrowCounterClockwise size={14} /> Pulihkan
                    </button>
                    <button
                      type="button"
                      className="finance-danger"
                      onClick={() => {
                        close();
                        setConfirm({ item, action: "delete" });
                      }}
                    >
                      Hapus Permanen
                    </button>
                  </>
                ) : item.kind === "obligation" ? (
                  item.status === "open" ? (
                    <>
                      <button
                        type="button"
                        className="button-primary"
                        onClick={() => {
                          close();
                          setConfirm({ item, action: "settle" });
                        }}
                      >
                        Tandai Selesai
                      </button>
                      <button
                        type="button"
                        className="finance-secondary"
                        onClick={() => {
                          close();
                          setForm({ kind: item.kind, item });
                        }}
                      >
                        <PencilSimple size={14} /> Ubah
                      </button>
                      <button
                        type="button"
                        className="finance-secondary"
                        onClick={() => {
                          close();
                          setConfirm({ item, action: "cancel" });
                        }}
                      >
                        Batalkan
                      </button>
                      <button
                        type="button"
                        className="finance-danger"
                        onClick={() => {
                          close();
                          setConfirm({ item, action: "delete" });
                        }}
                      >
                        Hapus
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="button-primary"
                        disabled={busy !== null}
                        onClick={() => {
                          close();
                          void reactivate(item);
                        }}
                      >
                        <ArrowCounterClockwise size={14} /> Buka Kembali
                      </button>
                      <button
                        type="button"
                        className="finance-danger"
                        onClick={() => {
                          close();
                          setConfirm({ item, action: "delete" });
                        }}
                      >
                        Hapus
                      </button>
                    </>
                  )
                ) : (
                  <>
                    <button
                      type="button"
                      className="button-primary"
                      onClick={() => {
                        close();
                        setForm({ kind: item.kind, item });
                      }}
                    >
                      <PencilSimple size={14} /> Ubah Rencana
                    </button>
                    <button
                      type="button"
                      className="finance-secondary"
                      onClick={() => {
                        close();
                        setConfirm({ item, action: "archive" });
                      }}
                    >
                      <Archive size={14} /> {item.kind === "reserve" ? "Lepaskan Cadangan" : "Arsipkan"}
                    </button>
                    <button
                      type="button"
                      className="finance-danger"
                      onClick={() => {
                        close();
                        setConfirm({ item, action: "delete" });
                      }}
                    >
                      Hapus
                    </button>
                  </>
                )}
              </div>
            </section>
          </div>
        ),
      },
      trigger
    );
  }

  function renderSection({ kind, name, description, icon: Icon }: (typeof kinds)[number]) {
    const filteredRows: PlanningItem[] = (
      kind === "budget"
        ? data.budgets
        : kind === "goal"
        ? data.goals
        : kind === "reserve"
        ? data.reserves
        : data.obligations
    ).filter((item) => item.kind === "obligation" || showArchived || item.isActive);
    const sort = sorts[kind];
    const closed = showArchived ? data.obligations.filter((item) => item.status !== "open") : [];
    const rows: PlanningItem[] =
      kind === "obligation"
        ? [
            ...orderPlanning(
              data.obligations.filter((item) => item.status === "open"),
              sort.value,
              today
            ),
            ...sortTemporal(
              closed,
              obligationHistorySort.direction,
              (item) => item.settledAt ?? item.cancelledAt ?? item.updatedAt,
              (item) => item.id
            ),
          ]
        : orderPlanning(filteredRows, sort.value, today);

    return (
      <section className="surface planning-section" data-kind={kind} key={kind}>
        <SectionHeading
          title={name}
          helper={description}
          icon={<Icon size={20} aria-hidden="true" />}
          action={
            <button
              type="button"
              className="button-primary planning-add-btn"
              onClick={() => setForm({ kind })}
            >
              <Plus size={15} weight="bold" aria-hidden="true" />
              <span>Tambah</span>
            </button>
          }
        />
        <ListToolbar label={`Urutan ${name}`}>
          <ListOrderControl {...sort} options={planningSortOptions[kind]} />
          {kind === "obligation" && closed.length > 0 && (
            <ListSortControl {...obligationHistorySort} label="Riwayat" />
          )}
        </ListToolbar>
        {!rows.length ? (
          <p className="planning-empty">Belum ada {name.toLowerCase()} aktif.</p>
        ) : (
          <div className="planning-rows">
            {rows.map((item) => (
              <PlanRow
                key={item.id}
                item={item}
                today={today}
                onSelect={openPlanInspector}
                onEdit={(row) => setForm({ kind: row.kind, item: row })}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  const primaryPos = positions[0];
  const primaryTotal = primaryPos
    ? planningPosition(
        primaryPos.eligibleMinor,
        primaryPos.currency,
        data.reserves
          .filter((row) => row.currency === primaryPos.currency)
          .map((row) => ({
            currency: row.currency,
            amountMinor: row.amountMinor,
            isActive: row.isActive,
            goalId: row.goalId,
            obligationId: row.obligationId,
          })),
        data.obligations
          .filter((row) => row.currency === primaryPos.currency)
          .map((row) => ({
            id: row.id,
            currency: row.currency,
            amountMinor: row.amountMinor,
            dueOn: row.dueOn,
            status: row.status,
            note: row.note,
          })),
        end,
        creditDebt[primaryPos.currency]?.[horizon] ?? "0"
      )
    : null;

  const totalBudgetLimitBig = data.budgets
    .filter((b) => b.isActive && b.currency === (primaryPos?.currency ?? "IDR"))
    .reduce((sum, b) => sum + BigInt(b.limitMinor), 0n);
  const totalBudgetSpentBig = data.budgets
    .filter((b) => b.isActive && b.currency === (primaryPos?.currency ?? "IDR"))
    .reduce((sum, b) => sum + BigInt(b.spentMinor), 0n);
  const totalBudgetRemainingBig = totalBudgetLimitBig - totalBudgetSpentBig;
  const pCurr = primaryPos?.currency ?? "IDR";
  const pExp = primaryPos?.exponent ?? 0;

  const heading = (
    <PageHeading
      title="Perencanaan"
      summary={
        <>
          <span>
            Plafon Anggaran:{" "}
            <strong>{formatMinor(totalBudgetLimitBig.toString(), pCurr, pExp)}</strong>
          </span>
          <span aria-hidden="true">|</span>
          <span>
            Sisa Plafon:{" "}
            <strong>{formatMinor(totalBudgetRemainingBig.toString(), pCurr, pExp)}</strong>
          </span>
        </>
      }
      actions={
        <>
          <label className="planning-horizon-inline">
            <span>Horizon:</span>
            <select
              value={horizon}
              onChange={(event) => setHorizon(Number(event.target.value) as 7 | 30 | 90)}
              aria-label="Jangka kewajiban"
            >
              <option value={7}>7 Hari</option>
              <option value={30}>30 Hari</option>
              <option value={90}>90 Hari</option>
            </select>
          </label>
          <ExportMenuButton dataset="planning" label="Ekspor Rencana" />
        </>
      }
    />
  );

  const sharedSummaryStrip = (
    <div className="planning-position-grid">
      {sortNamed(
        positions,
        (entry) => entry.currency,
        (entry) => entry.currency
      ).map((entry) => {
        const total = planningPosition(
          entry.eligibleMinor,
          entry.currency,
          data.reserves
            .filter((row) => row.currency === entry.currency)
            .map((row) => ({
              currency: row.currency,
              amountMinor: row.amountMinor,
              isActive: row.isActive,
              goalId: row.goalId,
              obligationId: row.obligationId,
            })),
          data.obligations
            .filter((row) => row.currency === entry.currency)
            .map((row) => ({
              id: row.id,
              currency: row.currency,
              amountMinor: row.amountMinor,
              dueOn: row.dueOn,
              status: row.status,
              note: row.note,
            })),
          end,
          creditDebt[entry.currency]?.[horizon] ?? "0"
        );
        const money = (value: string) => formatMinor(value, entry.currency, entry.exponent);
        const hasWarning =
          BigInt(total.spendableMinor) < 0n || BigInt(total.availableMinor) < 0n;
        return (
          <div className="planning-position" key={entry.currency} data-warning={hasWarning}>
            <section
              className="planning-summary-strip"
              aria-label={`Ringkasan rencana ${entry.currency}`}
            >
              <div className="planning-summary-cell">
                <span className="planning-summary-label">Dapat digunakan</span>
                <strong
                  className={`planning-summary-val ${
                    BigInt(total.spendableMinor) < 0n ? "pnl-negative" : ""
                  }`}
                >
                  {money(total.spendableMinor)}
                </strong>
                <small className="planning-summary-sub">
                  Saldo dipakai {money(entry.eligibleMinor)} − cadangan
                </small>
              </div>
              <div className="planning-summary-cell">
                <span className="planning-summary-label">
                  Setelah kewajiban {horizon} hari
                </span>
                <strong
                  className={`planning-summary-val ${
                    BigInt(total.availableMinor) < 0n ? "pnl-negative" : ""
                  }`}
                >
                  {money(total.availableMinor)}
                </strong>
                <small className="planning-summary-sub">
                  {horizon === 30
                    ? "Sama dengan Dana siap pakai Beranda"
                    : "Termasuk tagihan kredit"}
                </small>
              </div>
              <div className="planning-summary-cell">
                <span className="planning-summary-label">Cadangan aktif</span>
                <strong className="planning-summary-val pnl-positive">
                  {money(total.reservedMinor)}
                </strong>
                <small className="planning-summary-sub">
                  Likuid {money(entry.liquidMinor)} · {entry.currency}
                </small>
              </div>
              <div className="planning-summary-cell">
                <span className="planning-summary-label">Kewajiban belum tercakup</span>
                <strong
                  className={`planning-summary-val ${
                    BigInt(total.uncoveredMinor) > 0n ? "pnl-negative" : ""
                  }`}
                >
                  {money(total.uncoveredMinor)}
                </strong>
                <small className="planning-summary-sub">
                  Jatuh tempo {money(total.dueMinor)} · tercakup {money(total.coveredMinor)}
                </small>
              </div>
            </section>
            {hasWarning && (
              <p className="ui-notice" data-tone="negative">
                Komitmen melebihi dana yang dapat digunakan.
              </p>
            )}
          </div>
        );
      })}
      <div className="planning-controls-row">
        <label className="finance-history-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />{" "}
          Tampilkan rencana yang diarsipkan atau dilepaskan
        </label>
      </div>
    </div>
  );

  // 3 Functional Tabs (No Redundant "Semua" Tab!)
  const tabs = [
    {
      id: "budgets",
      label: "Anggaran Belanja",
      panel: (
        <div className="planning-sections planning-sections--single">
          <div className="planning-column">
            {kinds.filter(({ kind }) => kind === "budget").map(renderSection)}
          </div>
        </div>
      ),
    },
    {
      id: "reserves",
      label: "Dana Cadangan & Target",
      panel: (
        <div className="planning-sections">
          <div className="planning-column">
            {kinds.filter(({ kind }) => kind === "reserve").map(renderSection)}
          </div>
          <div className="planning-column">
            {kinds.filter(({ kind }) => kind === "goal").map(renderSection)}
          </div>
        </div>
      ),
    },
    {
      id: "obligations",
      label: "Tagihan & Kewajiban Rutin",
      panel: (
        <div className="planning-sections planning-sections--single">
          <div className="planning-column">
            {kinds.filter(({ kind }) => kind === "obligation").map(renderSection)}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="page planning-page">
      <PageTabs
        label="Lembar Kerja Perencanaan"
        heading={heading}
        shared={sharedSummaryStrip}
        tabs={tabs}
      />

      {error && (
        <p className="finance-error" role="alert">
          {error}
        </p>
      )}

      <LabelManager data={data} />

      <ExcelStatusBar
        rowCount={
          all.filter((item) =>
            item.kind === "obligation" ? item.status === "open" : item.isActive
          ).length
        }
        totalIn={
          primaryTotal && primaryPos
            ? formatMinor(primaryTotal.reservedMinor, primaryPos.currency, primaryPos.exponent)
            : undefined
        }
        totalOut={
          primaryTotal && primaryPos
            ? formatMinor(primaryTotal.dueMinor, primaryPos.currency, primaryPos.exponent)
            : undefined
        }
        customNetLabel="Dana Siap Pakai"
        customNetValue={
          primaryTotal && primaryPos
            ? formatMinor(primaryTotal.availableMinor, primaryPos.currency, primaryPos.exponent)
            : undefined
        }
        isNetNegative={primaryTotal ? BigInt(primaryTotal.availableMinor) < 0n : false}
      />

      {form && (
        <PlanningForm
          key={form.item?.id ?? form.kind}
          kind={form.kind}
          initial={form.item}
          data={data}
          sources={sources}
          positions={positions}
          today={today}
          onClose={() => setForm(null)}
        />
      )}

      {confirm && (
        <ConfirmAction
          key={confirm.item.id + confirm.action}
          item={confirm.item}
          action={confirm.action}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
