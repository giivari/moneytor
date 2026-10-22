import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import pg from 'pg';
const name=process.env.MONEYTOR_ALLOCATION_DB_TEST;
test('Allocation reconciliation on disposable PostgreSQL',{skip:!/^moneytor_composable_verify_\d+$/.test(name??'')},async t=>{
  const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55433');assert.equal(url.pathname,`/${name}`);
  const admin=new pg.Client({connectionString:url.toString()});await admin.connect();
  const schema=`allocation_${randomUUID().replaceAll('-','')}`;let pool,hooks;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);await admin.query(`SET search_path TO ${schema}`);
    for(const file of (await readdir(new URL('../db/migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')).sort())await admin.query(await readFile(new URL(`../db/migrations/${file}`,import.meta.url),'utf8'));
    url.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();
    hooks=registerHooks({resolve(specifier,context,next){
      if(specifier==='@/lib/auth/session')return {url:"data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__allocationAuthorized)throw Error('Unauthorized');return {credentialId:'disposable'}}",shortCircuit:true};
      if(specifier.startsWith('@/'))return next(new URL(`../src/${specifier.slice(2)}.ts`,import.meta.url).href,context);
      if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(new URL(`${specifier}.ts`,context.parentURL).href,context);
      return next(specifier,context);
    }});
    const finance=await import('../src/lib/finance/service.ts'),engine=await import('../src/lib/automation/composable-service.ts');
    const events=await import('../src/lib/automation/income-events.ts'),allocation=await import('../src/lib/automation/allocation-service.ts');
    const review=await import('../src/lib/automation/review-service.ts');
    const {readAutomationHistoryPage}=await import('../src/lib/automation/history-page.ts');
    const {unifyAutomation}=await import('../src/lib/automation/composable-facade.ts');
    const {insertAssetWithOpening}=await import('../src/lib/repositories/assets.ts');pool=(await import('../src/lib/db/pool.ts')).database();
    await assert.rejects(allocation.assessAllocation('general',randomUUID()),/Unauthorized/);globalThis.__allocationAuthorized=true;
    const type=(await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const asset=async(title,currency='IDR')=>insertAssetWithOpening({displayName:title,currency,assetTypeId:type,normallyLiquid:true,normallySpendable:true,openingAmountMinor:10000000n,openingEffectiveAt:new Date('2026-01-01T00:00:00Z')});
    const source=await asset('Allocation source'),destination=await asset('Allocation destination'),other=await asset('Different source');
    const draft=(amount,sourceId=source)=>({kind:'income',amountMinor:String(amount),destinationAssetId:sourceId,occurredAt:new Date().toISOString()});
    const count=async(table,where='',params=[])=>(await admin.query(`SELECT count(*)::int n FROM ${table} ${where}`,params)).rows[0].n;
    const activity=async id=>(await admin.query('SELECT * FROM financial_activities WHERE id=$1',[id])).rows[0];
    const setStatus=(storage,id,status)=>storage==='general'?engine.setGeneralRuleStatus(id,status):events.setIncomeEventRuleStatus(id,status);
    async function scenario(storage,kind='expense',extra={}) {
      for(const row of (await admin.query("SELECT id FROM automation_rules WHERE status='active'")).rows)await engine.setGeneralRuleStatus(row.id,'paused');
      for(const row of (await admin.query("SELECT id FROM income_event_rules WHERE status='active'")).rows)await events.setIncomeEventRuleStatus(row.id,'paused');
      const action={kind,source:kind==='income'?undefined:{strategy:'trigger_destination_asset'},destination:kind==='expense'?undefined:{strategy:'configured_asset',assetId:destination},amount:{strategy:'percentage_of_trigger',percentageBps:1000},charges:[]};
      const input={title:'Allocation original 10%',trigger:{namespace:'transaction_posted',activityKind:'income'},conditionMode:'ALL',conditions:[],actions:[action],execution:'confirm_before_execute',...extra};
      const rule=storage==='general'?await engine.saveGeneralRule(input):await events.saveIncomeEventRule({title:input.title,percentageBps:1000,outputKind:kind,destinationAssetId:kind==='transfer'?destination:undefined,...extra});
      const root=await finance.postActivity(draft('1000000'),randomUUID());
      if(storage==='general')await engine.reconcileGeneralAutomation();else await events.reconcileIncomeEvents();
      const table=storage==='general'?'automation_instances':'income_event_instances';
      const instance=(await admin.query(`SELECT * FROM ${table} WHERE rule_id=$1 AND root_activity_id=$2`,[rule,root])).rows[0];
      const original=storage==='general'?await engine.confirmGeneralInstance(instance.id):await events.postIncomeEvent(instance.id);
      let latest=root;
      return {storage,rule,input,root,instance:instance.id,original,table,
        correct:async(amount,assetId=source)=>latest=await finance.replaceActivity(latest,draft(amount,assetId),randomUUID()),
        voidSource:()=>finance.voidActivity(latest,randomUUID()),
        assess:()=>allocation.assessAllocation(storage,instance.id),
        confirm:(id,fees)=>allocation.confirmAllocation(id,fees)};
    }
    await t.test('empty migration is additive and zero-rule reconciliation makes no P3 posting',async()=>{
      const before=await count('financial_activities');assert.deepEqual(await allocation.reconcileAllocations(),{ready:true,assessed:0});
      for(const table of ['automation_allocation_assessments','automation_allocation_adjustments','automation_allocation_audit'])assert.equal(await count(table),0);
      assert.equal(await count('financial_activities'),before);
    });
    for(const storage of ['general','income_event']) {
      await t.test(`${storage}: aligned posting moves to exclusive history, with truthful source/adjustment timeline`,async()=>{
        const s=await scenario(storage);await s.correct('1300000');const a=await s.assess();await s.confirm(a.proposalId);
        const detail=await review.readAutomationActivityDetail(storage,s.instance);
        assert.equal(detail.context.tab,'history');assert.equal(detail.context.financialState,'allocation_aligned');assert.equal(detail.context.attention,'none');
        assert.equal(detail.context.canAcknowledge,false);assert.equal(detail.context.currentSourceMinor,'1300000');assert.equal(detail.context.originalSourceMinor,'1000000');
        assert.equal(detail.timeline.filter(e=>e.title==='Pemasukan sumber dicatat').length,1);
        assert.equal(detail.timeline.filter(e=>e.title==='Penyesuaian alokasi dicatat').length,1);
        assert.ok(detail.timeline.some(e=>e.title==='Sumber dikoreksi'&&e.description.includes('Rp1.000.000 → Rp1.300.000')));
        for(let n=1;n<detail.timeline.length;n++)assert.ok(detail.timeline[n-1].at<=detail.timeline[n].at);
        const page=await readAutomationHistoryPage({direction:'desc',limit:10,source:'transaction_posted',category:''});
        assert.equal(page.items.filter(i=>i.id===s.instance).length,1);
        assert.equal(page.items.find(i=>i.id===s.instance).review.tab,'history');
      });
      await t.test(`${storage}: acknowledged excess/void preserve finance, retries are idempotent and new revisions reopen`,async()=>{
        const s=await scenario(storage);await s.correct('1400000');const a=await s.assess();await s.confirm(a.proposalId);
        await s.correct('1100000');await s.assess();const excess=await review.readAutomationActivityDetail(storage,s.instance);
        assert.equal(excess.context.financialState,'allocation_excess');assert.equal(excess.context.tab,'attention');assert.equal(excess.allocation.differenceMinor,'-30000');
        const fingerprint=async()=>{const result={};for(const table of ['financial_activities','ledger_movements','finance_operations','automation_instances','income_event_instances'])result[table]=(await admin.query(`SELECT md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) h FROM ${table} t`)).rows[0].h;return result;};
        const before=await fingerprint();
        const [one,two]=await Promise.all([review.acknowledgeAutomationActivity(storage,s.instance,excess.context.revision,'acknowledged'),review.acknowledgeAutomationActivity(storage,s.instance,excess.context.revision,'acknowledged')]);
        assert.equal(one.context.reviewedAt,two.context.reviewedAt);assert.equal(one.context.tab,'history');assert.equal(one.context.financialState,'allocation_excess');
        assert.deepEqual(await fingerprint(),before);assert.equal(await count('automation_activity_reviews','WHERE revision=$1',[excess.context.revision]),1);
        await assert.rejects(admin.query('DELETE FROM automation_activity_reviews WHERE revision=$1',[excess.context.revision]),/immutable/);
        await assert.rejects(admin.query('UPDATE automation_activity_reviews SET reviewed_at=reviewed_at WHERE revision=$1',[excess.context.revision]),/immutable/);
        await s.correct('1000000');await s.assess();const next=await review.readAutomationActivityDetail(storage,s.instance);
        assert.equal(next.context.tab,'attention');assert.equal(next.context.reviewedAt,null);
        const stale=await review.acknowledgeAutomationActivity(storage,s.instance,excess.context.revision,'acknowledged');assert.equal(stale.stale,true);
        await s.voidSource();await s.assess();const voided=await review.readAutomationActivityDetail(storage,s.instance);
        assert.equal(voided.context.financialState,'source_voided');assert.equal(voided.context.currentSourceMinor,'0');assert.equal(voided.context.lastSourceMinor,'1000000');assert.equal(voided.allocation.differenceMinor,'-140000');
        const voidBefore=await fingerprint();await review.acknowledgeAutomationActivity(storage,s.instance,voided.context.revision,'acknowledged');assert.deepEqual(await fingerprint(),voidBefore);
        const final=await review.readAutomationActivityDetail(storage,s.instance);assert.equal(final.context.tab,'history');assert.equal(final.context.financialState,'source_voided');
        assert.equal(final.timeline.filter(e=>e.kind==='review').length,2);assert.ok(final.timeline.some(e=>e.title==='Sumber dibatalkan'));
      });
      await t.test(`${storage}: shortfall decline is an explicit nonfinancial decision, pending confirmation cannot be acknowledged`,async()=>{
        const s=await scenario(storage);await s.correct('1300000');await s.assess();const detail=await review.readAutomationActivityDetail(storage,s.instance);
        assert.equal(detail.context.canAcknowledge,false);assert.equal(detail.context.canDecline,true);
        await assert.rejects(review.acknowledgeAutomationActivity(storage,s.instance,detail.context.revision,'acknowledged'),/memerlukan/);
        const before=await count('financial_activities');await review.acknowledgeAutomationActivity(storage,s.instance,detail.context.revision,'declined_allocation');
        const declined=await review.readAutomationActivityDetail(storage,s.instance);assert.equal(declined.context.tab,'history');assert.equal(declined.context.financialState,'allocation_shortfall');assert.equal(declined.allocation.differenceMinor,'30000');assert.equal(await count('financial_activities'),before);
        await finance.replaceActivity(s.original,{kind:'expense',sourceAssetId:source,amountMinor:'80000',occurredAt:new Date().toISOString()},randomUUID());
        await s.assess();assert.equal((await review.readAutomationActivityDetail(storage,s.instance)).context.tab,'attention');
        const root=await finance.postActivity(draft('1000000'),randomUUID());if(storage==='general')await engine.reconcileGeneralAutomation();else await events.reconcileIncomeEvents();
        const pending=(await admin.query(`SELECT id FROM ${s.table} WHERE rule_id=$1 AND root_activity_id=$2`,[s.rule,root])).rows[0];
        const viewed=await review.readAutomationActivityDetail(storage,pending.id);assert.equal(viewed.context.tab,'attention');assert.equal(viewed.context.canAcknowledge,false);
        await assert.rejects(review.acknowledgeAutomationActivity(storage,pending.id,viewed.context.revision,'acknowledged'),/memerlukan/);
        assert.equal((await review.readAutomationActivityDetail(storage,pending.id)).context.attention,'needs_action');
      });
      await t.test(`${storage}: source changes while review is open reject stale acknowledgment before any prior reconciliation`,async()=>{
        const s=await scenario(storage);await s.correct('900000');await s.assess();const opened=await review.readAutomationActivityDetail(storage,s.instance);
        await s.correct('800000');const before=await count('financial_activities');const result=await review.acknowledgeAutomationActivity(storage,s.instance,opened.context.revision,'acknowledged');
        assert.equal(result.stale,true);assert.equal(result.context.tab,'attention');assert.equal(await count('financial_activities'),before);assert.equal(await count('automation_activity_reviews','WHERE revision=$1',[opened.context.revision]),0);
        const latest=await review.readAutomationActivityDetail(storage,s.instance);assert.equal(latest.context.currentSourceMinor,'800000');assert.ok(latest.timeline.some(e=>e.title==='Alokasi dinilai'));
      });
      await t.test(`${storage}: basic +30,000, repeated +10,000, excess and void preserve original financial lineage`,async()=>{
        const s=await scenario(storage),original=await activity(s.original);
        await s.correct('1300000');const a=await s.assess();assert.equal(a.targetMinor,'130000');assert.equal(a.recognizedMinor,'100000');assert.equal(a.differenceMinor,'30000');
        const same=await s.assess();assert.equal(same.assessmentId,a.assessmentId);assert.equal(same.proposalId,a.proposalId);
        const [r,retry]=await Promise.all([s.confirm(a.proposalId),s.confirm(a.proposalId)]);assert.equal(r.id,retry.id);
        assert.equal((await activity(r.id)).base_amount_minor,'30000');assert.equal(r.assessment.state,'aligned');
        assert.deepEqual(await activity(s.original),original);assert.equal(await count('finance_operations','WHERE idempotency_key=$1',[a.proposalId]),1);
        const lostResponse=await s.confirm(a.proposalId);assert.equal(lostResponse.id,r.id);
        await s.correct('1400000');const b=await s.assess();assert.equal(b.differenceMinor,'10000');await s.confirm(b.proposalId);
        await s.correct('900000');const excess=await s.assess();assert.equal(excess.state,'excess');assert.equal(excess.differenceMinor,'-50000');assert.equal(excess.proposalId,null);
        const before=await count('financial_activities');await s.voidSource();const zero=await s.assess();assert.equal(zero.targetMinor,'0');assert.equal(zero.state,'excess');assert.equal(zero.recognizedMinor,'140000');
        assert.equal(await count('financial_activities'),before);assert.equal(await count(s.table,'WHERE rule_id=$1',[s.rule]),1);
        await allocation.reconcileAllocations();await allocation.reconcileAllocations();
        const data=storage==='general'?await engine.readGeneralAutomation():await events.readIncomeEvents();
        assert.equal(data.instances.find(item=>item.id===s.instance).allocation.state,'excess');
      });
      await t.test(`${storage}: snapshot survives rule edit; root correction and concurrent assessment never duplicate instance`,async()=>{
        const s=await scenario(storage);await s.correct('1300000');
        if(storage==='general'){s.input.actions[0].amount.percentageBps=1500;await engine.saveGeneralRule(s.input,s.rule);}
        else await events.saveIncomeEventRule({title:'Edited 15%',percentageBps:1500,outputKind:'expense'},s.rule);
        const [a,b]=await Promise.all([s.assess(),s.assess()]);assert.equal(a.percentageBps,1000);assert.equal(a.proposalId,b.proposalId);assert.equal(a.differenceMinor,'30000');
        if(storage==='general')await engine.reconcileGeneralAutomation();else await events.reconcileIncomeEvents();
        assert.equal(await count(s.table,'WHERE rule_id=$1',[s.rule]),1);assert.equal((await admin.query(`SELECT root_activity_id FROM ${s.table} WHERE id=$1`,[s.instance])).rows[0].root_activity_id,s.root);
      });
      await t.test(`${storage}: stale proposal after correction, concurrent stale confirmation and latest net assessment`,async()=>{
        const s=await scenario(storage);await s.correct('1300000');const a=await s.assess();await s.correct('1400000');
        const before=await count('financial_activities');const stale=await s.confirm(a.proposalId);assert.equal(stale.stale,true);assert.equal(stale.assessment.differenceMinor,'40000');assert.equal(await count('financial_activities'),before);
        assert.equal((await admin.query('SELECT status FROM automation_allocation_adjustments WHERE id=$1',[a.proposalId])).rows[0].status,'superseded');
        await s.confirm(stale.assessment.proposalId);assert.equal((await s.confirm(a.proposalId)).stale,true);
      });
      await t.test(`${storage}: correction/void of original and adjustment is counted effectively without fees`,async()=>{
        const s=await scenario(storage);await s.correct('1300000');const a=await s.assess();const posted=await s.confirm(a.proposalId);
        const replacement=await finance.replaceActivity(posted.id,{kind:'expense',sourceAssetId:source,amountMinor:'20000',occurredAt:new Date().toISOString()},randomUUID());
        const changed=await s.assess();assert.equal(changed.recognizedMinor,'120000');assert.equal(changed.differenceMinor,'10000');
        await finance.voidActivity(replacement,randomUUID());const voided=await s.assess();assert.equal(voided.recognizedMinor,'100000');assert.equal(voided.differenceMinor,'30000');
        const revisedOriginal=await finance.replaceActivity(s.original,{kind:'expense',sourceAssetId:source,amountMinor:'90000',occurredAt:new Date().toISOString()},randomUUID());
        assert.equal((await s.assess()).recognizedMinor,'90000');await finance.voidActivity(revisedOriginal,randomUUID());assert.equal((await s.assess()).recognizedMinor,'0');
      });
      await t.test(`${storage}: Transfer uses P3; fee only explicit and not duplicated from original`,async()=>{
        const s=await scenario(storage,'transfer',storage==='income_event'?{transferFeeMinor:'500'}:{});await s.correct('1300000');const a=await s.assess();const r=await s.confirm(a.proposalId,{transferFeeMinor:'700'});
        const f=await activity(r.id);assert.equal(f.kind,'transfer');assert.equal(f.source_asset_id,source);assert.equal(f.destination_asset_id,destination);assert.equal(f.base_amount_minor,'30000');
        assert.equal((await admin.query('SELECT sum(amount_minor)::text n FROM activity_charges WHERE activity_id=$1',[r.id])).rows[0].n,'700');assert.equal(r.assessment.recognizedMinor,'130000');
        await assert.rejects(s.confirm(a.proposalId,{transferFeeMinor:'701'}),/Biaya berbeda/);
      });
      await t.test(`${storage}: archived/paused rules block confirmation; restore never revives stale proposal`,async()=>{
        const s=await scenario(storage);await s.correct('1300000');const a=await s.assess();await setStatus(storage,s.rule,'paused');
        assert.equal((await s.confirm(a.proposalId)).stale,true);assert.equal((await s.assess()).state,'blocked');await setStatus(storage,s.rule,'active');
        const restored=await s.assess();assert.notEqual(restored.proposalId,a.proposalId);assert.equal((await s.assess()).assessmentId,restored.assessmentId);
        await setStatus(storage,s.rule,'archived');assert.equal((await s.confirm(restored.proposalId)).stale,true);await setStatus(storage,s.rule,'active');
        assert.equal((await s.assess()).state,'additional');assert.equal(await count(s.table,'WHERE rule_id=$1',[s.rule]),1);
      });
      await t.test(`${storage}: unavailable asset, changed receiving account, and wrong currency never select fallback or post`,async()=>{
        const s=await scenario(storage);await s.correct('1300000');const a=await s.assess();await admin.query('UPDATE assets SET is_active=false WHERE id=$1',[source]);
        assert.equal((await s.confirm(a.proposalId)).stale,true);assert.equal((await s.assess()).state,'blocked');await admin.query('UPDATE assets SET is_active=true WHERE id=$1',[source]);
        await s.correct('1300000',other);assert.equal((await s.assess()).state,'blocked');
        const foreign=await asset('USD source','USD');await s.correct('1300000',foreign);assert.equal((await s.assess()).state,'blocked');
      });
      await t.test(`${storage}: failed P3 posting rolls back movements; retry same UUID posts once; provenance survives correction`,async()=>{
        const s=await scenario(storage);await s.correct('1300000');const a=await s.assess();
        const charge=randomUUID();const fees={charges:[{typeId:charge,amountMinor:'100'}]};const before=await count('ledger_movements');
        const failed=await s.confirm(a.proposalId,fees);assert.equal(failed.failed,true);assert.equal(await count('ledger_movements'),before);assert.equal(failed.assessment.confirmedFees.charges[0].typeId,charge);
        await admin.query("INSERT INTO additional_charge_types(id,display_name,is_builtin,is_active) VALUES($1,'Explicit adjustment fee',false,true)",[charge]);
        const r=await s.confirm(a.proposalId,fees);assert.equal(r.assessment.recognizedMinor,'130000');assert.equal((await activity(r.id)).base_amount_minor,'30000');
        const replacement=await finance.replaceActivity(r.id,{kind:'expense',sourceAssetId:source,amountMinor:'30000',occurredAt:new Date().toISOString()},randomUUID());
        const result=(await finance.listActivities(true)).find(item=>item.id===replacement);assert.equal(result.allocationAdjustmentId,a.proposalId);assert.equal(result.originalAutomationResultId,s.original);assert.equal(result.automationSourceActivityId,s.root);assert.equal(result.recurringRuleName,'Allocation original 10%');
        assert.equal(await count('finance_operations','WHERE idempotency_key=$1',[a.proposalId]),1);
      });
      await t.test(`${storage}: failure after P3 ledger insertion rolls back the entire result and retry recovers one receipt`,async()=>{
        const s=await scenario(storage);await s.correct('1300000');const a=await s.assess();
        const before={activities:await count('financial_activities'),movements:await count('ledger_movements'),operations:await count('finance_operations')};
        await admin.query(`CREATE FUNCTION reject_adjustment_post() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='posted' THEN RAISE EXCEPTION 'disposable late failure'; END IF; RETURN NEW; END; $$;
          CREATE TRIGGER disposable_post_failure BEFORE UPDATE ON automation_allocation_adjustments FOR EACH ROW EXECUTE FUNCTION reject_adjustment_post()`);
        try { assert.equal((await s.confirm(a.proposalId)).failed,true);
          assert.equal(await count('financial_activities'),before.activities);assert.equal(await count('ledger_movements'),before.movements);assert.equal(await count('finance_operations'),before.operations);
        }finally{await admin.query('DROP TRIGGER disposable_post_failure ON automation_allocation_adjustments; DROP FUNCTION reject_adjustment_post()');}
        const [r,retry]=await Promise.all([s.confirm(a.proposalId),s.confirm(a.proposalId)]);assert.equal(r.id,retry.id);assert.equal(await count('finance_operations','WHERE idempotency_key=$1',[a.proposalId]),1);
      });
      await t.test(`${storage}: original Expense fees are not percentage principal or automatic adjustment templates`,async()=>{
        const charge=randomUUID();await admin.query("INSERT INTO additional_charge_types(id,display_name,is_builtin,is_active) VALUES($1,'Original fee',false,true)",[charge]);
        const oldCharges=[{typeId:charge,amountMinor:'5000'}];
        const extra=storage==='income_event'?{charges:oldCharges}:{actions:[{kind:'expense',source:{strategy:'configured_asset',assetId:source},amount:{strategy:'percentage_of_trigger',percentageBps:1000},charges:oldCharges}]};
        const s=await scenario(storage,'expense',extra);await s.correct('1300000');const a=await s.assess();assert.equal(a.recognizedMinor,'100000');assert.equal(a.differenceMinor,'30000');
        const r=await s.confirm(a.proposalId);assert.equal(await count('activity_charges','WHERE activity_id=$1',[r.id]),0);assert.equal(r.assessment.recognizedMinor,'130000');
      });
      await t.test(`${storage}: correction committed while confirmation waits is reread atomically and rejects the old proposal`,async()=>{
        const s=await scenario(storage);const current=await s.correct('1300000');const a=await s.assess();
        const gate=`allocation_race_${randomUUID()}`;
        const key=(await admin.query('SELECT hashtext($1)::bigint & 4294967295 AS key',[gate])).rows[0].key;
        await admin.query('SELECT pg_advisory_lock(hashtext($1))',[gate]);
        await admin.query(`CREATE FUNCTION gate_source_correction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.replaces_activity_id='${current}'::uuid THEN PERFORM pg_advisory_xact_lock(hashtext('${gate}')); END IF; RETURN NEW; END; $$;
          CREATE TRIGGER disposable_correction_gate BEFORE INSERT ON financial_activities FOR EACH ROW EXECUTE FUNCTION gate_source_correction()`);
        const waitFor=async query=>{
          const deadline=Date.now()+5000;
          while(Date.now()<deadline){const rows=(await admin.query(query)).rows;if(rows.length)return rows[0];await new Promise(resolve=>setTimeout(resolve,20));}
          throw Error('Disposable concurrency barrier was not reached');
        };
        let correction,confirmation;
        try {
          correction=s.correct('1400000');
          const {pid}=await waitFor(`SELECT pid FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=${key} AND objsubid=1`);
          confirmation=s.confirm(a.proposalId);
          await waitFor(`SELECT pid FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid)) AND query LIKE '%financial_activities%'`);
          await admin.query('SELECT pg_advisory_unlock(hashtext($1))',[gate]);
          await correction;const rejected=await confirmation;
          assert.equal(rejected.stale,true);assert.equal(rejected.assessment.differenceMinor,'40000');
          assert.equal(await count('finance_operations','WHERE idempotency_key=$1',[a.proposalId]),0);
        }finally{
          await admin.query('SELECT pg_advisory_unlock(hashtext($1))',[gate]);
          await Promise.allSettled([correction,confirmation].filter(Boolean));
          await admin.query('DROP TRIGGER disposable_correction_gate ON financial_activities; DROP FUNCTION gate_source_correction()');
        }
      });
    }
    await t.test('generic Income action remains supported but adjustment Income cannot trigger legacy or generic event chains',async()=>{
      const s=await scenario('general','income');await s.correct('1300000');const a=await s.assess();
      const eventRule=await events.saveIncomeEventRule({title:'No recursive legacy allocation',percentageBps:1000,outputKind:'expense'});
      const genericRule=await engine.saveGeneralRule({...s.input,title:'No recursive general allocation'});
      const r=await s.confirm(a.proposalId);assert.ok(r.id);assert.equal((await activity(r.id)).kind,'income');
      await engine.reconcileGeneralAutomation();await events.reconcileIncomeEvents();await engine.reconcileGeneralAutomation();await events.reconcileIncomeEvents();
      assert.equal(await count('automation_instances','WHERE root_activity_id=$1',[r.id]),0);assert.equal(await count('income_event_instances','WHERE root_activity_id=$1',[r.id]),0);
      assert.equal(await count('automation_instances','WHERE rule_id=$1 AND root_activity_id=$2',[genericRule,r.id]),0);assert.equal(await count('income_event_instances','WHERE rule_id=$1 AND root_activity_id=$2',[eventRule,r.id]),0);
    });
    await t.test('original conditions are revalidated; unsupported strategy/source is rejected',async()=>{
      const s=await scenario('general','expense',{conditions:[{field:'base_amount',operator:'less_or_equal',value:'1200000',currency:'IDR'}]});await s.correct('1300000');assert.equal((await s.assess()).state,'blocked');
      await assert.rejects(allocation.assessAllocation('schedule',s.instance),/Sumber/);await assert.rejects(allocation.confirmAllocation('not-a-uuid'),/Referensi/);
    });
    await t.test('condition failure remains distinct from excess, and fixed composable reviews use the same durable mechanism',async()=>{
      const s=await scenario('general','expense',{conditions:[{field:'base_amount',operator:'greater_or_equal',value:'1000000',currency:'IDR'}]});await s.correct('900000');await s.assess();
      const failed=await review.readAutomationActivityDetail('general',s.instance);assert.equal(failed.context.financialState,'conditions_unmet');assert.equal(failed.allocation.differenceMinor,'-10000');
      await review.acknowledgeAutomationActivity('general',s.instance,failed.context.revision,'acknowledged');assert.equal((await review.readAutomationActivityDetail('general',s.instance)).context.financialState,'conditions_unmet');
      await engine.setGeneralRuleStatus(s.rule,'paused');
      const rule=await engine.saveGeneralRule({title:'Fixed review',trigger:{namespace:'transaction_posted',activityKind:'income'},conditionMode:'ALL',conditions:[],execution:'confirm_before_execute',actions:[{kind:'expense',source:{strategy:'trigger_destination_asset'},amount:{strategy:'fixed',amountMinor:'1000',currency:'IDR'},charges:[]}]});
      const root=await finance.postActivity(draft('1000000'),randomUUID());await engine.reconcileGeneralAutomation();const id=(await admin.query('SELECT id FROM automation_instances WHERE rule_id=$1 AND root_activity_id=$2',[rule,root])).rows[0].id;
      await engine.confirmGeneralInstance(id);await finance.replaceActivity(root,draft('900000'),randomUUID());await engine.reconcileGeneralAutomation();
      const fixed=await review.readAutomationActivityDetail('general',id);assert.equal(fixed.context.canAcknowledge,true);await review.acknowledgeAutomationActivity('general',id,fixed.context.revision,'acknowledged');assert.equal((await review.readAutomationActivityDetail('general',id)).context.tab,'history');
    });
    await t.test('audit protections, identity/amount/result FK constraints and unified facade preserve legacy records',async()=>{
      const s=await scenario('income_event');await s.correct('1300000');const a=await s.assess();
      await assert.rejects(admin.query('UPDATE automation_allocation_assessments SET target_minor=target_minor WHERE id=$1',[a.assessmentId]),/immutable/);
      await assert.rejects(admin.query('DELETE FROM automation_allocation_audit WHERE assessment_id=$1',[a.assessmentId]),/immutable/);
      await assert.rejects(admin.query('UPDATE automation_allocation_adjustments SET amount_minor=1 WHERE id=$1',[a.proposalId]),/immutable/);
      await assert.rejects(admin.query("UPDATE automation_allocation_adjustments SET status='posted',result_activity_id=$2 WHERE id=$1",[a.proposalId,s.original]));
      const schedules={rules:[],occurrences:[]},view=unifyAutomation(schedules,await events.readIncomeEvents(),await engine.readGeneralAutomation());
      assert.equal(view.instances.filter(item=>item.storage==='income_event'&&item.id===s.instance).length,1);assert.equal(view.instances.find(item=>item.id===s.instance).allocation.differenceMinor,'30000');
      assert.ok(await count('automation_allocation_audit')>0);
    });
  } finally {if(pool)await pool.end();hooks?.deregister();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
