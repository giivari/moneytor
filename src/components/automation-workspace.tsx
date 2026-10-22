"use client";

import { AllocationReview } from "./allocation-review";
import { AutomationActivityDetails } from "./automation-activity-details";
import { sortTemporal, sortNamed } from "@/lib/list-order";
import { useListSort } from "./use-list-sort";
import { ListSortControl } from "./list-sort-control";

import { orderAutomationInstances } from "@/lib/automation/list-order";
import { activityClassification, financialStateLabel } from "@/lib/automation/review-domain";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import type { AutomationView } from "@/lib/automation/service";
import type { IncomeEventView } from "@/lib/automation/income-events";
import type { GeneralView } from "@/lib/automation/composable-service";
import { bpsToPercent } from "@/lib/automation/composable-domain";
import { instanceCommand, lifecycleCommand, unifyAutomation, type WorkspaceInstance } from "@/lib/automation/composable-facade";
import { formatMinor, inputToMinor } from "@/lib/finance/format";
import { automationMutation } from "./automation-builder";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { useFinanceDialog } from "./finance-form-hooks";
import { useMobileViewport } from "./use-mobile-viewport";
import { useAutomationHistory } from "./use-automation-history";
import { useProgressiveList } from "./use-progressive-list";
import { FinancialDataTable, isFinancialRowControl } from "./financial-data-table";
import { ListToolbar } from "./list-toolbar";
import { ListContent } from './list-content';
import { ListFilterControl } from "./list-filter-control";
import { CompactFinancialRow } from "./compact-financial-row";
import { AutomationConfirmButton } from "./automation-confirm-button";
import { ResponsiveDisclosure } from "./responsive-disclosure";
import { SectionHeading } from "./section-heading";
import { AutomationRulesSection } from "./automation-rules-section";
import { LoadingIndicator } from "./loading-indicator";
import { AppLink } from "./app-link";

const labels: Record<string, string> = { active: "Aktif", paused: "Dijeda", archived: "Diarsipkan", upcoming: "Akan datang", due: "Jatuh tempo",
  pending_confirmation: "Perlu konfirmasi", awaiting_confirmation: "Perlu konfirmasi", failed: "Perlu diperiksa", review_required: "Tinjau sumber",
  posted: "Tercatat", skipped: "Dilewati", voided: "Dibatalkan", superseded: "Diganti", income: "Pemasukan", expense: "Pengeluaran", transfer: "Transfer" };
function date(value: string) { return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) + " WIB"; }
type Confirmation = { action: string; id: string; name: string };
export function AutomationWorkspace({ schedules, income, general }: { schedules: AutomationView; income: IncomeEventView; general: GeneralView }) {
  const { rules, instances } = unifyAutomation(schedules, income, general);
  const [view, setView] = useState<"attention" | "upcoming" | "history">("attention");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [archived, setArchived] = useState(false);
  const [allocationReview,setAllocationReview] = useState<WorkspaceInstance | null>(null);
  const [activityDetails,setActivityDetails] = useState<WorkspaceInstance | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [errorId,setErrorId]=useState("");
  const [busy, setBusy] = useState("");
  const { refresh, notify, refreshing } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const compact = useMobileViewport();
  const attentionSort = useListSort("automation.attention");
  const upcomingSort = useListSort("automation.upcoming", "upcoming");
  const historySort = useListSort("automation.history");
  const ruleSort = useListSort("automation.rules");
  const activitySort = view === "attention" ? attentionSort : view === "upcoming" ? upcomingSort : historySort;
  const matches = (item: { triggerSource: string; categoryId: string | null }) => (!source || source === item.triggerSource) && (!category || category === item.categoryId);
  const filtered = instances.filter(matches);
  const attention = orderAutomationInstances(filtered.filter((item) => activityClassification(item).tab==='attention'), "history", attentionSort.direction);
  const upcoming = orderAutomationInstances(filtered.filter((item) => activityClassification(item).tab==='upcoming'), "upcoming", upcomingSort.direction);
  const historyReveal=useAutomationHistory(view==="history",source,category,historySort.direction,compact,general);
  const history=historyReveal.items;
  const upcomingReveal = useProgressiveList(upcoming.length, compact ? 2 : 5, compact ? 5 : 10);
  const reveal = view === "history" ? historyReveal : upcomingReveal;
  const visible = view === "attention" ? attention : view === "upcoming" ? upcoming.slice(0, upcomingReveal.visibleCount) : history;
  const visibleRules = sortTemporal(rules.filter((item) => matches(item) && (archived ? item.status === "archived" : item.status !== "archived") && (!status || item.status === status)), ruleSort.direction, item => item.createdAt, item => item.key);
  async function run(action: string, id: string, body: Record<string, unknown> = {}) {
    if (refreshing || !begin()) return;
    setBusy(`${action}:${id}`); setError("");setErrorId(id);
    try { await automationMutation(action, { id, ...body }); setConfirm(null); notify("Perubahan otomatisasi disimpan."); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Tindakan gagal."); refresh(); }
    finally { finish(); setBusy(""); }
  }
  function post(item: WorkspaceInstance) {
    try { const amountMinor = item.needsAmount ? inputToMinor(amounts[item.key] ?? "", item.exponent) : undefined;
      void run(instanceCommand(item.storage, "post"), item.id, { amountMinor });
    } catch (cause) { setErrorId(item.id);setError(cause instanceof Error ? cause.message : "Isi nominal yang valid."); }
  }
  const renderAmount=(item:WorkspaceInstance)=>item.canPost && item.needsAmount ? <label className="field"><span className="sr-only">Nominal ({item.currency})</span><input placeholder={`Nominal (${item.currency})`} disabled={pending || refreshing} inputMode="decimal" aria-invalid={errorId===item.id&&!!error} aria-describedby={errorId===item.id&&error?`${item.id}-amount-error`:undefined} value={amounts[item.key] ?? ""} onChange={(event) => setAmounts({ ...amounts, [item.key]: event.target.value })} /></label> : undefined;
  const openAllocation=(item:WorkspaceInstance)=>setAllocationReview(item);
  const statusLabel=(item:WorkspaceInstance)=>financialStateLabel(activityClassification(item).financialState);
  const renderStatus=(item:WorkspaceInstance)=><span className={`automation-status ${item.status}`} data-financial-state={activityClassification(item).financialState}>{statusLabel(item)}</span>;
  const renderPrimary=(item:WorkspaceInstance)=>activityClassification(item).tab!=='attention'?undefined:item.allocation?.state==='additional' && !item.review?.assessmentStale ? <button type="button" className="button-primary automation-confirm-button" disabled={pending || refreshing} onClick={()=>openAllocation(item)}>Catat tambahan</button> : item.canPost ? <AutomationConfirmButton disabled={pending || refreshing} onClick={() => post(item)}>{busy === `${instanceCommand(item.storage, "post")}:${item.id}` ? <LoadingIndicator>Mencatat…</LoadingIndicator> : undefined}</AutomationConfirmButton> : <button type="button" className="row-action" disabled={pending || refreshing} onClick={()=>openDetails(item)}>Tinjau</button>;
  const renderSecondary=(item:WorkspaceInstance)=>item.canSkip || (item.storage === "schedule" && item.status === "posted" && item.latestResultStatus !== "voided") ? <>{item.canSkip && <button type="button" className="row-action" data-tone="warning" disabled={pending || refreshing} onClick={() => setConfirm({ action: instanceCommand(item.storage, "skip"), id: item.id, name: item.title })}>Lewati</button>}
              {item.storage === "schedule" && item.status === "posted" && item.latestResultStatus !== "voided" && <button type="button" className="row-action" data-tone="danger" disabled={pending || refreshing} onClick={() => setConfirm({ action: "void", id: item.id, name: item.title })}>Batalkan transaksi</button>}</> : undefined;
  const renderContext=(item:WorkspaceInstance, concise=false)=><>{concise ? new Date(item.at).toLocaleDateString("id-ID", {timeZone:"Asia/Jakarta",day:"numeric",month:"short"}) : date(item.at)}
    {(!concise || !item.sourceAmount) && <> · {item.context}</>}
    {item.sourceAmount && <> · {item.review?.sourceStatus==='voided'?'Sumber dibatalkan':labels[item.sourceKind ?? ""]}{!concise && <> <span className="financial-value financial-value--supporting">{formatMinor(item.review?.currentSourceMinor??item.sourceAmount,item.review?.sourceCurrency??item.sourceCurrency??item.currency,item.review?.sourceExponent??item.sourceExponent??item.exponent)}</span></>}</>}
    {item.percentageBps !== undefined && <> · {bpsToPercent(item.percentageBps)}%</>}</>;
  const openDetails=(item:WorkspaceInstance)=>{ if (!pending && !refreshing) setActivityDetails(item); };
  const detailTitle=(item:WorkspaceInstance)=><button type="button" className="record-title-button" disabled={pending || refreshing} aria-haspopup="dialog" aria-label={`Buka rincian aktivitas: ${item.title}`} onClick={()=>openDetails(item)}>{item.title}</button>;
  const selectedDetails=activityDetails && (instances.find(item=>item.key===activityDetails.key) ?? history.find(item=>item.key===activityDetails.key) ?? activityDetails);
  const activityValue=(item:WorkspaceInstance)=>item.allocation ? BigInt(item.allocation.differenceMinor)>0n?item.allocation.differenceMinor:BigInt(item.allocation.differenceMinor)<0n?(-BigInt(item.allocation.differenceMinor)).toString():item.allocation.recognizedMinor:item.amount;
  const valueLabel=(item:WorkspaceInstance)=>item.review?.assessmentStale?'Assessment terakhir':item.review?.decision==='declined_allocation'?'Belum dialokasikan':item.allocation?BigInt(item.allocation.differenceMinor)>0n?'Tambahan':BigInt(item.allocation.differenceMinor)<0n?'Kelebihan':'Tercatat':undefined;
  const renderCompact=(item:WorkspaceInstance)=>{
    const primary=renderPrimary(item);
    return <CompactFinancialRow desktopLayout={primary ? "confirmation" : "inline"} identity={detailTitle(item)} context={renderContext(item,compact)}
            amountLabel={valueLabel(item)??"Akan dicatat"}
            value={activityValue(item)!==null ? <span className="financial-value financial-value--row">{!primary&&valueLabel(item)&&<>{valueLabel(item)} </>}{formatMinor(activityValue(item)!,item.currency,item.exponent)}</span>:primary?"—":null}
            footer={<>{renderStatus(item)}{item.actionMeaning !== item.context && <span className="finance-hint">{item.actionMeaning}</span>}
            </>}
            amountControl={renderAmount(item)}
            controls={primary}
            secondaryActions={renderSecondary(item)}
            details={errorId===item.id&&error?<p id={`${item.id}-amount-error`} className="finance-error" role="alert">{error}</p>:undefined} />;
  };
  return <div className="page automation-page">
    <header className="page-heading"><div><span className="eyebrow">TRANSACTIONS</span><h1>Otomatisasi</h1><p>Atur kapan, syarat, dan tindakan untuk transaksi kamu.</p></div>
      {general.ready ? <AppLink href="/transactions/automation/new" className="button-primary" aria-disabled={pending || refreshing} onClick={(event) => { if (pending || refreshing) event.preventDefault(); }}>Tambah otomatisasi</AppLink> : <button type="button" className="button-primary" disabled>Tambah otomatisasi</button>}</header>
    {!general.ready && <p className="finance-hint">Pembuatan aturan umum menunggu aktivasi lokal. Aturan yang sudah ada tetap dapat dikelola.</p>}
    <ResponsiveDisclosure label="Filter otomatisasi" desktopExpanded className="list-filter-disclosure"
      summary={[source === "time" ? "Waktu tertentu" : source ? "Transaksi terjadi" : "", general.categories.find(item=>item.id===category)?.name].filter(Boolean).join(" · ") || "Semua pemicu & kategori"}>
    <div className="automation-workspace-filters">
      <label className="field"><span>Sumber pemicu</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="">Semua pemicu</option><option value="time">Waktu tertentu</option><option value="transaction_posted">Transaksi terjadi</option></select></label>
      {general.categories.length > 0 && <label className="field"><span>Kategori otomatisasi</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Semua kategori</option>
        {sortNamed(general.categories, item => item.name, item => item.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    </div></ResponsiveDisclosure>
    <div className="automation-content"><section className="surface automation-occurrences" aria-label="Aktivitas otomatisasi"><SectionHeading title="Aktivitas" />
      <ListToolbar label="Tampilan dan urutan aktivitas"><ListFilterControl value={view} onChange={setView} label="Tampilan aktivitas"
        options={[{value:"attention",label:"Perlu perhatian"},{value:"upcoming",label:"Mendatang"},{value:"history",label:"Riwayat"}]} />
        <ListSortControl {...activitySort} mode={view === "upcoming" ? "upcoming" : "history"} /></ListToolbar>
      <ListContent loading={view==='history'&&historyReveal.loading} error={view==='history'?historyReveal.error:''} hasItems={visible.length>0} onRetry={historyReveal.retry}
        empty={view==='history'?'Belum ada riwayat otomatisasi.':'Tidak ada aktivitas pada tampilan ini.'}>
      {visible.length>0 && (
        <div id="automation-activity-list"><FinancialDataTable label="Aktivitas otomatisasi" records={visible} identity={item=>item.key} rowAction={{onActivate:openDetails,disabled:pending || refreshing}} columns={[
          {key:"time",heading:"Waktu",render:item=><time dateTime={item.at}>{date(item.at)}</time>},
          {key:"identity",heading:"Otomatisasi / konteks",render:item=><>{detailTitle(item)}<small>{item.context}{item.sourceAmount&&<> · {item.review?.sourceStatus==='voided'?'Sumber dibatalkan':labels[item.sourceKind??""]} {formatMinor(item.review?.currentSourceMinor??item.sourceAmount,item.review?.sourceCurrency??item.sourceCurrency??item.currency,item.review?.sourceExponent??item.sourceExponent??item.exponent)}</>}{item.percentageBps!==undefined&&<> · {bpsToPercent(item.percentageBps)}%</>}<span className="record-secondary-context"> · {item.actionMeaning}</span></small></>},
          {key:"action",heading:"Tindakan",secondary:true,render:item=>item.actionMeaning},
          {key:"amount",heading:"Nominal",numeric:true,render:item=>item.canPost && item.needsAmount?<div className="record-money-input">{renderAmount(item)}</div>:activityValue(item)!==null?<>{valueLabel(item)&&<small>{valueLabel(item)}</small>}<strong className="financial-value financial-value--row">{formatMinor(activityValue(item)!,item.currency,item.exponent)}</strong></>:<span className="record-muted">{view === "upcoming" ? "Diisi saat konfirmasi" : "—"}</span>},
          {key:"status",heading:"Status",render:renderStatus},
          {key:"decisions",heading:"Aksi",render:item=><div className="record-decisions inline-field-action--compact">{renderPrimary(item)}{renderSecondary(item)}{errorId===item.id&&error&&<p id={`${item.id}-amount-error`} className="finance-error" role="alert">{error}</p>}</div>},
        ]} compact={item=><div className="automation-occurrence" data-actionable={!pending && !refreshing} onClick={event=>{if (!isFinancialRowControl(event.target as Element)) openDetails(item);}}>{renderCompact(item)}</div>} /></div>)}
      </ListContent>
      {view !== "attention" && (reveal.canShowMore || reveal.canCollapse) && <div className="list-reveal">
        {reveal.canShowMore && <div className="list-reveal-more"><button type="button" className="text-link list-disclosure" aria-controls="automation-activity-list" aria-expanded={reveal.canCollapse} disabled={view==="history"&&historyReveal.loading} onClick={reveal.showMore}>{view==='history'&&historyReveal.loading?<LoadingIndicator>Memuat lainnya…</LoadingIndicator>:<>Tampilkan {reveal.nextBatchCount} lagi <ArrowDown size={15} aria-hidden="true" /></>}</button>
          <span className="list-reveal-remaining" aria-live="polite">{reveal.hiddenCount} tersisa</span></div>}
        {reveal.canCollapse && <button type="button" className="text-link list-disclosure list-disclosure--quiet" aria-controls="automation-activity-list" aria-expanded={true} onClick={reveal.collapse}>Tampilkan lebih sedikit <ArrowUp size={15} aria-hidden="true" /></button>}
      </div>}
      <details className="context-help"><summary>Tentang otomatisasi</summary><p className="supporting-prose supporting-prose--section">Aturan menghubungkan pemicu, kondisi, dan tindakan. Jadwal diproses ketika moneytor dibuka. Tindakan dari transaksi selalu memerlukan konfirmasi. Koreksi dan pembatalan tetap menggunakan Transactions dan menyimpan riwayat.</p></details>
    </section>
    <AutomationRulesSection archived={archived} onArchivedChange={(value) => { setArchived(value); setStatus(""); }} utilities={<>      {!archived && <ListFilterControl value={status} onChange={setStatus} label="Status aturan" options={[{value:"",label:"Semua status"},{value:"active",label:"Aktif"},{value:"paused",label:"Dijeda"}]} />}
<ListSortControl {...ruleSort} /></>}>
      {!visibleRules.length ? <p className="finance-empty-inline">Belum ada aturan pada filter ini.</p> : <div className="automation-rule-list">{visibleRules.map((rule) => <article className="surface automation-rule" key={rule.key}>
        <div className="automation-rule-heading"><div><h3>{rule.title}</h3><p>{rule.context}</p>{rule.categoryName && <p>{rule.categoryName}</p>}</div><span className={`automation-status ${rule.status}`}>{labels[rule.status]}</span></div>
        <ResponsiveDisclosure label="Kelola otomatisasi" className="history-detail compact-management-controls"><div className="finance-actions compact-management-actions">
          <AppLink className="row-action" aria-disabled={pending || refreshing} onClick={(event) => { if (pending || refreshing) event.preventDefault(); }} href={`/transactions/automation/${rule.id}/edit${rule.storage === "general" ? "" : `?source=${rule.storage}`}`}>Ubah</AppLink>
          <button type="button" className="row-action" disabled={pending || refreshing} onClick={() => run(lifecycleCommand(rule.storage, rule.status === "active" ? "pause" : rule.status === "archived" ? "restore" : "resume"), rule.id)}>{rule.status === "active" ? "Jeda" : rule.status === "archived" ? "Pulihkan" : "Lanjutkan"}</button>
          {rule.status !== "archived" && <button type="button" className="row-action" data-tone="warning" disabled={pending || refreshing} onClick={() => setConfirm({ action: lifecycleCommand(rule.storage, "archive"), id: rule.id, name: rule.title })}>Arsipkan</button>}
        </div></ResponsiveDisclosure>
      </article>)}</div>}
    </AutomationRulesSection>
    {general.ready && <ResponsiveDisclosure label="Kelola kategori otomatisasi" className="history-detail"><div className="compact-management-body">
      {!general.categories.length && <p className="finance-hint">Kategori dapat dibuat saat menambah otomatisasi.</p>}
      {sortNamed(general.categories, item => item.name, item => item.id).map((item) => <div className="automation-category-row" key={item.id}><div className="inline-field-action">
        <label className="field"><span>Nama kategori</span><input disabled={pending || refreshing} maxLength={80} value={categoryNames[item.id] ?? item.name} onChange={(event) => setCategoryNames({ ...categoryNames, [item.id]: event.target.value })} /></label>
        <button type="button" className="finance-secondary" disabled={pending || refreshing || (categoryNames[item.id] ?? item.name) === item.name} onClick={() => run("category-save", item.id, { name: categoryNames[item.id] })}>Simpan</button></div>
        <button type="button" className="row-action" data-tone={item.status === "active" ? "warning" : undefined} disabled={pending || refreshing} onClick={() => run(item.status === "active" ? "category-archive" : "category-restore", item.id)}>{item.status === "active" ? "Arsipkan" : "Pulihkan"}</button>
      </div>)}
    </div></ResponsiveDisclosure>}
    </div>
    {error && !confirm && !visible.some(item=>item.id===errorId) && <p role="alert" className="finance-error">{error}</p>}
    {allocationReview && allocationReview.storage!=="schedule" && <AllocationReview storage={allocationReview.storage} id={allocationReview.id} title={allocationReview.title} onClose={()=>setAllocationReview(null)}/>}
    {selectedDetails && <AutomationActivityDetails item={selectedDetails} status={statusLabel(selectedDetails)} onClose={()=>setActivityDetails(null)}/>}
    {confirm && <AutomationConfirmation value={confirm} pending={pending} error={error} onClose={() => setConfirm(null)} onConfirm={() => run(confirm.action, confirm.id)} />}
  </div>;
}
function AutomationConfirmation({ value, pending, error, onClose, onConfirm }: { value: Confirmation; pending: boolean; error: string; onClose: () => void; onConfirm: () => void }) {
  const dialog = useFinanceDialog(onClose);
  const skipping = value.action.endsWith("skip"), voiding = value.action === "void";
  return <dialog ref={dialog} className="detail-dialog" aria-labelledby="workspace-confirm-title" onCancel={(event) => { if (pending) event.preventDefault(); }}>
    <h2 id="workspace-confirm-title">{skipping ? "Lewati aktivitas ini?" : voiding ? "Batalkan transaksi?" : "Arsipkan otomatisasi?"}</h2>
    <p>{skipping ? `“${value.name}” dilewati tanpa mencatat transaksi.` : voiding ? "Pergerakan transaksi dibalik; riwayat tetap tersimpan." : `“${value.name}” berhenti menjalankan aturan. Riwayat tetap tersimpan dan aturan dapat dipulihkan.`}</p>
    <div className="finance-actions"><button autoFocus type="button" className="finance-secondary" disabled={pending} onClick={onClose}>Kembali</button>
      <button type="button" className={voiding ? "finance-danger" : "finance-warning"} disabled={pending} onClick={onConfirm}>{pending ? <LoadingIndicator>Menyimpan…</LoadingIndicator> : "Ya, lanjutkan"}</button></div>
    {error && <p role="alert" className="finance-error">{error}</p>}
  </dialog>;
}
