import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const name=process.env.MONEYTOR_COMPOSABLE_DB_TEST;
test("Composable Automation V1 on disposable PostgreSQL",{skip:!/^moneytor_composable_verify_\d+$/.test(name ?? "")},async(t)=>{
  const url=new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"55433");assert.equal(url.pathname,`/${name}`);
  const admin=new pg.Client({connectionString:url.toString()});await admin.connect();
  const schema=`composable_${randomUUID().replaceAll("-","")}`;let pool,hooks;
  try{
    await admin.query(`CREATE SCHEMA ${schema}`);await admin.query(`SET search_path TO ${schema}`);
    const files=(await readdir(new URL("../db/migrations/",import.meta.url))).filter((item)=>item.endsWith(".sql")).sort();
    assert.equal(files.at(-1),"013_home_customization.sql");
    for(const file of files)await admin.query(await readFile(new URL(`../db/migrations/${file}`,import.meta.url),"utf8"));
    url.searchParams.set("options",`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();
    hooks=registerHooks({resolve(specifier,context,next){
      if(specifier==="@/lib/auth/session")return {url:"data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__composableAuthorized)throw Error('Unauthorized');return {credentialId:'disposable'}}",shortCircuit:true};
      if(specifier.startsWith("@/"))return next(new URL(`../src/${specifier.slice(2)}.ts`,import.meta.url).href,context);
      if(specifier.startsWith(".")&&!/\.[a-z]+$/i.test(specifier))return next(new URL(`${specifier}.ts`,context.parentURL).href,context);
      return next(specifier,context);
    }});
    const engine=await import("../src/lib/automation/composable-service.ts"), finance=await import("../src/lib/finance/service.ts");
    const recurring=await import("../src/lib/automation/service.ts"),events=await import("../src/lib/automation/income-events.ts");
    const {unifyAutomation,legacyRulePayload,builderCapabilities}=await import("../src/lib/automation/composable-facade.ts");
    const catalogs=await import("../src/lib/repositories/catalogs.ts");
    const {insertAssetWithOpening,listAssets}=await import("../src/lib/repositories/assets.ts");
    const {jakartaToday,addDays}=await import("../src/lib/automation/schedule.ts");
    pool=(await import("../src/lib/db/pool.ts")).database();
    await assert.rejects(engine.readGeneralAutomation(),/Unauthorized/);globalThis.__composableAuthorized=true;
    const assetType=(await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const asset=async(title)=>insertAssetWithOpening({displayName:title,currency:"IDR",assetTypeId:assetType,normallyLiquid:true,normallySpendable:true,openingAmountMinor:1000000n,openingEffectiveAt:new Date("2026-01-01T00:00:00Z")});
    const source=await asset("General source"),target=await asset("General target");
    const draft=(kind="income",amount="10000")=>({kind,amountMinor:amount,occurredAt:new Date().toISOString(),...(kind!=="income"?{sourceAssetId:source}:{}),...(kind!=="expense"?{destinationAssetId:kind==="income"?source:target}:{})});
    const post=(kind="income",amount="10000")=>finance.postActivity(draft(kind,amount),randomUUID());
    const rule=(patch={})=>({title:"Composable",trigger:{namespace:"transaction_posted",activityKind:"income"},conditionMode:"ALL",conditions:[],
      actions:[{kind:"expense",source:{strategy:"trigger_destination_asset"},amount:{strategy:"percentage_of_trigger",percentageBps:1000},charges:[]}],execution:"confirm_before_execute",...patch});
    const fixed=(kind="expense",amount="100")=>({kind,...(kind!=="income"?{source:{strategy:"configured_asset",assetId:source}}:{}),...(kind!=="expense"?{destination:{strategy:"configured_asset",assetId:target}}:{}),amount:{strategy:"fixed",amountMinor:amount,currency:"IDR"},charges:[]});
    const row=async(ruleId,root)=>(await admin.query("SELECT * FROM automation_instances WHERE rule_id=$1 AND root_activity_id=$2",[ruleId,root])).rows[0];
    const drain=async()=>{for(let i=0;i<30;i++){const result=await engine.reconcileGeneralAutomation();if(result.created<50&&result.refreshed<50&&result.posted<10)return;}throw Error("Reconciliation not bounded/drained");};
    const count=async(table,where="",params=[])=>(await admin.query(`SELECT count(*)::int AS n FROM ${table} ${where}`,params)).rows[0].n;
    t.afterEach(async()=>{for(const {id}of(await admin.query("SELECT id FROM automation_rules WHERE status<>'archived'")).rows)await engine.setGeneralRuleStatus(id,"archived");});

    await t.test("migration has empty state, strong constraints, and zero-rule reconciliation makes no finance movement",async()=>{
      const before=await count("financial_activities");assert.equal(await count("automation_rules"),0);assert.equal(await count("automation_instances"),0);
      assert.deepEqual(await engine.reconcileGeneralAutomation(),{ready:true,created:0,refreshed:0,posted:0});assert.equal(await count("financial_activities"),before);
      assert.ok((await admin.query("SELECT count(*)::int n FROM pg_constraint WHERE connamespace=$1::regnamespace AND conrelid::regclass::text LIKE 'automation_%'",[schema])).rows[0].n>40);
    });
    await t.test("server rejects incompatible references, automatic events and multiple actions before storing anything",async()=>{
      const invalid=rule();invalid.actions[0].source={strategy:"trigger_source_asset"};
      await assert.rejects(engine.saveGeneralRule(invalid),/Referensi aset/);
      await assert.rejects(engine.saveGeneralRule(rule({execution:"automatic"})),/konfirmasi/);
      await assert.rejects(engine.saveGeneralRule(rule({actions:[fixed(),fixed()]})),/satu tindakan/);
      assert.equal(await count("automation_rules"),0);
    });
    await t.test("manual Income: two rules, concurrent replay, one candidate per logical root and idempotent concurrent confirmation",async()=>{
      const old=await post();const input=rule(),key=randomUUID();
      const [first,retry]=await Promise.all([engine.saveGeneralRule(input,undefined,key),engine.saveGeneralRule(input,undefined,key)]);assert.equal(first,retry);
      const second=await engine.saveGeneralRule(rule({title:"Second"}));const root=await post();
      await Promise.all([engine.reconcileGeneralAutomation(),engine.reconcileGeneralAutomation()]);await drain();
      assert.equal(await row(first,old),undefined);assert.equal(await count("automation_instances","WHERE root_activity_id=$1",[root]),2);
      const candidate=await row(first,root);assert.equal(candidate.calculated_amount_minor,"1000");assert.equal(candidate.resolved_source_asset_id,source);
      const before=(await listAssets()).find((item)=>item.id===source).balanceMinor;
      const [a,b]=await Promise.all([engine.confirmGeneralInstance(candidate.id),engine.confirmGeneralInstance(candidate.id)]);assert.equal(a,b);
      assert.equal((await listAssets()).find((item)=>item.id===source).balanceMinor,(BigInt(before)-1000n).toString());
      assert.equal(await count("finance_operations","WHERE idempotency_key=$1",[candidate.id]),1);assert.equal(await count("automation_action_results","WHERE instance_id=$1",[candidate.id]),1);
      assert.equal((await row(second,root)).status,"awaiting_confirmation");
    });
    for(const kind of ["income","expense","transfer"])await t.test(`P3 ${kind} is an eligible source; Income, Expense and Transfer outputs all use P3`,async()=>{
      const output=kind==="income"?"income":kind==="expense"?"expense":"transfer";
      const action={...fixed(output),amount:{strategy:"trigger_amount"}};
      if(kind==="expense")action.source={strategy:"trigger_source_asset"};
      if(kind==="transfer"){action.source={strategy:"trigger_destination_asset"};action.destination={strategy:"trigger_source_asset"};}
      const id=await engine.saveGeneralRule(rule({trigger:{namespace:"transaction_posted",activityKind:kind},actions:[action]}));
      const root=await post(kind,"2500");await drain();const item=await row(id,root);assert.equal(item.calculated_amount_minor,"2500");
      const result=await engine.confirmGeneralInstance(item.id);const activity=(await finance.listActivities()).find((value)=>value.id===result);
      assert.equal(activity.kind,output);assert.equal(activity.baseAmountMinor,"2500");assert.equal(activity.automationInstanceId,item.id);
      assert.equal(activity.automationSourceActivityId,root);assert.equal(activity.automationSourceKind,kind);
      assert.ok(await count("ledger_movements","WHERE activity_id=$1",[result])>0);
      if(kind==="transfer"){assert.equal(activity.sourceAssetId,target);assert.equal(activity.destinationAssetId,source);}
    });
    await t.test("AND/OR conditions and unmatched instances re-evaluate the same logical root after correction",async()=>{
      const id=await engine.saveGeneralRule(rule({conditions:[{field:"base_amount",operator:"greater_than",value:"15000",currency:"IDR"},{field:"destination_asset",operator:"equals",value:source}]}));
      const root=await post("income","10000");await drain();const first=await row(id,root);assert.equal(first.status,"not_matched");
      const replacement=await finance.replaceActivity(root,draft("income","20000"),randomUUID());await drain();const updated=await row(id,root);
      assert.equal(updated.id,first.id);assert.equal(updated.status,"awaiting_confirmation");assert.equal(updated.effective_activity_id,replacement);assert.equal(updated.calculated_amount_minor,"2000");
      await drain();assert.equal(await count("automation_instances","WHERE rule_id=$1",[id]),1);
      assert.equal(await count("automation_source_receipts","WHERE root_activity_id=$1",[replacement]),0);
      const or=await engine.saveGeneralRule(rule({conditionMode:"ANY",conditions:[{field:"base_amount",operator:"less_than",value:"1",currency:"IDR"},{field:"destination_asset",operator:"equals",value:source}]}));
      const next=await post();await drain();assert.equal((await row(or,next)).status,"awaiting_confirmation");
    });
    await t.test("pending correction recalculates same candidate; stale confirmation refreshes and requires another owner decision",async()=>{
      const id=await engine.saveGeneralRule(rule()),root=await post();await drain();const first=await row(id,root);
      const replacement=await finance.replaceActivity(root,draft("income","25000"),randomUUID());
      await assert.rejects(engine.confirmGeneralInstance(first.id),/berubah/);
      const updated=await row(id,root);assert.equal(updated.id,first.id);assert.equal(updated.root_activity_id,root);assert.equal(updated.effective_activity_id,replacement);assert.equal(updated.calculated_amount_minor,"2500");
      await drain();await drain();assert.equal(await count("automation_instances","WHERE rule_id=$1",[id]),1);assert.equal(await row(id,replacement),undefined);
      const result=await engine.confirmGeneralInstance(first.id);assert.equal((await admin.query("SELECT base_amount_minor::text FROM financial_activities WHERE id=$1",[result])).rows[0].base_amount_minor,"2500");
    });
    await t.test("void before posting prevents execution; source correction/void after posting only marks review",async()=>{
      const id=await engine.saveGeneralRule(rule()),root=await post();await drain();const first=await row(id,root);
      await finance.voidActivity(root,randomUUID());await drain();assert.equal((await row(id,root)).status,"superseded");await assert.rejects(engine.confirmGeneralInstance(first.id));
      const next=await post();await drain();const candidate=await row(id,next),result=await engine.confirmGeneralInstance(candidate.id);
      const replacement=await finance.replaceActivity(next,draft("income","5000"),randomUUID());await drain();
      assert.equal((await row(id,next)).status,"review_required");await finance.voidActivity(replacement,randomUUID());await drain();
      assert.equal((await admin.query("SELECT status,base_amount_minor::text FROM financial_activities WHERE id=$1",[result])).rows[0].status,"posted");
      assert.equal((await row(id,next)).result_activity_id,result);
    });
    await t.test("rule versions and active intervals: no precreation, paused or archived backfill; edit uses original active version",async()=>{
      const id=await engine.saveGeneralRule(rule()),before=await post();
      const edited=rule();edited.actions[0].amount={strategy:"percentage_of_trigger",percentageBps:250};await engine.saveGeneralRule(edited,id);
      const after=await post();await drain();assert.equal((await row(id,before)).version_no,1);assert.equal((await row(id,before)).calculated_amount_minor,"1000");assert.equal((await row(id,after)).calculated_amount_minor,"250");
      await engine.setGeneralRuleStatus(id,"paused");const paused=await post();await engine.setGeneralRuleStatus(id,"active");const resumed=await post();
      await engine.setGeneralRuleStatus(id,"archived");const archived=await post();await engine.setGeneralRuleStatus(id,"active");const restored=await post();await drain();
      assert.equal(await row(id,paused),undefined);assert.equal(await row(id,archived),undefined);assert.ok(await row(id,resumed));assert.ok(await row(id,restored));
      await engine.saveGeneralRule(edited,id);await drain();assert.equal(await count("automation_instances","WHERE rule_id=$1 AND root_activity_id=$2",[id,before]),1);
      await assert.rejects(admin.query("UPDATE automation_rule_versions SET title='rewrite' WHERE rule_id=$1 AND version_no=1",[id]),/immutable/);
      await assert.rejects(admin.query("DELETE FROM automation_actions WHERE rule_id=$1 AND version_no=1",[id]),/immutable/);
    });
    await t.test("percentage floor, zero-result rejection, fixed and runtime confirmations",async()=>{
      const id=await engine.saveGeneralRule(rule()),root=await post("income","1");await drain();const failed=await row(id,root);assert.equal(failed.status,"failed");await assert.rejects(engine.confirmGeneralInstance(failed.id));
      const fractional=rule();fractional.actions[0].amount.percentageBps=250;const percent=await engine.saveGeneralRule(fractional),p=await post("income","101");await drain();assert.equal((await row(percent,p)).calculated_amount_minor,"2");
      const runtime=rule();runtime.actions[0].amount={strategy:"confirm_at_runtime"};const runtimeId=await engine.saveGeneralRule(runtime),r=await post();await drain();const candidate=await row(runtimeId,r);
      await assert.rejects(engine.confirmGeneralInstance(candidate.id));const result=await engine.confirmGeneralInstance(candidate.id,"2750");
      assert.equal((await admin.query("SELECT base_amount_minor::text FROM financial_activities WHERE id=$1",[result])).rows[0].base_amount_minor,"2750");
      const fixedRule=await engine.saveGeneralRule(rule({actions:[fixed("expense","333")]})),f=await post();await drain();assert.equal((await row(fixedRule,f)).calculated_amount_minor,"333");
    });
    await t.test("skip and failed posting retry retain identity without duplicate ledger effects",async()=>{
      const id=await engine.saveGeneralRule(rule()),root=await post();await drain();const candidate=await row(id,root);
      const before=await count("ledger_movements");await engine.skipGeneralInstance(candidate.id);await engine.skipGeneralInstance(candidate.id);
      assert.equal(await count("ledger_movements"),before);assert.equal(await count("finance_operations","WHERE idempotency_key=$1",[candidate.id]),0);
      const next=await post();await drain();const retry=await row(id,next);
      await admin.query("UPDATE assets SET is_active=false WHERE id=$1",[source]);await assert.rejects(engine.confirmGeneralInstance(retry.id));
      await admin.query("UPDATE assets SET is_active=true WHERE id=$1",[source]);const result=await engine.confirmGeneralInstance(retry.id);
      assert.equal(await engine.confirmGeneralInstance(retry.id),result);assert.equal(await count("finance_operations","WHERE idempotency_key=$1",[retry.id]),1);
    });
    await t.test("P3 categories, expense charges and transfer fee remain linked and protect catalog history",async()=>{
      const category=await catalogs.insertCustomCategory("General Expense category","expense");
      const charge=await catalogs.insertCustomCatalogItem("chargeTypes","General service charge");
      const input=rule({actions:[{...fixed("expense","100"),categoryId:category.id,charges:[{typeId:charge.id,amountMinor:"20"}]}]});
      const id=await engine.saveGeneralRule(input),root=await post();await drain();const item=await row(id,root);
      const before=(await listAssets()).find((value)=>value.id===source).balanceMinor;const result=await engine.confirmGeneralInstance(item.id);
      assert.equal((await listAssets()).find((value)=>value.id===source).balanceMinor,(BigInt(before)-120n).toString());
      const activity=(await finance.listActivities()).find((value)=>value.id===result);assert.equal(activity.categoryId,category.id);assert.equal(activity.charges[0].amountMinor,"20");
      await catalogs.archiveCustomCatalogItem("transactionCategories",category.id);await catalogs.archiveCustomCatalogItem("chargeTypes",charge.id);
      assert.equal((await catalogs.listCatalog("transactionCategories",true)).find((value)=>value.id===category.id).canDelete,false);
      assert.equal((await catalogs.listCatalog("chargeTypes",true)).find((value)=>value.id===charge.id).canDelete,false);
      await assert.rejects(catalogs.deleteCustomCatalogItem("transactionCategories",category.id),/referensi/);
      await assert.rejects(catalogs.deleteCustomCatalogItem("chargeTypes",charge.id),/referensi/);
      const transfer=await engine.saveGeneralRule(rule({actions:[{...fixed("transfer","200"),transferFeeMinor:"10"}]})),next=await post();await drain();
      const transferred=await engine.confirmGeneralInstance((await row(transfer,next)).id);
      assert.equal((await admin.query("SELECT sum(amount_minor)::text AS total FROM ledger_movements WHERE activity_id=$1",[transferred])).rows[0].total,"-10");
    });
    await t.test("transaction category condition matches independently; absent destination never satisfies not_equals",async()=>{
      const category=await catalogs.insertCustomCategory("Trigger category","income");
      const id=await engine.saveGeneralRule(rule({conditions:[{field:"transaction_category",operator:"equals",value:category.id}]}));
      const root=await finance.postActivity({...draft(),categoryId:category.id},randomUUID());await drain();assert.equal((await row(id,root)).status,"awaiting_confirmation");
      const missing=await engine.saveGeneralRule(rule({trigger:{namespace:"transaction_posted",activityKind:"expense"},actions:[fixed()],conditions:[{field:"destination_asset",operator:"not_equals",value:target}]}));
      const expense=await post("expense");await drain();assert.equal((await row(missing,expense)).status,"not_matched");
    });
    await t.test("fixed action currency is independent; source currency/exponent remain correct in facade and Transactions provenance",async()=>{
      const usd=await insertAssetWithOpening({displayName:"USD trigger",currency:"USD",assetTypeId:assetType,normallyLiquid:true,normallySpendable:true,
        openingAmountMinor:0n,openingEffectiveAt:new Date("2026-01-01T00:00:00Z")});
      const id=await engine.saveGeneralRule(rule({conditions:[{field:"currency",operator:"equals",value:"USD"}],actions:[fixed("expense","100")]}));
      const root=await finance.postActivity({kind:"income",amountMinor:"10000",destinationAssetId:usd,occurredAt:new Date().toISOString()},randomUUID());
      await drain();const item=await row(id,root);assert.equal(item.currency_code,"IDR");
      const general=await engine.readGeneralAutomation(),view=unifyAutomation({ready:true,rules:[],occurrences:[]},{ready:true,rules:[],instances:[]},general).instances.find((value)=>value.id===item.id);
      assert.equal(view.currency,"IDR");assert.equal(view.sourceCurrency,"USD");assert.equal(view.sourceExponent,2);
      const result=await engine.confirmGeneralInstance(item.id),posted=(await finance.listActivities()).find((value)=>value.id===result);
      assert.equal(posted.currency,"IDR");assert.equal(posted.eventSourceCurrency,"USD");assert.equal(posted.eventSourceExponent,2);
    });
    await t.test("time once automatic is unique and its posted Income triggers a general rule",async()=>{
      const eventRule=await engine.saveGeneralRule(rule());
      const schedule=await engine.saveGeneralRule(rule({trigger:{namespace:"time",schedule:{frequency:"once",startOn:addDays(jakartaToday(),-1),localTime:"09:00"}},actions:[fixed("income","4000")],execution:"automatic"}));
      await Promise.all([engine.reconcileGeneralAutomation(),engine.reconcileGeneralAutomation()]);await drain();
      const occurrences=(await admin.query("SELECT * FROM automation_instances WHERE rule_id=$1",[schedule])).rows;
      assert.equal(occurrences.length,1);assert.equal(occurrences[0].status,"posted");
      const event=await row(eventRule,occurrences[0].result_activity_id);assert.equal(event.trigger_snapshot.origin,"time_automation");assert.equal(event.calculated_amount_minor,"400");
      await drain();assert.equal(await count("automation_instances","WHERE rule_id=$1",[schedule]),1);
      await engine.saveGeneralRule(rule({trigger:{namespace:"time",schedule:{frequency:"once",startOn:addDays(jakartaToday(),-1),localTime:"09:00"}},actions:[fixed("income","8000")],execution:"automatic"}),schedule);
      await drain();assert.equal(await count("automation_instances","WHERE rule_id=$1",[schedule]),1);assert.equal(await count("finance_operations","WHERE idempotency_key=$1",[occurrences[0].id]),1);
    });
    await t.test("future schedule edit keeps occurrence identity, changes version, and runtime confirmation is required",async()=>{
      const input=rule({trigger:{namespace:"time",schedule:{frequency:"once",startOn:addDays(jakartaToday(),1),localTime:"09:00"}},actions:[fixed()]});
      const id=await engine.saveGeneralRule(input);await drain();const first=(await admin.query("SELECT * FROM automation_instances WHERE rule_id=$1",[id])).rows[0];
      assert.equal(first.status,"upcoming");input.actions[0].amount.amountMinor="555";await engine.saveGeneralRule(input,id);await drain();
      const next=(await admin.query("SELECT * FROM automation_instances WHERE rule_id=$1",[id])).rows;assert.equal(next.length,1);assert.equal(next[0].id,first.id);assert.equal(next[0].version_no,2);assert.equal(next[0].calculated_amount_minor,"555");
      await assert.rejects(engine.confirmGeneralInstance(first.id));
      const runtime=rule({trigger:{namespace:"time",schedule:{frequency:"once",startOn:addDays(jakartaToday(),-1),localTime:"09:00"}},actions:[{...fixed(),amount:{strategy:"confirm_at_runtime"}}]});
      const r=await engine.saveGeneralRule(runtime);await drain();const item=(await admin.query("SELECT * FROM automation_instances WHERE rule_id=$1",[r])).rows[0];
      assert.equal(item.status,"awaiting_confirmation");await engine.confirmGeneralInstance(item.id,"777");
    });
    await t.test("paused unmaterialized time rule does not backfill elapsed once event on resume",async()=>{
      const id=await engine.saveGeneralRule(rule({trigger:{namespace:"time",schedule:{frequency:"once",startOn:addDays(jakartaToday(),-1),localTime:"09:00"}},actions:[fixed()],execution:"automatic"}));
      await engine.setGeneralRuleStatus(id,"paused");const before=await count("financial_activities");await drain();
      await engine.setGeneralRuleStatus(id,"active");await drain();assert.equal(await count("financial_activities"),before);
      assert.equal(await count("automation_instances","WHERE rule_id=$1",[id]),0);
    });
    await t.test("actual persisted event-generated Income cannot trigger generic or legacy event chains",async()=>{
      const legacy=await events.saveIncomeEventRule({title:"Legacy blocker",percentageBps:1000,outputKind:"expense",charges:[]});
      const first=await engine.saveGeneralRule(rule({actions:[fixed("income","1000")]}));
      const second=await engine.saveGeneralRule(rule({title:"Would chain"}));const root=await post();await drain();
      const candidate=await row(first,root),result=await engine.confirmGeneralInstance(candidate.id);
      const persisted=await row(first,root);assert.equal(persisted.result_activity_id,result);assert.ok(result);
      assert.equal((await admin.query("SELECT origin FROM automation_action_results WHERE activity_id=$1",[result])).rows[0].origin,"transaction_automation");
      const before=await count("automation_instances");await drain();await events.reconcileIncomeEvents();await drain();
      assert.equal(await count("automation_instances"),before);assert.equal(await row(first,result),undefined);assert.equal(await row(second,result),undefined);
      assert.equal(await count("income_event_instances","WHERE root_activity_id=$1",[result]),0);
      await events.setIncomeEventRuleStatus(legacy,"archived");
      const corrected=await finance.replaceActivity(result,draft("income","1200"),randomUUID());
      assert.equal((await finance.listActivities()).find((item)=>item.id===corrected).automationInstanceId,candidate.id);
      await finance.voidActivity(corrected,randomUUID());assert.equal((await finance.listActivities(true)).find((item)=>item.id===corrected).automationInstanceId,candidate.id);
    });
    await t.test("categories are metadata only; lifecycle does not change rule execution or historical versions",async()=>{
      const category=await engine.saveAutomationCategory("Salary"),id=await engine.saveGeneralRule(rule({automationCategoryId:category}));
      await engine.saveAutomationCategory("Allocation",category);await engine.setAutomationCategoryStatus(category,"archived");
      const root=await post();await drain();assert.equal((await row(id,root)).status,"awaiting_confirmation");
      await engine.setAutomationCategoryStatus(category,"active");const data=await engine.readGeneralAutomation();
      assert.equal(data.rules.find((item)=>item.id===id).categoryName,"Allocation");assert.equal(data.rules.find((item)=>item.id===id).version,1);
    });
    await t.test("legacy schedules and Income events remain authoritative and visible exactly once through facade",async()=>{
      const generic=await engine.saveGeneralRule(rule());const event=await events.saveIncomeEventRule({title:"Legacy Income",percentageBps:1000,outputKind:"expense",charges:[]});
      const yesterday=addDays(jakartaToday(),-1);
      const schedule=await recurring.saveRule({title:"Legacy salary",kind:"income",amountMode:"fixed",amountMinor:"5000",executionMode:"auto_post",destinationAssetId:source,
        frequency:"daily",startOn:yesterday,endOn:yesterday,localTime:"09:00",charges:[]});
      await recurring.reconcileAutomation();await events.reconcileIncomeEvents();await drain();
      const old=(await admin.query("SELECT * FROM recurring_transaction_occurrences WHERE rule_id=$1 AND status='posted'",[schedule])).rows[0];assert.ok(old.activity_id);
      assert.equal((await row(generic,old.activity_id)).trigger_snapshot.origin,"time_automation");
      const unified=unifyAutomation(await recurring.readAutomation(),await events.readIncomeEvents(),await engine.readGeneralAutomation());
      assert.equal(unified.rules.filter((item)=>item.storage==="schedule"&&item.id===schedule).length,1);
      assert.equal(unified.rules.filter((item)=>item.storage==="income_event"&&item.id===event).length,1);
      assert.equal(unified.instances.filter((item)=>item.storage==="schedule"&&item.id===old.id).length,1);
      assert.ok(unified.instances.some((item)=>item.storage==="income_event"&&item.rootId===old.activity_id));
      assert.equal(await count("automation_rules","WHERE id=ANY($1::uuid[])",[[event,schedule]]),0);
      const scheduleView=unified.rules.find((item)=>item.id===schedule&&item.storage==="schedule");
      const incomeView=unified.rules.find((item)=>item.id===event&&item.storage==="income_event");
      assert.deepEqual(builderCapabilities(scheduleView.input,"schedule").triggers,["time"]);
      assert.deepEqual(builderCapabilities(incomeView.input,"income_event").amountStrategies,["percentage_of_trigger"]);
      assert.equal(legacyRulePayload("schedule",scheduleView.input).amountMinor,"5000");
      assert.equal(legacyRulePayload("income_event",incomeView.input).percentageBps,1000);
      await recurring.saveRule(legacyRulePayload("schedule",scheduleView.input),schedule);
      await events.saveIncomeEventRule(legacyRulePayload("income_event",incomeView.input),event);
      assert.equal((await admin.query("SELECT activity_id FROM recurring_transaction_occurrences WHERE id=$1",[old.id])).rows[0].activity_id,old.activity_id);
      await assert.rejects(Promise.resolve().then(()=>legacyRulePayload("income_event",{...incomeView.input,automationCategoryId:randomUUID()})),/kategori/);
      await recurring.setRuleStatus(schedule,"archived");await events.setIncomeEventRuleStatus(event,"archived");
    });
  }finally{
    if(pool)await pool.end();hooks?.deregister();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();delete globalThis.__composableAuthorized;
  }
});
