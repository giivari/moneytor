import type { AllocationSummary } from '@/lib/automation/allocation-domain';
import { bpsToPercent } from '@/lib/automation/composable-domain';
import { formatMinor } from '@/lib/finance/format';

export function AllocationSummaryContent({value,historicalAssessment=false}:{value:AllocationSummary;historicalAssessment?:boolean}) {
  const money=(amount:string)=>formatMinor(amount,value.currency,value.exponent);
  return <>
    {value.sourceVoided && <p className="finance-hint">Pemasukan sumber dibatalkan. Hasil alokasi tetap tersimpan dan tidak dibalik otomatis.</p>}
    <dl className="detail-list">
      <div><dt>{historicalAssessment?'Pemasukan saat assessment':value.sourceVoided?'Pemasukan terakhir sebelum pembatalan':'Pemasukan terkini'}</dt><dd>{money(value.sourceMinor)} · {new Date(value.sourceAt).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})}</dd></div>
      {value.sourceVoided && <div><dt>Pemasukan efektif</dt><dd>{money('0')}</dd></div>}
      <div><dt>{historicalAssessment?`Target saat assessment (${bpsToPercent(value.percentageBps)}%)`:value.sourceVoided?'Target alokasi efektif':`Target (${bpsToPercent(value.percentageBps)}%)`}</dt><dd>{money(value.targetMinor)}</dd></div>
      <div><dt>Hasil awal efektif</dt><dd>{money(value.originalMinor)}</dd></div>
      <div><dt>Tambahan efektif</dt><dd>{money(value.adjustmentMinor)}</dd></div>
      <div><dt>{value.sourceVoided?'Hasil yang tetap tercatat':'Sudah tercatat'}</dt><dd>{money(value.recognizedMinor)}</dd></div>
      <div className="detail-total"><dt>{historicalAssessment?'Selisih saat assessment':BigInt(value.differenceMinor)<0n?'Kelebihan alokasi':BigInt(value.differenceMinor)>0n?'Kurang dialokasikan':value.state==='blocked'?'Selisih keuangan':'Alokasi sesuai'}</dt>
        <dd>{money((BigInt(value.differenceMinor)<0n?-BigInt(value.differenceMinor):BigInt(value.differenceMinor)).toString())}</dd></div>
    </dl>
    {value.reason && <p className="finance-hint">{value.reason}</p>}
    {value.state==='blocked' && <p className="finance-hint">Perlu ditinjau. Selisih tidak menyatakan bahwa aturan masih memenuhi syarat.</p>}
    {value.state==='excess' && <p className="finance-hint">Tidak ada refund atau pembatalan otomatis. Gunakan koreksi/pembatalan di Transactions bila memang ada perubahan keuangan.</p>}
  </>;
}
