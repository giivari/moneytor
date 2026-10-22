"use client";

import { sortTemporal } from "@/lib/list-order";
import { useListSort } from "./use-list-sort";
import { ListSortControl } from "./list-sort-control";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { AutomationRulesSection } from "./automation-rules-section";
import { SectionHeading } from "./section-heading";
import { CompactFinancialRow } from "./compact-financial-row";
import { AutomationConfirmButton } from "./automation-confirm-button";
import { OptionalChargesEditor } from "./optional-charges-editor";
import { OptionalFormSection } from "./optional-form-section";
import { ResponsiveDisclosure } from "./responsive-disclosure";
import { useMobileViewport } from "./use-mobile-viewport";
import { useProgressiveList } from "./use-progressive-list";
import { LoadingIndicator } from "./loading-indicator";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { loadFinanceOptions, requestJson, type FinanceOptions } from "@/lib/finance/client";
import { formatMinor } from "@/lib/finance/format";
import { jakartaToday, preview } from "@/lib/automation/schedule";
import type { AutomationView, RuleInput } from "@/lib/automation/service";

type Rule = { created_at: string; id: string; title: string; kind: RuleInput["kind"]; amount_mode: RuleInput["amountMode"]; amount_minor: string | null;
  currency_code: string; exponent: number;
  execution_mode: RuleInput["executionMode"]; source_asset_id: string | null; destination_asset_id: string | null; category_id: string | null;
  transfer_fee_minor: string | null; note: string | null; frequency: RuleInput["frequency"]; weekday: number | null; month_day: number | null;
  local_time: string; start_on: string; end_on: string | null; status: "active" | "paused" | "archived";
  source_name: string | null; destination_name: string | null; charges: { typeId: string; amountMinor: string }[] };
type Occurrence = { id: string; rule_title: string; scheduled_at: string; kind: RuleInput["kind"]; amount_mode: RuleInput["amountMode"];
  amount_minor: string | null; status: string; latest_activity_status: string | null; activity_id: string | null; currency_code: string; exponent: number };
const empty = (): RuleInput => ({ title:"",kind:"expense",amountMode:"fixed",amountMinor:"",executionMode:"confirm_before_post",
  sourceAssetId:"",destinationAssetId:"",categoryId:"",transferFeeMinor:"",note:"",charges:[],frequency:"monthly_day",
  monthDay:1,localTime:"09:00",startOn:jakartaToday() });
const kindLabel = { income:"Pemasukan", expense:"Pengeluaran", transfer:"Transfer" };
const weekdayLabel = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
function scheduleLabel(frequency: RuleInput["frequency"], weekday?: number | null, monthDay?: number | null) {
  if (frequency === "daily") return "Setiap hari";
  if (frequency === "weekdays") return "Senin–Jumat";
  if (frequency === "weekly") return `Setiap ${weekdayLabel[weekday ?? 1]}`;
  if (frequency === "monthly_last_day") return "Setiap akhir bulan";
  return `Setiap tanggal ${monthDay ?? 1}`;
}
const statusLabel: Record<string,string> = { active:"Aktif",paused:"Dijeda",archived:"Diarsipkan",upcoming:"Akan datang",due:"Jatuh tempo",
  pending_confirmation:"Perlu konfirmasi",posted:"Tercatat",skipped:"Dilewati",voided:"Dibatalkan",failed:"Gagal",superseded:"Diganti" };
function fromRule(row: Rule): RuleInput {
  return { title:row.title,kind:row.kind,amountMode:row.amount_mode,amountMinor:row.amount_minor ?? "",executionMode:row.execution_mode,
    sourceAssetId:row.source_asset_id ?? "",destinationAssetId:row.destination_asset_id ?? "",categoryId:row.category_id ?? "",
    transferFeeMinor:row.transfer_fee_minor ?? "",note:row.note ?? "",charges:row.charges,frequency:row.frequency,
    weekday:row.weekday,monthDay:row.month_day,localTime:row.local_time.slice(0,5),startOn:row.start_on.slice(0,10),endOn:row.end_on?.slice(0,10) };
}
function mutation(action: string, body: Record<string,unknown> = {}) {
  return requestJson<{ id?: string; ok?: boolean }>("/api/automation",{ method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ action,...body }),cache:"no-store" });
}
export function AutomationManager({ initial, editorRef, showArchivedRules, onArchivedChange }: {
  initial: AutomationView; editorRef: Ref<{ create: () => void }>;
  showArchivedRules: boolean; onArchivedChange: (value: boolean) => void;
}) {
  const { refresh, notify, refreshing } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [rule, setRule] = useState<RuleInput>(empty);
  const [options, setOptions] = useState<FinanceOptions | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [amounts, setAmounts] = useState<Record<string,string>>({});
  const [confirm, setConfirm] = useState<{ action: string; id: string; name: string } | null>(null);
  const [filter, setFilter] = useState<"current" | "history">("current");
  const compactList = useMobileViewport();
  const [chargesEnabled, setChargesEnabled] = useState(false);
  const [transferFeeEnabled, setTransferFeeEnabled] = useState(false);
  const saveKey = useRef(crypto.randomUUID());
  const rules = initial.rules as unknown as Rule[];
  const occurrences = initial.occurrences as unknown as Occurrence[];
  useEffect(() => { if (editing === null || options) return;
    let active = true;
    loadFinanceOptions().then((result) => { if (active) { setOptions(result); setOptionsError(""); } })
      .catch(() => { if (active) setOptionsError("Pilihan belum dapat dimuat. Coba lagi."); });
    return () => { active = false; };
  },[editing,options]);
  function beginEdit(row?: Rule) { saveKey.current = crypto.randomUUID(); setEditing(row?.id ?? "new"); setRule(row ? fromRule(row) : empty()); setChargesEnabled(Boolean(row?.charges.length)); setTransferFeeEnabled(Boolean(row?.transfer_fee_minor)); setError(""); }
  useImperativeHandle(editorRef, () => ({ create: () => { if (!pending && !refreshing) beginEdit(); } }));
  function change<K extends keyof RuleInput>(key: K, value: RuleInput[K]) { setRule((previous) => ({ ...previous,[key]:value })); }
  async function run(action: string, id: string, text: string, payload: Record<string,unknown> = {}) {
    if (refreshing || !begin()) return;
    setBusy(`${action}:${id}`); setError("");
    try { await mutation(action,{ id,...payload }); notify(text); refresh(); setConfirm(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Tindakan gagal."); }
    finally { finish(); setBusy(""); }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (refreshing || !begin()) return;
    setBusy("save"); setError("");
    const submittedRule = { ...rule, charges: rule.kind === "expense" && chargesEnabled ? rule.charges : [],
      transferFeeMinor: rule.kind === "transfer" && transferFeeEnabled ? rule.transferFeeMinor : "" };
    try { await mutation("save",{ id:editing === "new" ? undefined : editing,rule:submittedRule,idempotencyKey:saveKey.current });
      notify(editing === "new" ? "Otomatisasi dibuat." : "Otomatisasi diperbarui."); setEditing(null); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Otomatisasi gagal disimpan."); }
    finally { finish(); setBusy(""); }
  }
  const attentionSort = useListSort("automation.attention");
  const upcomingSort = useListSort("automation.upcoming", "upcoming");
  const historySort = useListSort("automation.history");
  const ruleSort = useListSort("automation.rules");
  const currentOccurrences = occurrences.filter((item) => ["upcoming","due","pending_confirmation","failed"].includes(item.status));
  const attention = sortTemporal(currentOccurrences.filter((item) => ["due","pending_confirmation","failed"].includes(item.status)), attentionSort.direction, item => item.scheduled_at, item => item.id);
  const upcoming = sortTemporal(currentOccurrences.filter((item) => item.status === "upcoming"), upcomingSort.direction, item => item.scheduled_at, item => item.id);
  const history = sortTemporal(occurrences.filter((item) => !["upcoming","due","pending_confirmation","failed"].includes(item.status)), historySort.direction, item => item.scheduled_at, item => item.id);
  const upcomingLimit = compactList ? 2 : 5;
  const increment = compactList ? 5 : 10;
  const upcomingReveal = useProgressiveList(upcoming.length, upcomingLimit, increment);
  const historyReveal = useProgressiveList(history.length, 10, increment);
  const reveal = filter === "current" ? upcomingReveal : historyReveal;
  const visible = filter === "current" ? [...attention,...upcoming.slice(0,upcomingReveal.visibleCount)]
    : history.slice(0,historyReveal.visibleCount);
  const assets = options?.assets.filter((item) => item.isActive) ?? [];
  const selectedAsset = assets.find((item) => item.id === (rule.sourceAssetId || rule.destinationAssetId));
  const canPreview = Boolean(rule.startOn && rule.localTime && (rule.frequency !== "weekly" || rule.weekday) && (rule.frequency !== "monthly_day" || rule.monthDay));
  let dates: string[] = [];
  if (canPreview) try { dates = preview(rule,jakartaToday(),5); } catch { /* incomplete form */ }
  const cadence = scheduleLabel(rule.frequency,rule.weekday,rule.monthDay);
  let previewAmount = "Nominal dikonfirmasi sebelum dicatat";
  if (rule.amountMode === "fixed" && rule.amountMinor && selectedAsset) try {
    previewAmount = formatMinor(rule.amountMinor,selectedAsset.currency,selectedAsset.exponent);
  } catch { previewAmount = "Jumlah belum valid"; }
  return <>
    {!initial.ready ? <section className="surface"><h2>Belum diaktifkan</h2><p>Migrasi 008 diperlukan sebelum otomatisasi dapat digunakan.</p></section> : <div className="automation-content">
    <section className="surface automation-occurrences" aria-label="Aktivitas jadwal berulang"><SectionHeading title="Aktivitas" />
      <div className="filter-row" role="group" aria-label="Filter aktivitas jadwal"><button type="button" aria-pressed={filter === "current"} className={`filter-chip ${filter === "current" ? "active" : ""}`} onClick={() => setFilter("current")}>Mendatang & perlu perhatian</button>
        <button type="button" aria-pressed={filter === "history"} className={`filter-chip ${filter === "history" ? "active" : ""}`} onClick={() => setFilter("history")}>Riwayat</button></div>
      <div className="list-utilities">{filter === "current" ? <><ListSortControl {...attentionSort} label="Perlu perhatian" /><ListSortControl {...upcomingSort} mode="upcoming" /></> : <ListSortControl {...historySort} />}</div>
      {visible.length === 0 ? <p className="finance-empty-inline">{filter === "current" ? "Tidak ada jadwal yang perlu perhatian saat ini." : "Belum ada riwayat jadwal."}</p> :
        <div className="automation-occurrence-list" id="automation-occurrence-list">{visible.map((item) => { const state = item.activity_id && item.latest_activity_status === "voided" ? "voided" : item.status;
          const canPost = ["pending_confirmation","failed","due"].includes(state);
          const needsAmount = item.amount_mode === "confirm_amount" && !item.amount_minor;
          return <div className="automation-occurrence" key={item.id}><CompactFinancialRow desktopLayout={canPost ? "confirmation" : "inline"} identity={item.rule_title}
            context={<>{new Date(item.scheduled_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta",dateStyle:"medium",timeStyle:"short"})} WIB · {kindLabel[item.kind]}</>}
            value={item.amount_minor ? <span className="financial-value financial-value--row">{formatMinor(item.amount_minor,item.currency_code,item.exponent)}</span> : !canPost ? <span>Nominal perlu dikonfirmasi</span> : null}
            footer={<span className={`automation-status ${state}`}>{statusLabel[state] ?? state}</span>}
            amountControl={needsAmount ? <label className="field"><span>Nominal ({item.currency_code})</span><input inputMode="numeric" value={amounts[item.id] ?? ""} onChange={(event) => setAmounts((previous) => ({...previous,[item.id]:event.target.value}))} placeholder="Satuan terkecil" /></label> : undefined}
            controls={canPost ? <AutomationConfirmButton disabled={pending || refreshing} onClick={() => run("post",item.id,"Transaksi berhasil dicatat.",{amountMinor:amounts[item.id]})}>{busy === `post:${item.id}` ? <LoadingIndicator>Mencatat...</LoadingIndicator> : item.status === "failed" ? "Coba lagi" : undefined}</AutomationConfirmButton> : undefined}
            secondaryActions={canPost || state === "upcoming" || state === "posted" ? <>{(canPost || state === "upcoming") && <button type="button" className="row-action" data-tone="warning" disabled={pending || refreshing} onClick={() => { setError(""); setConfirm({action:"skip",id:item.id,name:item.rule_title}); }}>Lewati</button>}{state === "posted" && <button type="button" className="finance-danger" disabled={pending || refreshing} onClick={() => { setError(""); setConfirm({action:"void",id:item.id,name:item.rule_title}); }}>Batalkan transaksi</button>}</> : undefined} /></div>; })}</div>}
      {(reveal.canShowMore || reveal.canCollapse) && <div className="list-reveal">
        {reveal.canShowMore && <div className="list-reveal-more">
          <button type="button" className="text-link list-disclosure" aria-controls="automation-occurrence-list" aria-expanded={reveal.canCollapse}
            onClick={reveal.showMore}>Tampilkan {reveal.nextBatchCount} lagi <ArrowDown size={15} aria-hidden="true" /></button>
          <span className="list-reveal-remaining" aria-live="polite">{reveal.hiddenCount} tersisa</span>
        </div>}
        {reveal.canCollapse && <button type="button" className="text-link list-disclosure list-disclosure--quiet"
          aria-controls="automation-occurrence-list" aria-expanded={reveal.canCollapse} onClick={reveal.collapse}>
          Tampilkan lebih sedikit <ArrowUp size={15} aria-hidden="true" />
        </button>}
      </div>}
      <details className="context-help"><summary>Tentang jadwal transaksi</summary><p className="finance-hint supporting-prose supporting-prose--section">Transaksi yang sudah dicatat dapat dikoreksi di Transactions. Pembatalan tetap menyimpan riwayat dan membalik pergerakan ledger.</p></details></section>
    <AutomationRulesSection archived={showArchivedRules} onArchivedChange={onArchivedChange}><ListSortControl {...ruleSort} />
    {rules.filter((item) => showArchivedRules ? item.status === "archived" : item.status !== "archived").length === 0 ? <p className="finance-empty-inline">{showArchivedRules ? "Belum ada aturan yang diarsipkan." : "Belum ada aturan jadwal berulang."}</p> :
      <div className="automation-rule-list">{sortTemporal(rules.filter((item) => showArchivedRules ? item.status === "archived" : item.status !== "archived"), ruleSort.direction, item => item.created_at, item => item.id).map((item) => <article className="surface automation-rule" key={item.id}>
        <div className="automation-rule-heading"><div><h3>{item.title}</h3><p>{kindLabel[item.kind]} · {item.source_name || item.destination_name}</p></div>
          <span className={`automation-status ${item.status}`}>{statusLabel[item.status]}</span></div>
        <p className="automation-rule-schedule">{scheduleLabel(item.frequency,item.weekday,item.month_day)} · {item.local_time.slice(0,5)} WIB</p>
        <p className="automation-rule-meta"><strong className={item.amount_mode === "fixed" && item.amount_minor ? "financial-value financial-value--row" : ""}>{item.amount_mode === "fixed" && item.amount_minor ? formatMinor(item.amount_minor,item.currency_code,item.exponent) : "Nominal perlu dikonfirmasi"}</strong><span>{item.execution_mode === "auto_post" ? "Catat otomatis" : "Perlu konfirmasi"}</span></p>
        <ResponsiveDisclosure label="Kelola otomatisasi" className="history-detail compact-management-controls"><div className="finance-actions compact-management-actions"><button type="button" className="row-action" disabled={pending || refreshing} onClick={() => beginEdit(item)}>Ubah</button>
          {item.status === "active" ? <button type="button" className="row-action" disabled={pending || refreshing} onClick={() => run("pause",item.id,"Otomatisasi dijeda.")}>{busy === `pause:${item.id}` ? <LoadingIndicator>Menjeda...</LoadingIndicator> : "Jeda"}</button> :
            <button type="button" className="row-action" disabled={pending || refreshing} onClick={() => run(item.status === "archived" ? "restore" : "resume",item.id,"Otomatisasi aktif kembali.")}>{busy.endsWith(`:${item.id}`) ? <LoadingIndicator>Memulihkan...</LoadingIndicator> : item.status === "archived" ? "Pulihkan" : "Lanjutkan"}</button>}
          {item.status !== "archived" && <button type="button" className="row-action" data-tone="warning" disabled={pending || refreshing} onClick={() => { setError(""); setConfirm({action:"archive",id:item.id,name:item.title}); }}>Arsipkan</button>}</div></ResponsiveDisclosure>
      </article>)}</div>}</AutomationRulesSection></div>}
    {error && !confirm && editing === null && <p role="alert" className="finance-error">{error}</p>}
    {confirm && <div className="dialog-backdrop"><section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="automation-confirm-title" aria-busy={pending}>
      <div className="dialog-heading"><h2 id="automation-confirm-title">{confirm.action === "archive" ? "Arsipkan otomatisasi?" : confirm.action === "skip" ? "Lewati jadwal ini?" : "Batalkan transaksi?"}</h2></div>
      <p>{confirm.action === "archive" ? `“${confirm.name}” tidak lagi menjalankan jadwal. Kamu dapat memulihkannya.` : confirm.action === "skip" ? `Instansi “${confirm.name}” ini dilewati tanpa mencatat transaksi.` : "Pergerakan transaksi akan dibalik. Riwayat tetap tersimpan."}</p>
      <div className="finance-actions"><button type="button" className="finance-secondary" disabled={pending} onClick={() => setConfirm(null)}>Kembali</button>
        <button type="button" className={confirm.action === "void" ? "finance-danger" : "finance-warning"} disabled={pending}
          onClick={() => run(confirm.action,confirm.id,confirm.action === "archive" ? "Otomatisasi diarsipkan." : confirm.action === "skip" ? "Jadwal dilewati." : "Transaksi dibatalkan.")}>{busy === `${confirm.action}:${confirm.id}` ? <LoadingIndicator>{confirm.action === "archive" ? "Mengarsipkan..." : confirm.action === "skip" ? "Melewati..." : "Membatalkan..."}</LoadingIndicator> : "Ya, lanjutkan"}</button></div>
      {error && <p role="alert" className="finance-error">{error}</p>}
    </section></div>}
    {editing !== null && <div className="dialog-backdrop"><section className="detail-dialog automation-dialog" role="dialog" aria-modal="true" aria-labelledby="automation-editor-title" aria-busy={pending}>
      <div className="dialog-heading"><div><span className="eyebrow">TEMPLATE & JADWAL</span><h2 id="automation-editor-title">{editing === "new" ? "Tambah otomatisasi" : "Ubah otomatisasi"}</h2></div>
        <button type="button" className="icon-button" disabled={pending} aria-label="Tutup" onClick={() => setEditing(null)}>×</button></div>
      {!options ? <div className="automation-options-state">{optionsError ? <><p role="alert">{optionsError}</p><button type="button" className="finance-secondary" onClick={() => { setOptionsError(""); loadFinanceOptions().then(setOptions).catch(() => setOptionsError("Pilihan belum dapat dimuat. Coba lagi.")); }}>Coba lagi</button></> : <LoadingIndicator>Memuat pilihan...</LoadingIndicator>}</div> :
      <form onSubmit={save} className="automation-form"><label className="field"><span>Nama</span><input autoFocus required maxLength={120} value={rule.title} onChange={(e) => change("title",e.target.value)} placeholder="Mis. Sewa bulanan" /></label>
        <div className="automation-form-pair"><label className="field"><span>Jenis</span><select value={rule.kind} onChange={(e) => {
          const kind = e.target.value as RuleInput["kind"];
          setChargesEnabled(false); setTransferFeeEnabled(false);
          setRule((previous) => ({...previous,kind,sourceAssetId:"",destinationAssetId:"",categoryId:"",charges:[],transferFeeMinor:""}));
        }}><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option><option value="transfer">Transfer</option></select></label>
          <label className="field"><span>Jumlah</span><select value={rule.amountMode} onChange={(e) => setRule((previous) => ({...previous,amountMode:e.target.value as RuleInput["amountMode"],executionMode:e.target.value === "confirm_amount" ? "confirm_before_post" : previous.executionMode,amountMinor:e.target.value === "confirm_amount" ? "" : previous.amountMinor}))}><option value="fixed">Tetap</option><option value="confirm_amount">Konfirmasi jumlah</option></select></label></div>
        {rule.amountMode === "fixed" && <label className="field automation-amount-field"><span>Nominal</span><input required inputMode="numeric" pattern="[0-9]+" value={rule.amountMinor ?? ""} onChange={(e) => change("amountMinor",e.target.value)} /><small>Masukkan nilai dalam satuan terkecil {selectedAsset?.currency ?? "mata uang"}.</small></label>}
        <label className="field"><span>Pelaksanaan</span><select value={rule.amountMode === "confirm_amount" ? "confirm_before_post" : rule.executionMode} disabled={rule.amountMode === "confirm_amount"} onChange={(e) => change("executionMode",e.target.value as RuleInput["executionMode"])}>
          <option value="confirm_before_post">Konfirmasi sebelum catat</option><option value="auto_post">Catat otomatis saat jatuh tempo</option></select></label>
        {rule.kind !== "income" && <label className="field"><span>Aset sumber</span><select required value={rule.sourceAssetId ?? ""} onChange={(e) => change("sourceAssetId",e.target.value)}><option value="">Pilih aset</option>{assets.map((item) => <option value={item.id} key={item.id}>{item.displayName} · {item.currency}</option>)}</select></label>}
        {rule.kind !== "expense" && <label className="field"><span>Aset tujuan</span><select required value={rule.destinationAssetId ?? ""} onChange={(e) => change("destinationAssetId",e.target.value)}><option value="">Pilih aset</option>{assets.map((item) => <option value={item.id} key={item.id}>{item.displayName} · {item.currency}</option>)}</select></label>}
        {rule.kind !== "transfer" && <label className="field"><span>Kategori (opsional)</span><select value={rule.categoryId ?? ""} onChange={(e) => change("categoryId",e.target.value)}><option value="">Tanpa kategori</option>{options.catalogs.transactionCategories.filter((item) => item.isActive && item.appliesTo === rule.kind).map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}</select></label>}
        {rule.kind === "transfer" && <OptionalFormSection label="Ada biaya transfer" enabled={transferFeeEnabled}
          onChange={setTransferFeeEnabled} disabled={pending}>
          <label className="field"><span>Biaya transfer</span><input required inputMode="numeric" pattern="[0-9]*" value={rule.transferFeeMinor ?? ""} onChange={(e) => change("transferFeeMinor",e.target.value)} /><small className="automation-field-hint">Nilai dalam satuan terkecil {selectedAsset?.currency ?? "mata uang"}.</small></label>
        </OptionalFormSection>}
        {rule.kind === "expense" && <OptionalChargesEditor enabled={chargesEnabled} onEnabledChange={setChargesEnabled}
          rows={(rule.charges ?? []).map((charge) => ({ typeId: charge.typeId, amount: charge.amountMinor }))}
          onChange={(rows) => change("charges",rows.map((row) => ({ typeId: row.typeId, amountMinor: row.amount })))}
          chargeTypes={options.catalogs.chargeTypes.filter((item) => item.isActive)} inputMode="numeric" pattern="[0-9]+" disabled={pending} />}
        <section className="automation-schedule-section"><h3>Jadwal</h3>
        <div className="automation-form-pair"><label className="field"><span>Frekuensi</span><select value={rule.frequency} onChange={(e) => setRule((previous) => ({...previous,frequency:e.target.value as RuleInput["frequency"],weekday:e.target.value === "weekly" ? (previous.weekday || 1) : undefined,monthDay:e.target.value === "monthly_day" ? (previous.monthDay || 1) : undefined}))}><option value="daily">Setiap hari</option><option value="weekdays">Senin–Jumat</option><option value="weekly">Mingguan</option><option value="monthly_day">Tanggal bulanan</option><option value="monthly_last_day">Hari terakhir bulan</option></select></label>
          {rule.frequency === "weekly" && <label className="field"><span>Hari</span><select value={rule.weekday ?? 1} onChange={(e) => change("weekday",Number(e.target.value))}>{["Senin","Selasa","Rabu","Kamis","Jumat","Sabtu","Minggu"].map((day,i) => <option key={day} value={i+1}>{day}</option>)}</select></label>}
          {rule.frequency === "monthly_day" && <label className="field"><span>Tanggal (1–28)</span><input type="number" min={1} max={28} value={rule.monthDay ?? 1} onChange={(e) => change("monthDay",Number(e.target.value))} /></label>}</div>
        <div className="automation-form-pair"><label className="field"><span>Jam WIB</span><input type="time" required value={rule.localTime} onChange={(e) => change("localTime",e.target.value)} /></label>
          <label className="field"><span>Mulai</span><input type="date" required value={rule.startOn} onChange={(e) => change("startOn",e.target.value)} /></label></div>
        <label className="field"><span>Sampai (opsional)</span><input type="date" value={rule.endOn ?? ""} onChange={(e) => change("endOn",e.target.value)} /></label></section>
        <label className="field"><span>Catatan (opsional)</span><textarea maxLength={1000} value={rule.note ?? ""} onChange={(e) => change("note",e.target.value)} /></label>
        <div className="automation-preview"><strong>Pratinjau jadwal</strong><p>{previewAmount} {cadence}{selectedAsset ? ` · ${selectedAsset.displayName}` : ""}. {rule.executionMode === "auto_post" && rule.amountMode === "fixed" ? "Dicatat otomatis saat jatuh tempo." : "Perlu konfirmasi sebelum dicatat."}</p>
          {dates.length ? <ul>{dates.map((at) => <li key={at}>{new Date(at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta",dateStyle:"medium",timeStyle:"short"})} WIB</li>)}</ul> : <p>Tidak ada jadwal dalam periode ini.</p>}</div>
        {error && <p role="alert" className="finance-error">{error}</p>}
        <div className="finance-actions"><button type="button" className="finance-secondary" disabled={pending} onClick={() => setEditing(null)}>Batal</button>
          <button type="submit" className="button-primary" disabled={pending || refreshing} aria-busy={pending}>{busy === "save" ? <LoadingIndicator>Menyimpan...</LoadingIndicator> : "Simpan otomatisasi"}</button></div></form>}
    </section></div>}
  </>;
}
