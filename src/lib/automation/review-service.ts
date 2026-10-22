import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { requireOwnerSession } from '@/lib/auth/session';
import { database, inDatabaseTransaction } from '@/lib/db/pool';
import { validId } from './composable-domain';
import { assessAllocationForReview, readAllocationSummaries } from './allocation-service';
import { automationReviewQuery } from './review-query';
import { formatMinor } from '../finance/format';
import { sortTemporal } from '../list-order';
import type { Storage } from './composable-facade';
import type { ActivityReviewDetail, ActivityTimelineEvent, ReviewContext, ReviewDecision } from './review-domain';

export class AutomationReviewError extends Error {}
export async function automationReviewReady(client:PoolClient|ReturnType<typeof database>=database()) {
  return (await client.query<{schedule:boolean;income:boolean;general:boolean;allocation:boolean;review:boolean}>(`SELECT
    to_regclass('recurring_transaction_occurrences') IS NOT NULL schedule,to_regclass('income_event_instances') IS NOT NULL income,
    to_regclass('automation_instances') IS NOT NULL general,to_regclass('automation_allocation_assessments') IS NOT NULL allocation,
    to_regclass('automation_activity_reviews') IS NOT NULL review`)).rows[0];
}
type Projection = {id:string;storage:Storage;status:string;rule_version:number;percentage_bps:number|null;key:string;root_id:string|null;result_id:string|null;review_ready:boolean;revision:string;
  assessment_id:string|null;assessment_stale:boolean;reviewed_at:Date|null;decision:ReviewDecision|null;original_source_minor:string|null;
  current_source_minor:string|null;last_source_minor:string|null;source_status:string|null;source_currency:string|null;source_exponent:number;
  financial_state:string;attention:ReviewContext['attention'];tab:ReviewContext['tab'];review_eligible:boolean;difference_minor:string|null};
function context(row:Projection):ReviewContext {
  return {ready:row.review_ready,ruleVersion:row.rule_version,revision:row.revision,assessmentId:row.assessment_id,assessmentStale:row.assessment_stale,
    reviewedAt:row.reviewed_at?.toISOString()??null,decision:row.decision,originalSourceMinor:row.original_source_minor,
    currentSourceMinor:row.source_status?row.current_source_minor:null,lastSourceMinor:row.last_source_minor,sourceStatus:row.source_status,
    sourceCurrency:row.source_currency,sourceExponent:row.source_exponent,financialState:row.financial_state,attention:row.attention,tab:row.tab,
    canAcknowledge:row.review_ready&&row.review_eligible&&row.attention==='needs_review',
    canDecline:row.review_ready&&row.review_eligible&&row.attention==='needs_action'&&BigInt(row.difference_minor??'0')>0n};
}
async function projections(client:PoolClient,keys:readonly string[]) {
  const query=automationReviewQuery(await automationReviewReady(client));
  if(!query || !keys.length)return [];
  return (await client.query<Projection>(`SELECT * FROM (${query}) projection WHERE key=ANY($1::text[])`,[keys])).rows;
}
export async function readAutomationReviewContexts(storage:Storage,ids:string[],existingClient?:PoolClient):Promise<Record<string,ReviewContext>> {
  await requireOwnerSession();
  const read=async(client:PoolClient)=>Object.fromEntries((await projections(client,ids.map(id=>`${storage}:${id}`))).map(row=>[row.id,context(row)]));
  return existingClient?read(existingClient):inDatabaseTransaction(read);
}
function validate(storage:unknown,id:string) {
  if(!['schedule','income_event','general'].includes(String(storage)))throw new AutomationReviewError('Sumber aktivitas tidak valid.');
  validId(id);
}
export async function acknowledgeAutomationActivity(storage:Storage,id:string,revision:string,decision:ReviewDecision) {
  await requireOwnerSession();validate(storage,id);
  if(!/^[0-9a-f]{64}$/.test(revision)||!['acknowledged','declined_allocation'].includes(decision))throw new AutomationReviewError('Keputusan tinjauan tidak valid.');
  return inDatabaseTransaction(async client=>{
    if(!(await automationReviewReady(client)).review)throw new AutomationReviewError('Pencatatan tinjauan menunggu aktivasi migration 012.');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('moneytor_general_automation_order'))");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('moneytor_income_event_order'))");
    const table=storage==='schedule'?'recurring_transaction_occurrences':storage==='income_event'?'income_event_instances':'automation_instances';
    const row=(await client.query<{result_activity_id:string|null;activity_id:string|null;root_activity_id:string|null;trigger_snapshot?:{kind:string};action_snapshot?:{amount:{strategy:string}}}>(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,[id])).rows[0];
    if(!row)throw new AutomationReviewError('Aktivitas tidak ditemukan.');
    // Lock every source/result revision, including posted adjustment chains, before revalidation.
    const key=`${storage}:${id}`;
    const initial=(await projections(client,[key]))[0];
    const additional=(await client.query<{id:string}>(`SELECT p.result_activity_id id FROM automation_allocation_adjustments p
      JOIN automation_allocation_assessments a ON a.id=p.assessment_id WHERE p.status='posted' AND
      (a.${storage==='income_event'?'legacy_instance_id':'general_instance_id'}=$1)`,[id])).rows.map(r=>r.id);
    const roots=[row.root_activity_id,row.result_activity_id,row.activity_id,...additional].filter(Boolean);
    await client.query(`WITH RECURSIVE chain AS (SELECT id FROM financial_activities WHERE id=ANY($1::uuid[])
      UNION SELECT f.id FROM financial_activities f JOIN chain ON f.replaces_activity_id=chain.id)
      SELECT f.id FROM financial_activities f JOIN chain ON f.id=chain.id ORDER BY f.id FOR SHARE OF f`,[roots]);
    if(row.result_activity_id && (storage==='income_event'||row.trigger_snapshot?.kind==='income'&&row.action_snapshot?.amount.strategy==='percentage_of_trigger')) {
      await assessAllocationForReview(client,storage as 'income_event'|'general',id);
    }
    const current=(await projections(client,[key]))[0];
    if(!current || current.revision!==revision || initial?.revision!==revision)return {stale:true,context:current?context(current):null};
    if(current.decision) {
      if(current.decision!==decision)throw new AutomationReviewError('Revisi ini sudah memiliki keputusan berbeda.');
      return {stale:false,context:context(current)};
    }
    const state=context(current);
    if(decision==='acknowledged'?!state.canAcknowledge:!state.canDecline)throw new AutomationReviewError('Aktivitas ini masih memerlukan konfirmasi / tindakan yang sesuai.');
    await client.query(`INSERT INTO automation_activity_reviews(id,schedule_instance_id,legacy_instance_id,general_instance_id,assessment_id,revision,decision,snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),storage==='schedule'?id:null,storage==='income_event'?id:null,storage==='general'?id:null,current.assessment_id,revision,decision,JSON.stringify(state)]);
    return {stale:false,context:context((await projections(client,[key]))[0])};
  });
}

export async function readAutomationActivityDetail(storage:Storage,id:string):Promise<ActivityReviewDetail> {
  await requireOwnerSession();validate(storage,id);
  return inDatabaseTransaction(async client=>{
    // A consistent, read-only snapshot; viewing details never writes assessments or acknowledgment.
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const ready=await automationReviewReady(client),row=(await projections(client,[`${storage}:${id}`]))[0];
    if(!row)throw new AutomationReviewError('Aktivitas tidak ditemukan.');
    const column=storage==='income_event'?'legacy_instance_id':storage==='general'?'general_instance_id':'schedule_instance_id';
    const adjustments=ready.allocation&&storage!=='schedule'?(await client.query<{result_activity_id:string}>(`SELECT p.result_activity_id FROM automation_allocation_adjustments p JOIN automation_allocation_assessments a ON a.id=p.assessment_id WHERE a.${column}=$1 AND p.status='posted'`,[id])).rows:[];
    const resultRoots=[row.result_id,...adjustments.map(r=>r.result_activity_id)].filter(Boolean);
    const roots=[row.root_id,...resultRoots].filter(Boolean);
    const activities=(await client.query<{id:string;root_id:string;replaces_activity_id:string|null;base_amount_minor:string;currency_code:string;created_at:Date;occurred_at:Date;depth:number;exponent:number;kind:string;void_at:Date|null}>(`WITH RECURSIVE chain AS (
      SELECT f.*,f.id root_id,0 depth FROM financial_activities f WHERE id=ANY($1::uuid[])
      UNION ALL SELECT f.*,chain.root_id,chain.depth+1 FROM financial_activities f JOIN chain ON f.replaces_activity_id=chain.id WHERE depth<100)
      SELECT chain.*,c.minor_unit_exponent exponent,(SELECT min(created_at) FROM finance_operations WHERE result_activity_id=chain.id AND operation='void') void_at
      FROM chain JOIN currencies c ON c.code=chain.currency_code ORDER BY chain.created_at,chain.id`,[roots])).rows;
    const events:ActivityTimelineEvent[]=[];
    for(const a of activities) {
      const source=a.root_id===row.root_id,previous=activities.find(p=>p.id===a.replaces_activity_id);
      const money=(value:string)=>formatMinor(value,a.currency_code,a.exponent);
      const kind=({income:'Pemasukan',expense:'Pengeluaran',transfer:'Transfer'} as Record<string,string>)[a.kind];
      const title=source?(previous?'Sumber dikoreksi':`${kind} sumber dicatat`):previous?'Hasil alokasi dikoreksi':a.root_id===row.result_id?'Hasil awal dicatat':'Penyesuaian alokasi dicatat';
      events.push({id:`financial:${a.id}`,at:a.created_at.toISOString(),kind:source?'source':'financial',title,
        description:`${previous?formatMinor(previous.base_amount_minor,previous.currency_code,previous.exponent)+' → ':''}${money(a.base_amount_minor)} · ${kind}${source?'':` · Versi aturan ${row.rule_version}${row.percentage_bps!==null?' · '+row.percentage_bps/100+'%':''}`} · Waktu transaksi: ${a.occurred_at.toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB`});
      if(a.void_at)events.push({id:`void:${a.id}`,at:a.void_at.toISOString(),kind:source?'source':'financial',title:source?'Sumber dibatalkan':'Hasil dibatalkan',description:source?`Nominal terakhir ${money(a.base_amount_minor)}; sumber efektif ${money('0')}. Hasil yang sudah dicatat tidak dibalik otomatis.`:`${money(a.base_amount_minor)} · Pembatalan melalui P3.`});
    }
    if(ready.allocation && storage!=='schedule') {
      const audit=(await client.query<{id:string;event:string;recorded_at:Date;snapshot:{currency_code:string;target_minor?:string;recognized_minor?:string;difference_minor?:string;reason?:string};exponent:number}>(`SELECT u.id::text,u.event,u.recorded_at,u.snapshot,c.minor_unit_exponent exponent FROM automation_allocation_audit u JOIN automation_allocation_assessments a ON a.id=u.assessment_id JOIN currencies c ON c.code=a.currency_code WHERE a.${column}=$1 ORDER BY u.recorded_at,u.id`,[id])).rows;
      for(const a of audit.filter(a=>a.event!=='posted'))events.push({id:`assessment:${a.id}`,at:a.recorded_at.toISOString(),kind:'assessment',title:a.event==='assessed'?'Alokasi dinilai':a.event==='failed'?'Penyesuaian gagal':a.event==='superseded'?'Usulan digantikan':'Usulan penyesuaian dibuat',
        description:a.event==='assessed'?`Target ${formatMinor(a.snapshot.target_minor!,a.snapshot.currency_code,a.exponent)} · Tercatat ${formatMinor(a.snapshot.recognized_minor!,a.snapshot.currency_code,a.exponent)} · Selisih ${formatMinor(a.snapshot.difference_minor!,a.snapshot.currency_code,a.exponent)}${a.snapshot.reason?' · '+a.snapshot.reason:''}`:'Peristiwa assessment/usulan; bukan pergerakan kas.'});
    }
    if(ready.review) for(const v of (await client.query<{id:string;decision:ReviewDecision;reviewed_at:Date}>(`SELECT id,decision,reviewed_at FROM automation_activity_reviews WHERE ${column}=$1 ORDER BY reviewed_at,id`,[id])).rows)events.push({id:`review:${v.id}`,at:v.reviewed_at.toISOString(),kind:'review',title:v.decision==='declined_allocation'?'Tambahan diputuskan tidak dicatat':'Sudah ditinjau',description:'Keputusan owner untuk revisi ini; tidak mengubah transaksi atau selisih keuangan.'});
    const allocation=storage==='schedule'?undefined:(await readAllocationSummaries(storage,[id],client))[id];
    return {context:context(row),allocation,timeline:sortTemporal(events,'asc',e=>e.at,e=>e.id),timelineNote:activities.some(a=>a.depth===100)?'Rantai koreksi panjang dibatasi pada 100 revisi. Tinjau kelanjutannya di Transactions.':'Urutan memakai waktu pencatatan yang tersimpan. Tanggal efektif transaksi ditampilkan terpisah; peristiwa yang tidak tersimpan tidak direkonstruksi.'};
  });
}
