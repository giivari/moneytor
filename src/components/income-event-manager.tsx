"use client";

import { sortTemporal } from "@/lib/list-order";
import { useListSort } from "./use-list-sort";
import { ListSortControl } from "./list-sort-control";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AutomationRulesSection } from "./automation-rules-section";
import { SectionHeading } from "./section-heading";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { CompactFinancialRow } from "./compact-financial-row";
import { AutomationConfirmButton } from "./automation-confirm-button";
import { AppLink } from "./app-link";
import { LoadingIndicator } from "./loading-indicator";
import { OptionalChargesEditor } from "./optional-charges-editor";
import { OptionalFormSection } from "./optional-form-section";
import { ResponsiveDisclosure } from "./responsive-disclosure";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { useMobileViewport } from "./use-mobile-viewport";
import { useProgressiveList } from "./use-progressive-list";
import { loadFinanceOptions, requestJson, type FinanceOptions } from "@/lib/finance/client";
import { formatMinor } from "@/lib/finance/format";
import type { IncomeEventRuleInput, IncomeEventView } from "@/lib/automation/income-events";

type Rule = {created_at:string;id:string;status:"active"|"paused"|"archived";title:string;percentage_bps:number;
  output_kind:"expense"|"transfer";destination_asset_id:string|null;destination_name:string|null;category_id:string|null;
  transfer_fee_minor:string|null;charges:{typeId:string;amountMinor:string}[];note:string|null};
type Instance = {eligible_at:string;id:string;rule_title:string;status:string;source_name:string;destination_name:string|null;
  source_occurred_at:string;source_amount_minor:string;source_currency:string;exponent:number;percentage_bps:number;
  proposed_amount_minor:string|null;output_kind:"expense"|"transfer";failure_reason:string|null;
  root_activity_id:string;effective_activity_id:string;result_activity_id:string|null;latest_result_status:string|null;created_at:string};
const fresh = ():IncomeEventRuleInput => ({title:"",percentageBps:1000,outputKind:"expense",charges:[]});
const labels:Record<string,string> = {active:"Aktif",paused:"Dijeda",archived:"Diarsipkan",awaiting_confirmation:"Perlu konfirmasi",
  posted:"Tercatat",skipped:"Dilewati",failed:"Perlu diperiksa",superseded:"Sumber dibatalkan",review_required:"Tinjau sumber"};
function percent(bps:number) {
  const whole = Math.floor(bps/100), fractional = String(bps%100).padStart(2,"0").replace(/0+$/,"");
  return `${whole}${fractional ? `,${fractional}` : ""}%`;
}
function mutation(action:string,body:Record<string,unknown>) {
  return requestJson<{id?:string;ok?:boolean}>("/api/automation",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action,...body}),cache:"no-store"});
}
export function IncomeEventManager({initial,editorRef,showArchived,onArchivedChange}:{
  initial:IncomeEventView;editorRef:Ref<{create:()=>void}>;
  showArchived:boolean;onArchivedChange:(value:boolean)=>void;
}) {
  const {refresh,notify,refreshing} = useFinanceFeedback();
  const {pending,begin,finish} = useMutationPending();
  const [busy,setBusy] = useState("");
  const [error,setError] = useState("");
  const [editing,setEditing] = useState<string|null>(null);
  const [draft,setDraft] = useState<IncomeEventRuleInput>(fresh);
  const [options,setOptions] = useState<FinanceOptions|null>(null);
  const [optionsError,setOptionsError] = useState("");
  const [chargesEnabled,setChargesEnabled] = useState(false);
  const [feeEnabled,setFeeEnabled] = useState(false);
  const [history,setHistory] = useState(false);
  const [confirm,setConfirm] = useState<{action:string;id:string;name:string}|null>(null);
  const saveKey = useRef(crypto.randomUUID());
  const compact = useMobileViewport();
  const rules = initial.rules as Rule[], instances = initial.instances as Instance[];
  const attentionSort = useListSort("automation.attention");
  const historySort = useListSort("automation.history");
  const ruleSort = useListSort("automation.rules");
  const pendingInstances = sortTemporal(instances.filter((item) => ["awaiting_confirmation","failed","review_required"].includes(item.status)), attentionSort.direction, item => item.eligible_at, item => item.id);
  const historyInstances = sortTemporal(instances.filter((item) => !["awaiting_confirmation","failed","review_required"].includes(item.status)), historySort.direction, item => item.eligible_at, item => item.id);
  const reveal = useProgressiveList(historyInstances.length,10,compact ? 5 : 10);
  useEffect(() => {
    if (editing === null || options) return;
    let live = true;
    loadFinanceOptions().then((result) => {if(live){setOptions(result);setOptionsError("");}})
      .catch(() => {if(live)setOptionsError("Pilihan belum dapat dimuat. Coba lagi.");});
    return () => {live=false;};
  },[editing,options]);
  function beginEdit(rule?:Rule) {
    saveKey.current=crypto.randomUUID(); setEditing(rule?.id ?? "new");setError("");
    setDraft(rule ? {title:rule.title,percentageBps:rule.percentage_bps,outputKind:rule.output_kind,
      destinationAssetId:rule.destination_asset_id ?? "",categoryId:rule.category_id ?? "",
      transferFeeMinor:rule.transfer_fee_minor ?? "",charges:rule.charges,note:rule.note ?? ""} : fresh());
    setChargesEnabled(Boolean(rule?.charges.length));setFeeEnabled(Boolean(rule?.transfer_fee_minor));
  }
  useImperativeHandle(editorRef,()=>({create:()=>{if(!pending && !refreshing)beginEdit();}}));
  async function run(action:string,id:string,success:string,body:Record<string,unknown>={}) {
    if(refreshing || !begin())return;
    setBusy(`${action}:${id}`);setError("");
    try {await mutation(action,{id,...body});notify(success);setConfirm(null);refresh();}
    catch(cause){setError(cause instanceof Error ? cause.message : "Tindakan gagal.");}
    finally{setBusy("");finish();}
  }
  async function save(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(refreshing || !begin())return;
    setBusy("save");setError("");
    const rule = {...draft,charges:draft.outputKind === "expense" && chargesEnabled ? draft.charges : [],
      transferFeeMinor:draft.outputKind === "transfer" && feeEnabled ? draft.transferFeeMinor : ""};
    try {await mutation("event-save",{id:editing === "new" ? undefined : editing,rule,idempotencyKey:saveKey.current});
      notify(editing === "new" ? "Aturan peristiwa dibuat." : "Aturan peristiwa diperbarui.");setEditing(null);refresh();}
    catch(cause){setError(cause instanceof Error ? cause.message : "Aturan gagal disimpan.");}
    finally{setBusy("");finish();}
  }
  if(!initial.ready)return <p className="finance-empty-inline">Aturan dari pemasukan belum diaktifkan di database lokal.</p>;
  const visible = history ? historyInstances.slice(0,reveal.visibleCount) : pendingInstances;
  const assets = options?.assets.filter((item) => item.isActive) ?? [];
  return <div className="automation-content">
    <section className="surface automation-occurrences" aria-label="Aktivitas dari pemasukan"><SectionHeading title="Aktivitas" />
      <div className="filter-row" role="group" aria-label="Filter aktivitas pemasukan"><button type="button" aria-pressed={!history} className={`filter-chip ${!history?"active":""}`} onClick={()=>setHistory(false)}>Perlu perhatian</button>
        <button type="button" aria-pressed={history} className={`filter-chip ${history?"active":""}`} onClick={()=>setHistory(true)}>Riwayat</button></div>
      <ListSortControl {...(history ? historySort : attentionSort)} />
      {visible.length === 0 ? <p className="finance-empty-inline">{history ? "Belum ada riwayat peristiwa." : "Belum ada tindakan dari pemasukan yang perlu dikonfirmasi."}</p> :
        <div className="automation-occurrence-list" id="income-event-list">{visible.map((item) => <div className="automation-occurrence" key={item.id}>
          <CompactFinancialRow desktopLayout={item.status === "awaiting_confirmation" || item.status === "failed" ? "confirmation" : "inline"} identity={item.rule_title}
            context={<>{item.source_name} · {new Date(item.source_occurred_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta",dateStyle:"medium",timeStyle:"short"})} WIB · Pemasukan {formatMinor(item.source_amount_minor,item.source_currency,item.exponent)} · {percent(item.percentage_bps)}</>}
            value={item.proposed_amount_minor ? <span className="financial-value financial-value--row">{formatMinor(item.proposed_amount_minor,item.source_currency,item.exponent)}</span> : undefined}
            footer={<><span className={`automation-status ${item.status}`}>{item.latest_result_status === "voided" ? "Hasil dibatalkan" : labels[item.status] ?? item.status}</span>
              <span className="finance-hint">{item.output_kind === "expense" ? "Pengeluaran" : `Transfer ke ${item.destination_name ?? "aset tujuan"}`}</span></>}
            controls={item.status === "awaiting_confirmation" || item.status === "failed" ? <>
              <AutomationConfirmButton disabled={pending || refreshing || !item.proposed_amount_minor} onClick={()=>run("event-post",item.id,"Tindakan dicatat.")}>{busy === `event-post:${item.id}` ? <LoadingIndicator>Mencatat...</LoadingIndicator> : undefined}</AutomationConfirmButton>
              </> : undefined}
            secondaryActions={item.status === "awaiting_confirmation" || item.status === "failed" ? <button type="button" className="row-action" data-tone="warning" disabled={pending || refreshing} onClick={()=>setConfirm({action:"event-skip",id:item.id,name:item.rule_title})}>Lewati</button> : undefined}
            details={<ResponsiveDisclosure label="Rincian peristiwa" className="history-detail"><p className="finance-hint">Pemasukan sumber: {item.root_activity_id}. Versi transaksi: {item.effective_activity_id}. {item.failure_reason ?? "Nominal dihitung dari jumlah dasar pemasukan dan basis poin aturan."}</p>
            {item.result_activity_id && <p className="finance-hint">Hasil: {item.result_activity_id}{item.latest_result_status ? ` · ${item.latest_result_status}` : ""}</p>}</ResponsiveDisclosure>} />
          {item.status === "review_required" && <AppLink href="/transactions" className="text-link">Tinjau transaksi di Transactions →</AppLink>}
        </div>)}</div>}
      {history && (reveal.canShowMore || reveal.canCollapse) && <div className="list-reveal">
        {reveal.canShowMore && <div className="list-reveal-more"><button type="button" className="text-link list-disclosure" aria-controls="income-event-list" onClick={reveal.showMore}>Tampilkan {reveal.nextBatchCount} lagi <ArrowDown size={15} aria-hidden="true" /></button><span className="list-reveal-remaining">{reveal.hiddenCount} tersisa</span></div>}
        {reveal.canCollapse && <button type="button" className="text-link list-disclosure list-disclosure--quiet" aria-controls="income-event-list" onClick={reveal.collapse}>Tampilkan lebih sedikit <ArrowUp size={15} aria-hidden="true" /></button>}
      </div>}
      <details className="context-help"><summary>Tentang aturan dari pemasukan</summary><p className="supporting-prose supporting-prose--section">Pemasukan yang dicatat saat aturan aktif menghasilkan usulan berdasarkan persentase. Setiap pengeluaran atau transfer tetap memerlukan konfirmasi. Perubahan pada pemasukan sumber dapat memerlukan peninjauan hasil.</p></details>
    </section>
    <AutomationRulesSection archived={showArchived} onArchivedChange={onArchivedChange}><ListSortControl {...ruleSort} />
    {rules.filter((item)=>showArchived ? item.status === "archived" : item.status !== "archived").length === 0 ? <p className="finance-empty-inline">{showArchived ? "Belum ada aturan yang diarsipkan." : "Belum ada aturan dari pemasukan."}</p> :
    <div className="automation-rule-list">{sortTemporal(rules.filter((item)=>showArchived ? item.status === "archived" : item.status !== "archived"), ruleSort.direction, item => item.created_at, item => item.id).map((item)=><article className="surface automation-rule" key={item.id}>
      <div className="automation-rule-heading"><div><h3>{item.title}</h3><p>Saat pemasukan dicatat · {percent(item.percentage_bps)} · {item.output_kind === "expense" ? "Pengeluaran" : `Transfer ke ${item.destination_name ?? "aset tujuan"}`}</p></div>
        <span className={`automation-status ${item.status}`}>{labels[item.status]}</span></div>
      <ResponsiveDisclosure label="Kelola otomatisasi" className="history-detail compact-management-controls"><div className="finance-actions compact-management-actions">
        <button type="button" className="row-action" disabled={pending || refreshing} onClick={()=>beginEdit(item)}>Ubah</button>
        {item.status === "active" ? <button type="button" className="row-action" disabled={pending || refreshing} onClick={()=>run("event-pause",item.id,"Aturan dijeda.")}>Jeda</button> :
          <button type="button" className="row-action" disabled={pending || refreshing} onClick={()=>run(item.status === "archived" ? "event-restore" : "event-resume",item.id,"Aturan aktif kembali.")}>{item.status === "archived" ? "Pulihkan" : "Lanjutkan"}</button>}
        {item.status !== "archived" && <button type="button" className="row-action" data-tone="warning" disabled={pending || refreshing} onClick={()=>setConfirm({action:"event-archive",id:item.id,name:item.title})}>Arsipkan</button>}
      </div></ResponsiveDisclosure></article>)}</div>}</AutomationRulesSection>
    {error && !confirm && editing === null && <p role="alert" className="finance-error">{error}</p>}
    {confirm && <div className="dialog-backdrop"><section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="income-event-confirm-title">
      <div className="dialog-heading"><h2 id="income-event-confirm-title">{confirm.action === "event-skip" ? "Lewati peristiwa ini?" : "Arsipkan aturan ini?"}</h2></div>
      <p>{confirm.action === "event-skip" ? `“${confirm.name}” dilewati tanpa mencatat transaksi.` : `“${confirm.name}” berhenti mencocokkan pemasukan baru.`}</p>
      <div className="finance-actions"><button type="button" className="finance-secondary" disabled={pending} onClick={()=>setConfirm(null)}>Kembali</button>
        <button type="button" className="finance-warning" disabled={pending} onClick={()=>run(confirm.action,confirm.id,confirm.action === "event-skip" ? "Peristiwa dilewati." : "Aturan diarsipkan.")}>Ya, lanjutkan</button></div>
      {error && <p role="alert" className="finance-error">{error}</p>}
    </section></div>}
    {editing !== null && <div className="dialog-backdrop"><section className="detail-dialog automation-dialog" role="dialog" aria-modal="true" aria-labelledby="income-event-editor-title" aria-busy={pending}>
      <div className="dialog-heading"><div><span className="eyebrow">ATURAN PERISTIWA</span><h2 id="income-event-editor-title">{editing === "new" ? "Tambah aturan" : "Ubah aturan"}</h2></div>
        <button type="button" className="icon-button" disabled={pending} aria-label="Tutup" onClick={()=>setEditing(null)}>×</button></div>
      {!options ? <div className="automation-options-state">{optionsError ? <><p role="alert">{optionsError}</p><button type="button" className="finance-secondary" onClick={()=>loadFinanceOptions().then(setOptions).catch(()=>setOptionsError("Pilihan belum dapat dimuat."))}>Coba lagi</button></> : <LoadingIndicator>Memuat pilihan...</LoadingIndicator>}</div> :
        <form onSubmit={save} className="automation-form"><label className="field"><span>Nama aturan</span><input autoFocus required maxLength={120} value={draft.title} onChange={(event)=>setDraft({...draft,title:event.target.value})}/></label>
          <label className="field"><span>Trigger</span><select value="posted_income" disabled><option value="posted_income">Saat pemasukan dicatat</option></select></label>
          <label className="field"><span>Persentase (basis poin)</span><input required type="number" min={1} max={10000} step={1} value={draft.percentageBps} onChange={(event)=>setDraft({...draft,percentageBps:Number(event.target.value)})}/><small>1000 = 10%. Dihitung dari jumlah dasar pemasukan, dibulatkan ke bawah.</small></label>
          <label className="field"><span>Tindakan</span><select value={draft.outputKind} onChange={(event)=>{setDraft({...draft,outputKind:event.target.value as IncomeEventRuleInput["outputKind"],destinationAssetId:"",categoryId:"",transferFeeMinor:"",charges:[]});setChargesEnabled(false);setFeeEnabled(false);}}><option value="expense">Pengeluaran</option><option value="transfer">Transfer</option></select></label>
          <p className="finance-hint">Aset sumber mengikuti aset yang menerima pemasukan. Transfer memerlukan mata uang yang sama. Setiap hasil memerlukan konfirmasi.</p>
          {draft.outputKind === "expense" ? <><label className="field"><span>Kategori (opsional)</span><select value={draft.categoryId ?? ""} onChange={(event)=>setDraft({...draft,categoryId:event.target.value})}><option value="">Tanpa kategori</option>{options.catalogs.transactionCategories.filter((item)=>item.isActive && item.appliesTo === "expense").map((item)=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
            <OptionalChargesEditor enabled={chargesEnabled} onEnabledChange={setChargesEnabled} rows={(draft.charges ?? []).map((item)=>({typeId:item.typeId,amount:item.amountMinor}))} onChange={(rows)=>setDraft({...draft,charges:rows.map((item)=>({typeId:item.typeId,amountMinor:item.amount}))})} chargeTypes={options.catalogs.chargeTypes.filter((item)=>item.isActive)} inputMode="numeric" pattern="[0-9]+" disabled={pending}/></> :
            <><label className="field"><span>Aset tujuan</span><select required value={draft.destinationAssetId ?? ""} onChange={(event)=>setDraft({...draft,destinationAssetId:event.target.value})}><option value="">Pilih aset</option>{assets.map((item)=><option key={item.id} value={item.id}>{item.displayName} · {item.currency}</option>)}</select></label>
              <OptionalFormSection label="Ada biaya transfer" enabled={feeEnabled} onChange={setFeeEnabled} disabled={pending}><label className="field"><span>Biaya transfer</span><input required inputMode="numeric" pattern="[0-9]+" value={draft.transferFeeMinor ?? ""} onChange={(event)=>setDraft({...draft,transferFeeMinor:event.target.value})}/></label></OptionalFormSection></>}
          <label className="field"><span>Catatan (opsional)</span><textarea maxLength={1000} value={draft.note ?? ""} onChange={(event)=>setDraft({...draft,note:event.target.value})}/></label>
          {error && <p role="alert" className="finance-error">{error}</p>}
          <div className="finance-actions"><button type="button" className="finance-secondary" onClick={()=>setEditing(null)} disabled={pending}>Batal</button><button type="submit" className="button-primary" disabled={pending || refreshing}>{busy === "save" ? <LoadingIndicator>Menyimpan...</LoadingIndicator> : "Simpan aturan"}</button></div>
        </form>}
    </section></div>}
  </div>;
}
