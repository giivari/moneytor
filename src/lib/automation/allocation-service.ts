import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { requireOwnerSession } from '@/lib/auth/session';
import { database, inDatabaseTransaction } from '@/lib/db/pool';
import { postActivityInTransaction } from '@/lib/finance/service';
import type { ActivityDraft } from '@/lib/finance/types';
import { evaluateConditions, resolveAsset, validId, positiveMinor, type GeneralRuleInput, type FinancialAction, type TriggerContext } from './composable-domain';
import { allocationDifference, AllocationError, type AllocationStorage, type AllocationSummary } from './allocation-domain';

type Activity = { id: string; kind: 'income' | 'expense' | 'transfer'; status: string; base_amount_minor: string;
  currency_code: string; source_asset_id: string | null; destination_asset_id: string | null; category_id: string | null; occurred_at: Date; depth: number };
type Adapter = { id: string; rule_id: string; version: number; root: string; original: string; title: string; status: string;
  currency: string; source: string | null; destination: string | null; action: FinancialAction; rule: GeneralRuleInput | null;
  originalSource: TriggerContext; conditions: unknown };
type Assessment = { id: string; legacy_instance_id: string | null; general_instance_id: string | null; root_activity_id: string;
  source_amount_minor: string; target_minor: string; recognized_minor: string; difference_minor: string; original_result_id: string;
  percentage_bps: number; currency_code: string; action_kind: ActivityDraft['kind']; state: AllocationSummary['state']; reason: string | null;
  source_asset_id: string | null; destination_asset_id: string | null; category_id: string | null;
  source_snapshot: Activity; rule_snapshot: { title: string; version: number; evaluatedConditions?: {matched:boolean} }; result_snapshot: Activity[]; fingerprint: string; basis_fingerprint: string };
type Proposal = { id: string; assessment_id: string; status: string; result_activity_id: string | null; confirmation_hash: string | null;
  created_at: Date; amount_minor: string; transfer_fee_minor:string|null; charges:{typeId:string;amountMinor:string}[] };
type Fees = { transferFeeMinor?: string; charges?: {typeId: string; amountMinor: string}[] };
export async function allocationReady(client?:PoolClient) {
  return (await (client??database()).query<{ready:boolean}>("SELECT to_regclass('automation_allocation_assessments') IS NOT NULL AS ready")).rows[0].ready;
}
/** Receipt is committed with P3; corrections keep the same P3 root identity. */
export async function allocationDiscoveryFilter(client: PoolClient) {
  const ready=(await client.query<{ready:boolean}>("SELECT to_regclass('automation_allocation_adjustments') IS NOT NULL AS ready")).rows[0].ready;
  return ready ? 'AND NOT EXISTS(SELECT 1 FROM automation_allocation_adjustments adjustment WHERE adjustment.result_activity_id=s.root_activity_id)' : '';
}
export async function allocationResultOrigin(client: PoolClient, rootId: string) {
  const ready=(await client.query<{ready:boolean}>("SELECT to_regclass('automation_allocation_adjustments') IS NOT NULL AS ready")).rows[0].ready;
  if(!ready)return null;
  return (await client.query<{instance_id:string;rule_id:string}>(`SELECT COALESCE(a.legacy_instance_id,a.general_instance_id) AS instance_id,a.rule_snapshot->>'ruleId' AS rule_id
    FROM automation_allocation_adjustments p JOIN automation_allocation_assessments a ON a.id=p.assessment_id WHERE p.result_activity_id=$1`,[rootId])).rows[0]??null;
}
async function lockEngine(client: PoolClient) {
  // Same ordering as generic discovery/lifecycle. P3 source/result chains are locked separately.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('moneytor_general_automation_order'))");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('moneytor_income_event_order'))");
}
async function adapter(client: PoolClient, storage: AllocationStorage, id: string): Promise<Adapter> {
  if (storage === 'income_event') {
    const row = (await client.query<{id:string;rule_id:string;rule_version:number;root_activity_id:string;result_activity_id:string|null;
      source_currency:string;source_asset_id:string;destination_asset_id:string|null;output_kind:'expense'|'transfer';category_id:string|null;
      percentage_bps:number;source_amount_minor:string;source_occurred_at:Date;effective_activity_id:string;status:string;title:string;
      charges:FinancialAction['charges'];transfer_fee_minor:string|null;note:string|null}>(
      `SELECT i.*,r.status AS rule_status,v.title FROM income_event_instances i JOIN income_event_rules r ON r.id=i.rule_id
       JOIN income_event_rule_versions v ON v.rule_id=i.rule_id AND v.version_no=i.rule_version WHERE i.id=$1 FOR UPDATE OF i`,[id])).rows[0];
    if (!row?.result_activity_id) throw new AllocationError('Aktivitas ini belum memiliki hasil alokasi.');
    const status = (await client.query<{status:string}>('SELECT status FROM income_event_rules WHERE id=$1 FOR SHARE',[row.rule_id])).rows[0].status;
    return {id,rule_id:row.rule_id,version:row.rule_version,root:row.root_activity_id,original:row.result_activity_id,title:row.title,status,
      currency:row.source_currency,source:row.source_asset_id,destination:row.destination_asset_id,
      action:{kind:row.output_kind,amount:{strategy:'percentage_of_trigger',percentageBps:row.percentage_bps},
        source:{strategy:'trigger_destination_asset'},destination:row.destination_asset_id?{strategy:'configured_asset',assetId:row.destination_asset_id}:undefined,
        categoryId:row.category_id??undefined,charges:row.charges,transferFeeMinor:row.transfer_fee_minor??undefined,note:row.note??undefined},rule:null,conditions:null,
      originalSource:{namespace:'transaction_posted',identity:row.root_activity_id,eligibleAt:row.source_occurred_at.toISOString(),occurredAt:row.source_occurred_at.toISOString(),
        effectiveActivityId:row.effective_activity_id,kind:'income',amountMinor:row.source_amount_minor,currency:row.source_currency,destinationAssetId:row.source_asset_id,origin:'manual'}};
  }
  const row = (await client.query<{id:string;rule_id:string;version_no:number;root_activity_id:string|null;result_activity_id:string|null;
    currency_code:string;resolved_source_asset_id:string|null;resolved_destination_asset_id:string|null;action_snapshot:FinancialAction;
    trigger_snapshot:TriggerContext;condition_snapshot:unknown;trigger_namespace:string;title:string;condition_mode:'ALL'|'ANY';trigger_config:GeneralRuleInput['trigger']}>(
    `SELECT i.*,v.title,v.condition_mode,v.trigger_config FROM automation_instances i JOIN automation_rule_versions v
      ON v.rule_id=i.rule_id AND v.version_no=i.version_no WHERE i.id=$1 FOR UPDATE OF i`,[id])).rows[0];
  if (!row?.result_activity_id || row.trigger_namespace !== 'transaction_posted' || !row.root_activity_id || row.trigger_snapshot.kind !== 'income'
    || row.action_snapshot.amount.strategy !== 'percentage_of_trigger') throw new AllocationError('Aturan ini tidak mendukung rekonsiliasi alokasi pemasukan.');
  const status=(await client.query<{status:string}>('SELECT status FROM automation_rules WHERE id=$1 FOR SHARE',[row.rule_id])).rows[0].status;
  const conditions=(await client.query<{field:GeneralRuleInput['conditions'][number]['field'];operator:GeneralRuleInput['conditions'][number]['operator'];
    activity_kind:string|null;asset_id:string|null;category_id:string|null;currency_code:string|null;amount_minor:string|null;upper_amount_minor:string|null}>(
    'SELECT * FROM automation_conditions WHERE rule_id=$1 AND version_no=$2 ORDER BY position',[row.rule_id,row.version_no])).rows.map(item=>({
      field:item.field,operator:item.operator,value:item.activity_kind??item.asset_id??item.category_id??item.amount_minor??item.currency_code!,
      ...(item.upper_amount_minor?{upperValue:item.upper_amount_minor}:{}),...(item.field==='base_amount'?{currency:item.currency_code!}:{})}));
  return {id,rule_id:row.rule_id,version:row.version_no,root:row.root_activity_id,original:row.result_activity_id,title:row.title,status,
    currency:row.currency_code,source:row.resolved_source_asset_id,destination:row.resolved_destination_asset_id,action:row.action_snapshot,
    originalSource:row.trigger_snapshot,conditions:row.condition_snapshot,
    rule:{title:row.title,trigger:row.trigger_config,conditionMode:row.condition_mode,conditions,actions:[row.action_snapshot],execution:'confirm_before_execute'}};
}
async function effective(client: PoolClient, root: string): Promise<Activity> {
  // READ COMMITTED: reread after acquiring locks; a replacement committed while waiting must be included.
  for (let attempt=0;attempt<5;attempt++) {
    const chain=(await client.query<Activity>(`WITH RECURSIVE chain AS (
      SELECT id,kind,status,base_amount_minor,currency_code,source_asset_id,destination_asset_id,category_id,occurred_at,0 AS depth
      FROM financial_activities WHERE id=$1 UNION ALL
      SELECT f.id,f.kind,f.status,f.base_amount_minor,f.currency_code,f.source_asset_id,f.destination_asset_id,f.category_id,f.occurred_at,c.depth+1
      FROM financial_activities f JOIN chain c ON f.replaces_activity_id=c.id WHERE c.depth<100)
      SELECT * FROM chain ORDER BY depth`,[root])).rows;
    if (!chain.length || chain.length>100) throw new AllocationError('Riwayat koreksi perlu ditinjau sebelum penyesuaian.');
    await client.query('SELECT id FROM financial_activities WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[chain.map(row=>row.id)]);
    const next=(await client.query('SELECT id FROM financial_activities WHERE replaces_activity_id=$1',[chain.at(-1)!.id])).rows;
    const current=(await client.query<Activity>('SELECT *, $2::int AS depth FROM financial_activities WHERE id=$1',[chain.at(-1)!.id,chain.length-1])).rows[0];
    if (!next.length) return current;
  }
  throw new AllocationError('Riwayat sedang berubah. Muat ulang dan tinjau kembali.');
}
function context(item: Adapter, source: Activity): TriggerContext {
  return {...item.originalSource,effectiveActivityId:source.id,kind:source.kind,status:source.status,amountMinor:source.base_amount_minor,currency:source.currency_code,
    sourceAssetId:source.source_asset_id??undefined,destinationAssetId:source.destination_asset_id??undefined,categoryId:source.category_id??undefined,occurredAt:source.occurred_at.toISOString()};
}
const instanceColumn=(storage:AllocationStorage)=>storage==='income_event'?'legacy_instance_id':'general_instance_id';
async function assess(client:PoolClient, storage:AllocationStorage, id:string):Promise<Assessment> {
  const item=await adapter(client,storage,id);
  const source=await effective(client,item.root);
  const resultIds=(await client.query<{result_activity_id:string}>(`SELECT p.result_activity_id FROM automation_allocation_adjustments p
    JOIN automation_allocation_assessments a ON a.id=p.assessment_id WHERE a.${instanceColumn(storage)}=$1 AND p.status='posted' ORDER BY p.id`,[id])).rows.map(row=>row.result_activity_id);
  const results:Activity[]=[];
  for(const resultId of [item.original,...resultIds])results.push(await effective(client,resultId));
  let reason:string|null=null;
  if(source.kind!=='income' || source.currency_code!==item.currency)reason='Jenis atau mata uang pemasukan berubah; tinjau transaksi sumber.';
  const ctx=context(item,source);
  if(source.status==='posted' && (resolveAsset(item.action.source,ctx)!==(item.source??undefined) || resolveAsset(item.action.destination,ctx)!==(item.destination??undefined)))reason='Aset sumber berubah; penyesuaian tidak akan memilih aset lain secara otomatis.';
  const conditionResult=item.rule?evaluateConditions(item.rule,ctx):{matched:true};
  if(source.status==='posted' && !conditionResult.matched)reason='Pemasukan terbaru tidak lagi memenuhi kondisi asli aturan.';
  const principals=results.map(result=>{
    if(result.status!=='posted')return '0';
    if(result.currency_code!==item.currency || result.kind!==item.action.kind || result.source_asset_id!==item.source || result.destination_asset_id!==item.destination) {
      reason='Jenis, aset, atau mata uang hasil alokasi berubah; tinjau koreksi hasil di Transactions.';
      return '0';
    }
    return result.base_amount_minor;
  });
  const calculation=allocationDifference(source.kind==='income' && source.currency_code===item.currency?source.base_amount_minor:'0',
    (item.action.amount as Extract<FinancialAction['amount'],{strategy:'percentage_of_trigger'}>).percentageBps,principals,source.status!=='posted');
  if(calculation.state==='additional' && item.status!=='active')reason='Aktifkan kembali aturan sebelum mencatat penyesuaian.';
  const assets=(await client.query<{id:string;currency_code:string;is_active:boolean}>('SELECT id,currency_code,is_active FROM assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[[item.source,item.destination].filter(Boolean)])).rows;
  if(calculation.state==='additional' && (assets.some(asset=>!asset.is_active || asset.currency_code!==item.currency) || assets.length!==[item.source,item.destination].filter(Boolean).length))reason='Aset alokasi tidak aktif atau mata uangnya tidak sesuai.';
  const snapshot={title:item.title,ruleId:item.rule_id,version:item.version,action:item.action,originalConditions:item.conditions,evaluatedConditions:conditionResult,lifecycle:item.status};
  const fingerprint=createHash('sha256').update(JSON.stringify({snapshot,source,results,calculation,reason})).digest('hex');
  const previous=(await client.query<Assessment>(`SELECT * FROM automation_allocation_assessments WHERE ${instanceColumn(storage)}=$1 ORDER BY assessed_at DESC,id DESC LIMIT 1`,[id])).rows[0];
  if(previous?.basis_fingerprint===fingerprint)return previous;
  // The same values may recur after restore. A new boundary must not revive a stale proposal.
  const identity=createHash('sha256').update(fingerprint+(previous?.id??'')).digest('hex');
  await client.query(`UPDATE automation_allocation_adjustments p SET status='superseded',updated_at=clock_timestamp()
    FROM automation_allocation_assessments a WHERE p.assessment_id=a.id AND a.${instanceColumn(storage)}=$1 AND p.status IN ('pending','failed')`,[id]);
  const assessmentId=randomUUID();
  const saved=(await client.query<Assessment>(`INSERT INTO automation_allocation_assessments
    (id,legacy_instance_id,general_instance_id,root_activity_id,effective_activity_id,original_result_id,fingerprint,percentage_bps,currency_code,
     source_amount_minor,target_minor,recognized_minor,difference_minor,action_kind,source_asset_id,destination_asset_id,category_id,
     rule_snapshot,source_snapshot,result_snapshot,state,reason,basis_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
    [assessmentId,storage==='income_event'?id:null,storage==='general'?id:null,item.root,source.id,item.original,identity,
      (item.action.amount as Extract<FinancialAction['amount'],{strategy:'percentage_of_trigger'}>).percentageBps,item.currency,
      source.kind==='income' && source.currency_code===item.currency?source.base_amount_minor:'0',calculation.targetMinor,calculation.recognizedMinor,calculation.differenceMinor,
      item.action.kind,item.source,item.destination,item.action.categoryId??null,JSON.stringify(snapshot),JSON.stringify(source),JSON.stringify(results),reason?'blocked':calculation.state,reason,fingerprint])).rows[0];
  if(saved.state==='additional')await client.query('INSERT INTO automation_allocation_adjustments(id,assessment_id,amount_minor) VALUES($1,$2,$3)',[randomUUID(),saved.id,saved.difference_minor]);
  if(saved.state!=='aligned')await client.query(`UPDATE ${storage==='income_event'?'income_event_instances':'automation_instances'} SET status='review_required',updated_at=clock_timestamp() WHERE id=$1 AND result_activity_id IS NOT NULL AND status<>'review_required'`,[id]);
  return saved;
}
async function summary(client:PoolClient,a:Assessment):Promise<AllocationSummary> {
  const p=(await client.query<Proposal>('SELECT * FROM automation_allocation_adjustments WHERE assessment_id=$1',[a.id])).rows[0];
  const assets=(await client.query<{id:string;display_name:string}>('SELECT id,display_name FROM assets WHERE id=ANY($1::uuid[])',[[a.source_asset_id,a.destination_asset_id].filter(Boolean)])).rows;
  const exponent=(await client.query<{minor_unit_exponent:number}>('SELECT minor_unit_exponent FROM currencies WHERE code=$1',[a.currency_code])).rows[0].minor_unit_exponent;
  const first=a.result_snapshot[0];
  const original=first?.status==='posted' && first.kind===a.action_kind && first.currency_code===a.currency_code
    && first.source_asset_id===a.source_asset_id && first.destination_asset_id===a.destination_asset_id?first.base_amount_minor:'0';
  return {assessmentId:a.id,proposalId:p?.id??null,storage:a.legacy_instance_id?'income_event':'general',instanceId:a.legacy_instance_id??a.general_instance_id!,state:a.state,
    currency:a.currency_code,exponent,percentageBps:a.percentage_bps,sourceMinor:a.source_amount_minor,targetMinor:a.target_minor,recognizedMinor:a.recognized_minor,differenceMinor:a.difference_minor,
    sourceVoided:a.source_snapshot.status!=='posted',conditionsMatched:a.rule_snapshot.evaluatedConditions?.matched,reason:a.reason,actionKind:a.action_kind,sourceName:assets.find(row=>row.id===a.source_asset_id)?.display_name??null,
    destinationName:assets.find(row=>row.id===a.destination_asset_id)?.display_name??null,originalMinor:original,adjustmentMinor:(BigInt(a.recognized_minor)-BigInt(original)).toString(),
    sourceAt:new Date(a.source_snapshot.occurred_at).toISOString(),proposalStatus:p?.status??null,
    confirmedFees:p?.confirmation_hash?{transferFeeMinor:p.transfer_fee_minor??undefined,charges:p.charges}:null};
}
export async function assessAllocation(storage:AllocationStorage,id:string):Promise<AllocationSummary> {
  await requireOwnerSession(); validateStorage(storage);validId(id);
  if(!await allocationReady())throw new AllocationError('Penyesuaian alokasi menunggu aktivasi database.');
  return inDatabaseTransaction(async client=>{await lockEngine(client);return summary(client,await assess(client,storage,id));});
}
/** Review command shares the established transaction/locks; assessment has no P3 posting. */
export async function assessAllocationForReview(client:PoolClient,storage:AllocationStorage,id:string) {
  return summary(client,await assess(client,storage,id));
}
function validateStorage(storage:unknown):asserts storage is AllocationStorage {
  if(storage!=='general' && storage!=='income_event')throw new AllocationError('Sumber alokasi tidak didukung.');
}
function fees(raw:Fees,kind:ActivityDraft['kind']) {
  if(!raw || typeof raw!=='object' || Array.isArray(raw))throw new AllocationError('Biaya penyesuaian tidak valid.');
  if(!Array.isArray(raw.charges??[]) || (raw.charges??[]).length>20)throw new AllocationError('Biaya tambahan tidak valid.');
  const charges=(raw.charges??[]).map(charge=>{
    if(!charge || typeof charge!=='object' || Array.isArray(charge))throw new AllocationError('Biaya tambahan tidak valid.');
    return {typeId:validId(charge.typeId),amountMinor:positiveMinor(charge.amountMinor)};
  });
  const transferFeeMinor=raw.transferFeeMinor && raw.transferFeeMinor!=='0'?positiveMinor(raw.transferFeeMinor):undefined;
  if((kind!=='expense' && charges.length) || (kind!=='transfer' && transferFeeMinor))throw new AllocationError('Biaya tidak sesuai tindakan penyesuaian.');
  return {charges,transferFeeMinor};
}
export async function confirmAllocation(proposalId:string,rawFees:Fees={}) {
  await requireOwnerSession();validId(proposalId);
  if(!await allocationReady())throw new AllocationError('Penyesuaian alokasi menunggu aktivasi database.');
  const result=await inDatabaseTransaction(async client=>{
    await lockEngine(client);
    const p=(await client.query<Proposal>('SELECT * FROM automation_allocation_adjustments WHERE id=$1 FOR UPDATE',[proposalId])).rows[0];
    if(!p)throw new AllocationError('Usulan penyesuaian tidak ditemukan.');
    const old=(await client.query<Assessment>('SELECT * FROM automation_allocation_assessments WHERE id=$1',[p.assessment_id])).rows[0];
    const extra=fees(rawFees,old.action_kind),hash=createHash('sha256').update(JSON.stringify(extra)).digest('hex');
    if(p.confirmation_hash && p.confirmation_hash!==hash)throw new AllocationError('Biaya berbeda dari konfirmasi pertama. Tinjau usulan kembali.');
    if(p.status==='posted')return {id:p.result_activity_id!,assessment:await summary(client,await assess(client,old.legacy_instance_id?'income_event':'general',old.legacy_instance_id??old.general_instance_id!))};
    const current=await assess(client,old.legacy_instance_id?'income_event':'general',old.legacy_instance_id??old.general_instance_id!);
    if(current.id!==old.id || !['pending','failed'].includes(p.status) || current.state!=='additional')return {stale:true,assessment:await summary(client,current)};
    await client.query("UPDATE automation_allocation_adjustments SET confirmation_hash=$2,confirmed_by='owner',confirmed_at=clock_timestamp(),charges=$3,transfer_fee_minor=$4,attempts=attempts+1,updated_at=clock_timestamp() WHERE id=$1",
      [p.id,hash,JSON.stringify(extra.charges),extra.transferFeeMinor??null]);
    await client.query('SAVEPOINT allocation_post');
    try {
      const activity=await postActivityInTransaction(client,{kind:current.action_kind,amountMinor:current.difference_minor,
        sourceAssetId:current.source_asset_id??undefined,destinationAssetId:current.destination_asset_id??undefined,categoryId:current.category_id??undefined,
        charges:extra.charges,transferFeeMinor:extra.transferFeeMinor,occurredAt:p.created_at.toISOString(),note:`Penyesuaian alokasi · ${current.rule_snapshot.title}`},p.id);
      await client.query("UPDATE automation_allocation_adjustments SET status='posted',result_activity_id=$2,failure_reason=NULL,updated_at=clock_timestamp() WHERE id=$1",[p.id,activity]);
      const assessment=await summary(client,await assess(client,old.legacy_instance_id?'income_event':'general',old.legacy_instance_id??old.general_instance_id!));
      await client.query('RELEASE SAVEPOINT allocation_post');
      return {id:activity,assessment};
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT allocation_post');
      await client.query("UPDATE automation_allocation_adjustments SET status='failed',failure_reason=$2,updated_at=clock_timestamp() WHERE id=$1",[p.id,'Penyesuaian belum dicatat. Periksa aset, kategori dan biaya, lalu coba kembali.']);
      return {failed:true,assessment:await summary(client,current)};
    }
  });
  // Changed assessments/failure audits commit even when the HTTP confirmation is rejected.
  return result;
}
export async function readAllocationSummaries(storage:AllocationStorage,ids:string[],existingClient?:PoolClient):Promise<Record<string,AllocationSummary>> {
  await requireOwnerSession(); if(!ids.length || !await allocationReady(existingClient))return {};
  const read=async (client:PoolClient)=>{
    const rows=(await client.query<Assessment>(`SELECT DISTINCT ON (${instanceColumn(storage)}) * FROM automation_allocation_assessments
      WHERE ${instanceColumn(storage)}=ANY($1::uuid[]) ORDER BY ${instanceColumn(storage)},assessed_at DESC,id DESC`,[ids])).rows;
    const output:Record<string,AllocationSummary>={};for(const a of rows)output[a.legacy_instance_id??a.general_instance_id!]=await summary(client,a);return output;
  };
  return existingClient?read(existingClient):inDatabaseTransaction(read);
}
export async function reconcileAllocations() {
  await requireOwnerSession(); if(!await allocationReady())return {ready:false,assessed:0};
  return inDatabaseTransaction(async client=>{
    await lockEngine(client);
    let assessed=0;
    for(const storage of ['income_event','general'] as const) {
      const table=storage==='income_event'?'income_event_instances':'automation_instances';
      const eligible=storage==='income_event'?'TRUE':"i.trigger_namespace='transaction_posted' AND i.trigger_snapshot->>'kind'='income' AND i.action_snapshot->'amount'->>'strategy'='percentage_of_trigger'";
      const rows=(await client.query<{id:string}>(`SELECT i.id FROM ${table} i LEFT JOIN LATERAL (
        SELECT * FROM automation_allocation_assessments WHERE ${instanceColumn(storage)}=i.id ORDER BY assessed_at DESC,id DESC LIMIT 1) a ON TRUE
        WHERE i.result_activity_id IS NOT NULL AND ${eligible} AND (a.id IS NULL
          OR EXISTS(SELECT 1 FROM financial_activities f WHERE f.id=a.effective_activity_id AND
             (f.status IS DISTINCT FROM a.source_snapshot->>'status' OR EXISTS(SELECT 1 FROM financial_activities n WHERE n.replaces_activity_id=f.id)))
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(a.result_snapshot) r JOIN financial_activities f ON f.id=(r->>'id')::uuid WHERE
             f.status IS DISTINCT FROM r->>'status' OR EXISTS(SELECT 1 FROM financial_activities n WHERE n.replaces_activity_id=f.id))
          OR a.rule_snapshot->>'lifecycle' IS DISTINCT FROM (SELECT status FROM ${storage==='income_event'?'income_event_rules':'automation_rules'} WHERE id=i.rule_id))
        ORDER BY a.assessed_at NULLS FIRST,i.id LIMIT 50`,[])).rows;
      for(const row of rows){await assess(client,storage,row.id);assessed++;}
    }
    return {ready:true,assessed};
  });
}
