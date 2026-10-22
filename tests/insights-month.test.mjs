import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';

registerHooks({resolve(specifier,context,next){
 if(specifier==='react'&&/\/(insights-trend|use-insights-month)\.tsx?$/.test(context.parentURL??''))return {url:'data:text/javascript,export const useState=(...args)=>globalThis.monthHarness.state(...args);export const useEffect=(...args)=>globalThis.monthHarness.effect(...args);export const useLayoutEffect=(...args)=>globalThis.monthHarness.layout(...args);export const useRef=(...args)=>globalThis.monthHarness.ref(...args);export const useId=()=>globalThis.monthHarness.id();',shortCircuit:true};
 if(specifier.startsWith('@/')){const url=new URL('../src/'+specifier.slice(2),import.meta.url);return next(url.href+(fs.existsSync(new URL(url.href+'.tsx'))?'.tsx':'.ts'),context);}
 if(context.parentURL?.includes('/src/')&&specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)){const url=new URL(specifier,context.parentURL);return next(url.href+(fs.existsSync(new URL(url.href+'.tsx'))?'.tsx':'.ts'),context);}
 return next(specifier,context);
},load(url,context,next){if(url.endsWith('.tsx'))return {format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});
const p=await import('../src/lib/analytics/presentation.ts');
const {reportingPeriod,monthKeys}=await import('../src/lib/analytics/periods.ts');
const {InsightsTrend}=await import('../src/components/insights-trend.tsx');
const {useInsightsMonth}=await import('../src/components/use-insights-month.ts');
const now=new Date('2026-10-11T08:00:00Z');
const row=(key,active=false)=>({key,id:null,name:key,archived:false,currency:'IDR',exponent:0,activityCount:active?'2':'0',incomeMinor:active?'1000000':'0',spendingMinor:active?'1232500':'0',netMinor:active?'-232500':'0'});
const report=(period={kind:'current_year'})=>({generatedAt:now.toISOString(),period:reportingPeriod(period,now)});
const annual=()=>{const r=report();return {report:r,rows:monthKeys(r.period).map(key=>row(key,key==='2026-10'))};};
function harness(hook,args){
 const slots=[],effects=[],layouts=[];let cursor=0,current=args;
 const same=(a,b)=>a?.length===b?.length&&a.every((value,i)=>Object.is(value,b[i]));
 const effect=(queue,callback,deps)=>{const i=cursor++;if(!same(slots[i]?.deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};queue.push(()=>{slots[i].cleanup=callback();});}};
 globalThis.monthHarness={state(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
  effect(callback,deps){effect(effects,callback,deps);},layout(callback,deps){effect(layouts,callback,deps);},
  ref(value){const i=cursor++;if(!(i in slots))slots[i]={value:{current:value}};return slots[i].value;},id(){return 'month-'+cursor++;}};
 return {render(next=current){current=next;cursor=0;return hook(...current);},commit(){while(layouts.length)layouts.shift()();while(effects.length)effects.shift()();},cleanup(){for(const slot of slots)slot?.cleanup?.();}};
}
function nodes(root,predicate){const values=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))values.push(node);for(const child of [node.props?.children].flat(Infinity))visit(child);}visit(root);return values;}
function text(root){if(typeof root==='string'||typeof root==='number')return String(root);if(!root||typeof root!=='object')return '';return [root.props?.children].flat(Infinity).map(text).join(' ');}
const buttons=tree=>nodes(tree,n=>n.props?.role==='button');
const selected=tree=>buttons(tree).find(n=>n.props['aria-pressed']);
const picker=tree=>nodes(tree,n=>n.type==='select')[0];
function viewport(width){
 let left=0;const writes=[];return {clientWidth:width,scrollWidth:1200,writes,get scrollLeft(){return left;},set scrollLeft(value){left=value;writes.push(value);},set scrollTop(_){throw Error('Must never scroll vertically');},getBoundingClientRect(){return {left:100};}};
}
function attach(tree,view){
 const chart=nodes(tree,n=>n.props?.ref&&n.type==='div')[0];chart.props.ref.current=view;
 const svg=nodes(tree,n=>n.type==='svg')[0];view.scrollWidth=svg.props.width;
 const hit=nodes(selected(tree),n=>n.props?.className==='insight-chart-hit')[0];
 selected(tree).props.ref.current={getBoundingClientRect(){return {left:100+Number(hit.props.x)-view.scrollLeft,right:100+Number(hit.props.x)+Number(hit.props.width)-view.scrollLeft};},scrollIntoView(){throw Error('Must not scroll the document');}};
}

test('annual/current/trend ranges prefer current Jakarta month even when past or future activity exists',()=>{
 const fixture=annual();fixture.rows[0]=row('2026-01',true);fixture.rows[11]=row('2026-12',true);assert.equal(p.initialInsightsMonth(fixture.rows,fixture.report),'2026-10');
 for(const period of [{kind:'current_month'},{kind:'monthly_trend',months:6},{kind:'custom',startDay:'2026-09-01',endDay:'2026-12-31'}]){const r=report(period);assert.equal(p.initialInsightsMonth(monthKeys(r.period).map(k=>row(k)),r),'2026-10');}
});
test('historical ranges prefer latest actual activity, then final past month; future-only picks first month and empty has none',()=>{
 const r=report({kind:'custom',startDay:'2026-07-01',endDay:'2026-09-30'});
 assert.equal(p.initialInsightsMonth([row('2026-07',true),row('2026-08',true),row('2026-09')],r),'2026-08');
 assert.equal(p.initialInsightsMonth([row('2026-07'),row('2026-08'),row('2026-09')],r),'2026-09');
 assert.equal(p.initialInsightsMonth([row('2026-11'),row('2026-12')],r),'2026-11');assert.equal(p.initialInsightsMonth([],r),'');
 assert.equal(p.initialInsightsMonth([row('2026-09'),row('2026-11',true),row('2026-12',true)],r),'2026-09');
});
test('calendar labels are complete/current/not-started independently of activity or period completeness',()=>{
 const r=report();r.period.partial=false;assert.equal(p.monthState('2026-09',r),'Selesai');assert.equal(p.monthState('2026-10',r),'Berjalan');assert.equal(p.monthState('2026-11',r),'Belum dimulai');assert.equal(p.monthState('2026-12',r),'Belum dimulai');
});
test('month and year boundary policy uses generatedAt in Asia/Jakarta, not client clock or UTC day',()=>{
 const r=report();r.generatedAt='2026-09-30T16:59:59Z';assert.equal(p.monthState('2026-09',r),'Berjalan');r.generatedAt='2026-09-30T17:00:00Z';assert.equal(p.monthState('2026-10',r),'Berjalan');assert.equal(p.initialInsightsMonth([row('2026-09'),row('2026-10')],r),'2026-10');
 r.generatedAt='2026-12-31T17:00:00Z';assert.equal(p.monthState('2026-12',r),'Selesai');assert.equal(p.monthState('2027-01',r),'Berjalan');assert.equal(p.initialInsightsMonth([row('2026-12'),row('2027-01')],r),'2027-01');
});
test('valid explicit future/past month wins and invalid manual month falls back deterministically',()=>{
 const {rows,report:r}=annual();assert.equal(p.initialInsightsMonth(rows,r,'2026-09'),'2026-09');assert.equal(p.initialInsightsMonth(rows,r,'2026-12'),'2026-12');assert.equal(p.initialInsightsMonth(rows,r,'2025-12'),'2026-10');
});
test('annual chart initializes October with exact detail, status labels and synchronized dropdown',()=>{
 const h=harness(InsightsTrend,[annual()]);const tree=h.render();assert.equal(picker(tree).props.value,'2026-10');assert.match(selected(tree).props['aria-label'],/Okt 2026, Berjalan/);assert.match(text(tree),/Rp1\.000\.000/);assert.match(text(tree),/−Rp232\.500/);
 for(const month of ['Nov','Des'])assert.match(buttons(tree).find(n=>n.props['aria-label'].startsWith(month)).props['aria-label'],/Belum dimulai/);h.cleanup();
});
test('initial selected month is revealed within chart only at compact/mobile/desktop viewport sizes',()=>{
 for(const size of [280,360,390,430,640,1280]){
  const h=harness(InsightsTrend,[annual()]),view=viewport(size),tree=h.render();attach(tree,view);h.commit();const target=selected(tree).props.ref.current.getBoundingClientRect();assert.ok(target.left>=100);assert.ok(target.right<=100+size);assert.equal(view.writes.length,size>=1200?0:1);h.cleanup();
 }
});
test('manual chart selection and native scrolling survive ordinary rerender and same-range refreshed row objects',()=>{
 const fixture=annual(),before=structuredClone(fixture),h=harness(InsightsTrend,[fixture]),view=viewport(390);let tree=h.render();attach(tree,view);h.commit();
 buttons(tree)[8].props.onClick();tree=h.render();attach(tree,view);h.commit();assert.equal(picker(tree).props.value,'2026-09');
 view.scrollLeft=0;const writes=view.writes.length;tree=h.render();attach(tree,view);h.commit();assert.equal(view.writes.length,writes);
 tree=h.render([{...fixture,rows:structuredClone(fixture.rows),report:{...fixture.report,generatedAt:'2026-10-11T09:00:00Z'}}]);attach(tree,view);h.commit();assert.equal(view.writes.length,writes);assert.equal(picker(tree).props.value,'2026-09');assert.deepEqual(fixture,before);h.cleanup();
});
test('viewport resize reveals selected month; unchanged observer callbacks never undo native scrolling',()=>{
 const original=globalThis.ResizeObserver;let callback,disconnected=false;
 globalThis.ResizeObserver=class {constructor(fn){callback=fn;}observe(){}disconnect(){disconnected=true;}};
 const h=harness(InsightsTrend,[annual()]),view=viewport(640);
 try{
  const tree=h.render();attach(tree,view);h.commit();view.scrollLeft=0;const count=view.writes.length;callback();assert.equal(view.writes.length,count);
  view.clientWidth=280;callback();const box=selected(tree).props.ref.current.getBoundingClientRect();assert.ok(box.left>=100&&box.right<=380);assert.equal(view.writes.length,count+1);
 }finally{h.cleanup();globalThis.ResizeObserver=original;}assert.equal(disconnected,true);
});
test('dropdown, focus and Enter/Space select the same month and retain keyboard semantics',()=>{
 const h=harness(InsightsTrend,[annual()]);let tree=h.render();picker(tree).props.onChange({target:{value:'2026-12'}});tree=h.render();assert.match(selected(tree).props['aria-label'],/Des 2026, Belum dimulai/);
 buttons(tree)[0].props.onFocus();tree=h.render();assert.equal(picker(tree).props.value,'2026-01');let prevented=0;
 buttons(tree)[1].props.onKeyDown({key:'Enter',preventDefault(){prevented++;}});tree=h.render();assert.equal(picker(tree).props.value,'2026-02');
 buttons(tree)[2].props.onKeyDown({key:' ',preventDefault(){prevented++;}});tree=h.render();assert.equal(picker(tree).props.value,'2026-03');assert.equal(prevented,2);assert.equal(selected(tree).props.tabIndex,0);h.cleanup();
});
test('short/zero-only series uses smaller chart, one zero scale label and genuine zero heights with table alternative',()=>{
 const fixture={report:report({kind:'previous_month'}),rows:[row('2026-09')]},h=harness(InsightsTrend,[fixture]);const tree=h.render(),svg=nodes(tree,n=>n.type==='svg')[0];
 assert.equal(svg.props.width,280);assert.equal(svg.props.height,208);assert.match(text(tree),/bernilai nol/);assert.equal(nodes(tree,n=>n.props?.className==='insight-axis'&&n.props.children==='Rp0').length,1);
 assert.ok(nodes(tree,n=>n.type==='rect'&&/insight-(income|spending)-bar/.test(n.props.className)).every(n=>n.props.height===0));assert.match(selected(tree).props['aria-label'],/Sep 2026, Selesai/);assert.equal(nodes(tree,n=>n.type==='table').length,1);assert.doesNotMatch(text(tree),/NaN|Infinity/);h.cleanup();
 assert.equal(p.insightsTrendLayout(2).height,208);assert.equal(p.insightsTrendLayout(6).height,272);
});
test('manual month survives loading/refresh; invalid choice is cleared before subsequent ranges',()=>{
 const fixture=annual(),h=harness(useInsightsMonth,[fixture.rows,fixture.report]);let choice=h.render();h.commit();choice.select('2026-09');assert.equal(h.render().month,'2026-09');h.commit();
 assert.equal(h.render([[],undefined]).month,'');h.commit();assert.equal(h.render([fixture.rows,{...fixture.report}]).month,'2026-09');h.commit();
 const historical=report({kind:'custom',startDay:'2026-08-01',endDay:'2026-08-31'});assert.equal(h.render([[row('2026-08')],historical]).month,'2026-08');h.commit();assert.equal(h.render([fixture.rows,fixture.report]).month,'2026-10');h.cleanup();
});
test('period-switching defaults remain correct across current/previous/year/trend/custom and restored ranges',()=>{
 const h=harness(useInsightsMonth,[[],undefined]);for(const [period,expected] of [[{kind:'current_month'},'2026-10'],[{kind:'previous_month'},'2026-09'],[{kind:'current_year'},'2026-10'],[{kind:'monthly_trend',months:6},'2026-10'],[{kind:'custom',startDay:'2026-07-01',endDay:'2026-08-31'},'2026-07'],[{kind:'current_year'},'2026-10'],[{kind:'previous_month'},'2026-09']]){
  const r=report(period),rows=monthKeys(r.period).map(k=>row(k,k==='2026-07'));assert.equal(h.render([rows,r]).month,expected);h.commit();
 }h.cleanup();
});
test('empty series remains empty; scroll positioning is bounded and visible months do not move',()=>{
 const h=harness(InsightsTrend,[{rows:[],report:report()}]);assert.match(text(h.render()),/Belum ada seri bulanan/);h.commit();h.cleanup();assert.equal(p.insightsMonthScroll(100,400,150,210,800),100);assert.equal(p.insightsMonthScroll(0,390,950,1010,810),785);assert.equal(p.insightsMonthScroll(0,0,950,1010,1200),0);assert.equal(p.insightsMonthScroll(0,400,1500,1560,800),800);
});
