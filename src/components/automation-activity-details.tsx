"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { WorkspaceInstance } from "@/lib/automation/composable-facade";
import { bpsToPercent } from "@/lib/automation/composable-domain";
import { formatMinor } from "@/lib/finance/format";
import { AllocationSummaryContent } from "./allocation-summary";
import { AppLink } from "./app-link";
import { useFinanceDialog } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { requestJson } from "@/lib/finance/client";
import { activityClassification, financialStateLabel, type ActivityReviewDetail, type ReviewDecision } from "@/lib/automation/review-domain";
import { ResponsiveDisclosure } from "./responsive-disclosure";
import { LoadingIndicator } from "./loading-indicator";

function date(value: string) {
  return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) + " WIB";
}

/** Read-only detail projection; opening the dialog never assesses, acknowledges, or posts an allocation. */
export function AutomationActivityDetailsContent({ item, status }: { item: WorkspaceInstance; status: string }) {
  return <>
    <dl className="detail-list">
      <div><dt>Status keuangan</dt><dd>{item.review?financialStateLabel(activityClassification(item).financialState):status}</dd></div>
      {item.review && <div><dt>Status tinjauan</dt><dd>{item.review.attention==='reviewed'?'Sudah ditinjau':item.review.attention==='needs_action'?'Perlu tindakan':item.review.attention==='needs_review'?'Perlu ditinjau':'Tidak perlu perhatian'}</dd></div>}
      {item.review?.reviewedAt && <div><dt>Ditinjau pada</dt><dd>{date(item.review.reviewedAt)}{item.review.decision==='declined_allocation'?' · Tambahan diputuskan tidak dicatat':''}</dd></div>}
      <div><dt>Tindakan</dt><dd>{item.actionMeaning}</dd></div>
      <div><dt>Waktu</dt><dd>{date(item.at)}</dd></div>
      <div><dt>Pemicu</dt><dd>{item.context}</dd></div>
      {item.sourceAmount && <div><dt>{item.sourceKind==='income'?'Pemasukan awal':'Nominal sumber awal'}</dt><dd>{formatMinor(item.review?.originalSourceMinor??item.sourceAmount, item.sourceCurrency ?? item.currency, item.sourceExponent ?? item.exponent)}</dd></div>}
      {item.review?.ruleVersion && <div><dt>Versi aturan saat pemicu</dt><dd>{item.review.ruleVersion}</dd></div>}
      {item.review?.sourceStatus==='voided' && <div><dt>Status sumber</dt><dd>Dibatalkan</dd></div>}
      {(!item.allocation || item.review?.assessmentStale) && item.review?.lastSourceMinor!==null && item.review?.lastSourceMinor!==undefined && <div><dt>{item.review.sourceStatus==='voided'?'Nominal terakhir sebelum pembatalan':'Nominal sumber terkini'}</dt><dd>{formatMinor(item.review.lastSourceMinor,item.review.sourceCurrency??item.currency,item.review.sourceExponent)}</dd></div>}
      {(!item.allocation || item.review?.assessmentStale) && item.review?.sourceStatus==='voided' && <div><dt>Nominal sumber efektif</dt><dd>{formatMinor('0',item.review.sourceCurrency??item.currency,item.review.sourceExponent)}</dd></div>}
      {item.sourceAt && <div><dt>Waktu transaksi pemicu</dt><dd>{date(item.sourceAt)}</dd></div>}
      {item.percentageBps !== undefined && <div><dt>Persentase aturan</dt><dd>{bpsToPercent(item.percentageBps)}%</dd></div>}
      <div><dt>Nominal aktivitas</dt><dd>{item.amount ? formatMinor(item.amount, item.currency, item.exponent) : item.canPost && item.needsAmount ? "Diisi saat konfirmasi" : "—"}</dd></div>
    </dl>
    {item.allocation && <>{item.review?.assessmentStale && <p className="finance-hint">Assessment terakhir — sebelum perubahan terbaru. Nilai di bawah perlu dinilai ulang.</p>}<AllocationSummaryContent value={item.allocation} historicalAssessment={item.review?.assessmentStale} /></>}
    {item.failure && <p className="finance-hint">{activityClassification(item).tab==='history'?'Catatan status tersimpan: ':''}{item.failure}</p>}
    {item.rootId && <p className="finance-hint">Terhubung dengan transaksi pemicu.</p>}
    {item.resultId && <p className="finance-hint">Hasil mengikuti riwayat koreksi dan pembatalan di Transactions.</p>}
  </>;
}

export function AutomationActivityTimeline({ detail }: {detail:ActivityReviewDetail}) {
  return <ResponsiveDisclosure label="Riwayat aktivitas" className="history-detail">
    <ol className="automation-timeline">{detail.timeline.map(event=><li key={event.id}>
      <time dateTime={event.at}>{date(event.at)}</time><strong>{event.title}</strong>
      <small>{({financial:'Transaksi keuangan',source:'Peristiwa sumber',assessment:'Assessment / usulan',review:'Tinjauan owner'})[event.kind]}</small>
      <p>{event.description}</p>
    </li>)}</ol>
    {!detail.timeline.length && <p className="finance-hint">Belum ada peristiwa tersimpan yang dapat ditampilkan.</p>}
    <p className="finance-hint">{detail.timelineNote}</p>
  </ResponsiveDisclosure>;
}

export function AutomationActivityDetails({ item, status, onClose }: { item: WorkspaceInstance; status: string; onClose: () => void }) {
  const dialog = useFinanceDialog(onClose);
  const [detail,setDetail]=useState<ActivityReviewDetail|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[declining,setDeclining]=useState(false);
  const {pending,begin,finish}=useMutationPending(),{refresh,notify}=useFinanceFeedback();
  useEffect(()=>{
    const controller=new AbortController();let active=true;setDetail(null);setError('');setDeclining(false);
    requestJson<ActivityReviewDetail>(`/api/automation/activity?${new URLSearchParams({storage:item.storage,id:item.id})}`,{cache:'no-store',signal:controller.signal})
      .then(value=>{if(active)setDetail(value);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Rincian belum tersedia.');});
    return()=>{active=false;controller.abort();};
  },[item.storage,item.id,attempt]);
  async function review(decision:ReviewDecision) {
    if(!detail || !begin())return;setError('');
    try {
      await requestJson('/api/automation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'activity-review',storage:item.storage,id:item.id,revision:detail.context.revision,decision}),cache:'no-store'});
      notify(decision==='declined_allocation'?'Keputusan tidak mencatat tambahan disimpan.':'Aktivitas ditandai sudah ditinjau.');refresh();dialog.current?.close();
    }catch(cause){setError(cause instanceof Error?cause.message:'Tinjauan belum tersimpan. Muat ulang rincian sebelum mencoba lagi.');setDeclining(false);}
    finally{finish();}
  }
  const current=detail?{...item,review:detail.context,allocation:detail.allocation??item.allocation}:item;
  return <dialog ref={dialog} className="finance-dialog detail-dialog finance-detail" aria-labelledby="automation-activity-detail-title"
    aria-busy={pending} onCancel={event=>{if(pending)event.preventDefault();}}
    onClick={event => {
      if (pending || event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
    }}>
    <div className="dialog-heading">
      <div><span className="eyebrow">RINCIAN AKTIVITAS</span><h2 id="automation-activity-detail-title">{item.title}</h2></div>
      <button autoFocus type="button" className="icon-button" disabled={pending} aria-label="Tutup rincian aktivitas" onClick={() => dialog.current?.close()}><X size={20} /></button>
    </div>
    <AutomationActivityDetailsContent item={current} status={status} />
    {detail ? <AutomationActivityTimeline detail={detail}/> : !error && <p role="status" className="finance-hint"><LoadingIndicator>Memuat riwayat…</LoadingIndicator></p>}
    {error && <p role="alert" className="finance-error">{error} <button type="button" className="row-action" disabled={pending} onClick={()=>setAttempt(value=>value+1)}>Muat ulang rincian</button></p>}
    {detail && !detail.context.ready && ['needs_review','needs_action'].includes(detail.context.attention) && <p className="finance-hint">Pencatatan tinjauan menunggu aktivasi migration 012.</p>}
    {detail?.context.assessmentStale && <p className="finance-hint">Sumber / hasil berubah sejak assessment terakhir. Keputusan akan memeriksa revisi terbaru terlebih dahulu.</p>}
    {(item.resultId || item.status === "review_required") && <AppLink href="/transactions" prefetch={false} className="text-link">Tinjau di Transactions →</AppLink>}
    {detail?.context.canAcknowledge && <div className="finance-actions"><button type="button" className="finance-secondary" disabled={pending} onClick={()=>void review('acknowledged')}>{pending?<LoadingIndicator>Menyimpan…</LoadingIndicator>:'Tandai sudah ditinjau'}</button></div>}
    {detail?.context.canDecline && <div className="compact-form-block">
      {declining ? <><p className="finance-hint">Tidak mencatat tambahan untuk revisi ini? Kekurangan alokasi tetap tersimpan; tidak ada transaksi baru. Perubahan sumber / hasil berikutnya dapat memerlukan tinjauan lagi.</p>
        <div className="finance-actions"><button type="button" className="finance-secondary" disabled={pending} onClick={()=>setDeclining(false)}>Kembali</button><button type="button" className="finance-warning" disabled={pending} onClick={()=>void review('declined_allocation')}>{pending?<LoadingIndicator>Menyimpan…</LoadingIndicator>:'Ya, tidak catat tambahan'}</button></div></>:
        <button type="button" className="row-action" data-tone="warning" disabled={pending} onClick={()=>setDeclining(true)}>Tidak catat tambahan untuk revisi ini</button>}
    </div>}
  </dialog>;
}
