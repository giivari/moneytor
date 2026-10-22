"use client";

import { useEffect, useState } from 'react';
import { X } from '@phosphor-icons/react';
import type { AllocationSummary, AllocationStorage } from '@/lib/automation/allocation-domain';
import { AllocationSummaryContent } from './allocation-summary';
import { formatMinor, inputToMinor } from '@/lib/finance/format';
import { requestJson } from '@/lib/finance/client';
import { useFinanceDialog, useFinanceOptions, FinanceOptionsStatus } from './finance-form-hooks';
import { useMutationPending, useFinanceFeedback } from './finance-feedback';
import { OptionalChargesEditor, type ChargeEditorRow } from './optional-charges-editor';
import { LoadingIndicator } from './loading-indicator';
import { AppLink } from './app-link';

function AdjustmentCharges({enabled,onEnabledChange,rows,onChange,disabled}:{enabled:boolean;onEnabledChange:(value:boolean)=>void;rows:ChargeEditorRow[];onChange:(value:ChargeEditorRow[])=>void;disabled:boolean}) {
  const {options,optionsError,retry}=useFinanceOptions();
  if(!options)return <FinanceOptionsStatus error={optionsError} retry={retry}/>;
  return <OptionalChargesEditor enabled={enabled} onEnabledChange={onEnabledChange} rows={rows} onChange={onChange}
    chargeTypes={options.catalogs.chargeTypes.filter(type=>type.isActive && type.systemKey!=='transfer_fee')} maxRows={20} disabled={disabled}/>;
}
export function AllocationReview({storage,id,title,onClose}:{storage:AllocationStorage;id:string;title:string;onClose:()=>void}) {
  const dialog=useFinanceDialog(onClose);
  const [value,setValue]=useState<AllocationSummary|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [extraOpen,setExtraOpen]=useState(false),[fee,setFee]=useState(''),[chargesEnabled,setChargesEnabled]=useState(false),[charges,setCharges]=useState<ChargeEditorRow[]>([]);
  const {pending,begin,finish}=useMutationPending();const {refresh,notify}=useFinanceFeedback();
  useEffect(()=>{
    let active=true;setError('');setValue(null);
    requestJson<AllocationSummary>('/api/automation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'allocation-assess',storage,id}),cache:'no-store'})
      .then(result=>{if(active)setValue(result);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Alokasi belum dapat ditinjau.');});
    return()=>{active=false;};
  },[storage,id,attempt]);
  async function confirm() {
    if(!value?.proposalId || !begin())return;setError('');
    try {
      const fees=value.confirmedFees ?? {transferFeeMinor:value.actionKind==='transfer' && extraOpen && fee?inputToMinor(fee,value.exponent):undefined,
        charges:value.actionKind==='expense' && extraOpen && chargesEnabled?charges.map(row=>({typeId:row.typeId,amountMinor:inputToMinor(row.amount,value.exponent)})):[]};
      const response=await fetch('/api/automation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'allocation-confirm',id:value.proposalId,fees}),cache:'no-store'});
      const result=await response.json() as {id?:string;assessment?:AllocationSummary;stale?:boolean;failed?:boolean;error?:string};
      if(result.assessment)setValue(result.assessment);
      if(!response.ok)throw Error(result.stale?'Sumber atau hasil berubah. Tinjau perhitungan terbaru sebelum mengonfirmasi lagi.':result.failed?'Penyesuaian belum dicatat. Periksa aset, kategori, dan biaya; lalu coba kembali.':result.error??'Penyesuaian belum dapat dicatat.');
      notify('Tambahan alokasi tercatat.');refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:'Koneksi terputus. Coba lagi untuk memeriksa posting yang sama.');}
    finally{finish();}
  }
  const canConfirm=value?.state==='additional' && !!value.proposalId && ['pending','failed'].includes(value.proposalStatus??'');
  let totalCopy='';
  if(value && canConfirm) {
    try {
      const feeTotal=value.confirmedFees
        ? BigInt(value.confirmedFees.transferFeeMinor??'0')+value.confirmedFees.charges.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n)
        : !extraOpen ? 0n : value.actionKind==='transfer' && fee ? BigInt(inputToMinor(fee,value.exponent))
        : value.actionKind==='expense' && chargesEnabled ? charges.reduce((sum,row)=>sum+BigInt(inputToMinor(row.amount,value.exponent)),0n) : 0n;
      totalCopy=`${value.actionKind==='income'?'Total kas masuk':'Total kas keluar'}: ${formatMinor((BigInt(value.differenceMinor)+feeTotal).toString(),value.currency,value.exponent)}.`;
    }catch{totalCopy='Lengkapi nominal biaya sebelum mengonfirmasi.';}
  }
  return <dialog ref={dialog} className="finance-dialog detail-dialog finance-detail" aria-labelledby="allocation-title" aria-busy={pending}
    onCancel={event=>{if(pending)event.preventDefault();}}>
    <div className="dialog-heading"><div><span className="eyebrow">PENYESUAIAN ALOKASI</span><h2 id="allocation-title">{title}</h2></div>
      <button type="button" className="icon-button" disabled={pending} aria-label="Tutup peninjauan" onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
    {!value && !error && <p role="status"><LoadingIndicator>Memeriksa sumber dan hasil…</LoadingIndicator></p>}
    {value && <><AllocationSummaryContent value={value}/>
      <p className="finance-hint">Tindakan: {value.actionKind==='expense'?'Pengeluaran':value.actionKind==='transfer'?'Transfer':'Pemasukan'} · {value.sourceName?`Dari ${value.sourceName}`:''}{value.destinationName?` → ${value.destinationName}`:''}</p>
      {canConfirm && <>
        <p className="finance-hint">Konfirmasi membuat transaksi tambahan nyata. Pokok tambahan: <strong>{formatMinor(value.differenceMinor,value.currency,value.exponent)}</strong>. Biaya transaksi awal tidak diulang.</p>
        {value.confirmedFees && <p className="finance-hint">Biaya konfirmasi tersimpan: {formatMinor((BigInt(value.confirmedFees.transferFeeMinor??'0')+value.confirmedFees.charges.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n)).toString(),value.currency,value.exponent)}.</p>}
        {value.actionKind!=='income' && !value.confirmedFees && <details open={extraOpen} onToggle={event=>setExtraOpen(event.currentTarget.open)}><summary>Biaya penyesuaian (opsional)</summary>
          {extraOpen && (value.actionKind==='transfer'?<label className="field"><span>Biaya transfer baru ({value.currency})</span><input inputMode="decimal" value={fee} disabled={pending || value.proposalStatus==='failed'} onChange={event=>setFee(event.target.value)}/></label>
            :<AdjustmentCharges enabled={chargesEnabled} onEnabledChange={setChargesEnabled} rows={charges} onChange={setCharges} disabled={pending || value.proposalStatus==='failed'}/>)}
        </details>}
        <p className="finance-hint">Biaya baru hanya dicatat bila diisi secara eksplisit; tidak termasuk target persentase. Setelah percobaan pertama, retry memakai biaya yang sama.</p>
        <p className="finance-hint"><strong>{totalCopy}</strong></p>
      </>}
    </>}
    {error && <p role="alert" className="finance-error">{error}</p>}
    <AppLink href="/transactions" className="text-link" aria-disabled={pending} onClick={event=>{if(pending)event.preventDefault();}}>Tinjau transaksi sumber / hasil</AppLink>
    <div className="finance-actions">
      {!value && error && <button type="button" className="finance-secondary" onClick={()=>setAttempt(current=>current+1)}>Coba lagi</button>}
      <button type="button" className="finance-secondary" disabled={pending} onClick={()=>dialog.current?.close()}>Tutup</button>
      {canConfirm && <button type="button" className="button-primary" disabled={pending} onClick={()=>void confirm()}>{pending?<LoadingIndicator>Mencatat…</LoadingIndicator>:'Konfirmasi tambahan'}</button>}
    </div>
  </dialog>;
}
