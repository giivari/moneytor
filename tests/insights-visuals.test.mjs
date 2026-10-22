import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';

registerHooks({resolve(specifier,context,next){
 if(specifier==='react'&&/\/(insights-carousel|insights-visuals|insights-disclosure|insights-detail-pair|use-insights-viewport)\.tsx?$/.test(context.parentURL??''))return {shortCircuit:true,url:'data:text/javascript,export const useState=(...args)=>globalThis.visualHarness.state(...args);export const useLayoutEffect=(...args)=>globalThis.visualHarness.effect(...args);export const useRef=(...args)=>globalThis.visualHarness.ref(...args);export const useId=()=>globalThis.visualHarness.id();export const useSyncExternalStore=()=>globalThis.visualHarness.mobile;'};
 if(specifier.startsWith('@/')){const base=new URL('../src/'+specifier.slice(2),import.meta.url);return next(base.href+(fs.existsSync(new URL(base.href+'.tsx'))?'.tsx':'.ts'),context);}
 if(context.parentURL?.includes('/src/')&&specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)){const base=new URL(specifier,context.parentURL);return next(base.href+(fs.existsSync(new URL(base.href+'.tsx'))?'.tsx':'.ts'),context);}
 return next(specifier,context);
},load(url,context,next){if(url.endsWith('.tsx'))return {shortCircuit:true,format:'module',source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});
const {visualTrend,initialVisualInterval,visualIntervalState,visualIntervalAxis,spendingShares,carouselPosition}=await import('../src/lib/analytics/visuals.ts');
const {reportingPeriod}=await import('../src/lib/analytics/periods.ts');
const {InsightsCarousel}=await import('../src/components/insights-carousel.tsx');
const {InsightsVisualTrend}=await import('../src/components/insights-visuals.tsx');
const {InsightsDisclosure}=await import('../src/components/insights-disclosure.tsx');
const {InsightsDetailPair}=await import('../src/components/insights-detail-pair.tsx');
const now=new Date('2026-10-11T08:00:00Z');
const row=(key,extra={})=>({key,currency:'IDR',exponent:0,incomeMinor:'0',spendingMinor:'0',netMinor:'0',activityCount:'0',...extra});
const report=(period={kind:'current_month'})=>({generatedAt:now.toISOString(),period:reportingPeriod(period,now),daily:[],monthly:[]});
const totals=rows=>rows.reduce((out,r)=>{for(const key of ['incomeMinor','spendingMinor','netMinor','activityCount'])out[key]=(BigInt(out[key])+BigInt(r[key])).toString();return out;},{incomeMinor:'0',spendingMinor:'0',netMinor:'0',activityCount:'0'});
function harness(component,args,mobile=true){
 const slots=[],effects=[];let cursor=0,current=args;
 const same=(a,b)=>a?.length===b?.length&&a.every((v,i)=>Object.is(v,b[i]));
 const driver={mobile,state(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},ref(initial){const i=cursor++;if(!(i in slots))slots[i]={value:{current:initial}};return slots[i].value;},id(){return 'visual-'+cursor++;},effect(callback,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=callback();});}}};
 globalThis.visualHarness=driver;
 return {driver,render(next=current){globalThis.visualHarness=driver;current=next;cursor=0;return component(...current);},commit(){while(effects.length)effects.shift()();},cleanup(){slots.forEach(s=>s?.cleanup?.());}};
}
const nodes=(root,predicate)=>{const found=[];function visit(n){if(!n||typeof n!=='object')return;if(predicate(n))found.push(n);[n.props?.children].flat(Infinity).forEach(visit);}visit(root);return found;};
const picker=tree=>nodes(tree,n=>n.type==='select')[0];
const active=tree=>nodes(tree,n=>n.props?.['aria-pressed']===true)[0];

test('Jakarta weekly buckets clip partial Monday–Sunday weeks without changing exact totals',()=>{
 const r=report();r.daily=[row('2026-10-01',{incomeMinor:'1000000',netMinor:'1000000',activityCount:'1'}),row('2026-10-04',{spendingMinor:'100000',netMinor:'-100000',activityCount:'1'}),row('2026-10-05',{spendingMinor:'30000',netMinor:'-30000',activityCount:'1'})];
 const result=visualTrend(r,'IDR');assert.equal(result.weekly,true);assert.equal(result.intervals.length,5);
 assert.equal(result.intervals[0].startDay,'2026-10-01');assert.equal(result.intervals[0].endDayExclusive,'2026-10-05');assert.equal(result.intervals.at(-1).endDayExclusive,'2026-11-01');assert.deepEqual(totals(result.intervals),totals(r.daily));assert.equal(result.intervals[1].spendingMinor,'30000');
});
test('weekly ranges honor year boundary, leap day, one day and exclusive end',()=>{
 for(const [start,end] of [['2026-12-31','2027-01-03'],['2024-02-28','2024-03-01'],['2026-10-11','2026-10-11']]){
  const r=report({kind:'custom',startDay:start,endDay:end});r.daily=[row(start,{spendingMinor:'19',netMinor:'-19',activityCount:'1'}),row(r.period.endDayExclusive,{spendingMinor:'999',netMinor:'-999',activityCount:'1'})];
  const buckets=visualTrend(r,'IDR').intervals;assert.equal(buckets[0].startDay,start);assert.equal(buckets.at(-1).endDayExclusive,r.period.endDayExclusive);assert.equal(totals(buckets).spendingMinor,'19');
 }
});
test('short-range zero days remain truthful; Income-only and Transfer-only do not fabricate spending',()=>{
 const r=report();assert.equal(totals(visualTrend(r,'IDR').intervals).spendingMinor,'0');
 r.daily=[row('2026-10-11',{incomeMinor:'999',netMinor:'999',activityCount:'1'})];assert.equal(totals(visualTrend(r,'IDR').intervals).incomeMinor,'999');assert.equal(totals(visualTrend(r,'IDR').intervals).spendingMinor,'0');
 r.daily=[row('2026-10-11',{activityCount:'1',transferPrincipalMinor:'900'})];assert.equal(totals(visualTrend(r,'IDR').intervals).netMinor,'0');
});
test('annual and long-series summaries merge only adjacent existing months and preserve every bigint',()=>{
 const r=report({kind:'current_year'});r.monthly=Array.from({length:12},(_,i)=>row(`2026-${String(i+1).padStart(2,'0')}`,{incomeMinor:i===9?'18446744073709551614':'0',spendingMinor:i===9?'140000':'0',netMinor:i===9?'18446744073709411614':'0',activityCount:i===9?'3':'0'}));
 const mobile=visualTrend(r,'IDR',6),desktop=visualTrend(r,'IDR',12);assert.equal(mobile.grouped,true);assert.equal(mobile.intervals.length,6);assert.equal(mobile.fullIntervals.length,12);assert.equal(desktop.intervals.length,12);assert.deepEqual(totals(mobile.intervals),totals(desktop.intervals));assert.deepEqual(totals(mobile.fullIntervals),totals(desktop.intervals));assert.equal(initialVisualInterval(mobile.intervals,r),'2026-09');
 assert.equal(initialVisualInterval(desktop.intervals,r,'2026-12'),'2026-12');assert.throws(()=>visualTrend(r,'IDR',0));
});
test('custom monthly intervals stay clipped to report dates and currencies never mix',()=>{
 const r=report({kind:'custom',startDay:'2026-06-15',endDay:'2026-10-20'});r.monthly=[row('2026-06',{incomeMinor:'10',netMinor:'10'}),row('2026-10',{spendingMinor:'7',netMinor:'-7'}),row('2026-10',{currency:'USD',incomeMinor:'90000',netMinor:'90000'})];
 const bins=visualTrend(r,'IDR').intervals;assert.equal(bins[0].startDay,'2026-06-15');assert.equal(bins.at(-1).endDayExclusive,'2026-10-21');assert.equal(totals(bins).incomeMinor,'10');assert.equal(totals(visualTrend(r,'USD').intervals).incomeMinor,'90000');
});
test('initial interval and calendar state use report-generated Jakarta time, not client time or activity',()=>{
 const r=report();const rows=visualTrend(r,'IDR').intervals;assert.equal(initialVisualInterval(rows,r),'2026-10-05');assert.equal(visualIntervalState(rows[0],r),'Selesai');assert.equal(visualIntervalState(rows[1],r),'Berjalan');assert.equal(visualIntervalState(rows[2],r),'Belum dimulai');
 r.generatedAt='2026-10-11T17:00:00Z';assert.equal(initialVisualInterval(rows,r),'2026-10-12');
});
test('category and origin shares use spending only; zeros, one category and mixed currencies are explicit',()=>{
 const shares=spendingShares([row('manual',{incomeMinor:'99999999',spendingMinor:'100'}),row('automation',{spendingMinor:'30'}),row('allocation_adjustment',{spendingMinor:'10'})]);assert.equal(shares.totalMinor,'140');assert.equal(shares.rows[0].shareBps,'7142');assert.equal(spendingShares([row('uncategorized',{spendingMinor:'900'})]).rows[0].shareBps,'10000');assert.equal(spendingShares([]).totalMinor,'0');assert.equal(spendingShares([row('income',{incomeMinor:'700'})]).rows[0].shareBps,null);assert.throws(()=>spendingShares([row('a'),row('b',{currency:'USD'})]),/mata uang/);
});
test('compact chart is bounded and keyboard/dropdown interval selection remains stable on rerender',()=>{
 const r=report();r.daily=[row('2026-10-05',{spendingMinor:'140000',netMinor:'-140000',activityCount:'1'})];let month='2026-10';const selection={get month(){return month;},select(value){month=value;}};
 const h=harness(InsightsVisualTrend,[{report:r,currency:'IDR',exponent:0,selection}]);let tree=h.render();assert.match(active(tree).props['aria-label'],/Rp140\.000/);assert.equal(nodes(tree,n=>n.props?.className?.includes('insight-chart-scroll')).length,0);
 picker(tree).props.onChange({target:{value:'2026-10-19'}});tree=h.render();assert.equal(picker(tree).props.value,'2026-10-19');tree=h.render();assert.equal(picker(tree).props.value,'2026-10-19');
 let prevented=false;const first=nodes(tree,n=>n.props?.role==='button')[0];first.props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});assert.equal(prevented,true);tree=h.render();assert.equal(picker(tree).props.value,'2026-10-01');
 let stopped=false,focused=false;first.props.onKeyDown({key:'ArrowRight',preventDefault(){},stopPropagation(){stopped=true;},currentTarget:{parentElement:{querySelectorAll(){return [null,{focus(options){assert.equal(options.preventScroll,true);focused=true;}}];}}}});
 tree=h.render();assert.equal(stopped,true);assert.equal(focused,true);assert.equal(picker(tree).props.value,'2026-10-05');h.cleanup();
});
test('compact chart currency/range change selects valid intervals and contains no fake bars',()=>{
 const r=report(),h=harness(InsightsVisualTrend,[{report:r,currency:'IDR',exponent:0}]);let tree=h.render();assert.equal(nodes(tree,n=>n.type==='rect'&&['insight-income-bar','insight-spending-bar'].includes(n.props.className)&&n.props.height!==0).length,0);
 const previous=report({kind:'previous_month'});tree=h.render([{report:previous,currency:'USD',exponent:2}]);assert.equal(picker(tree).props.value,'2026-09-28');h.cleanup();
});

function carouselHarness(index=0,width=320,mobile=true){
 const selection={index,select(value){selection.index=value;}};
 const h=harness(InsightsCarousel,[{children:['trend','composition','origin'],selection}],mobile);
 let left=0;const writes=[];
 const viewport={clientWidth:width,scrollWidth:width*3,offsetLeft:20,style:{},children:[520,410,280].map((offsetHeight,i)=>({offsetLeft:20+i*width,offsetHeight})),get scrollLeft(){return left;},set scrollLeft(value){left=value;writes.push(value);},set scrollTop(_){throw Error('No vertical scroll');}};
 const render=()=>{const tree=h.render();nodes(tree,n=>n.props?.className==='insight-carousel-track')[0].props.ref.current=viewport;return tree;};
 return {h,selection,viewport,writes,render};
}
test('carousel Previous/Next buttons clamp boundaries and retain explicit selected state',()=>{
 const c=carouselHarness();let tree=c.render();c.h.commit();assert.equal(control(tree,'Analisis sebelumnya').props['aria-disabled'],true);control(tree,'Analisis sebelumnya').props.onClick();assert.equal(c.selection.index,0);
 control(tree,'Analisis berikutnya').props.onClick();tree=c.render();c.h.commit();assert.equal(c.selection.index,1);assert.equal(c.viewport.scrollLeft,320);assert.equal(nodes(tree,n=>n.type==='section'&&n.props?.['aria-current']==='true')[0].props['aria-label'],'2 dari 3');
 control(tree,'Analisis berikutnya').props.onClick();tree=c.render();c.h.commit();assert.equal(control(tree,'Analisis berikutnya').props['aria-disabled'],true);control(tree,'Analisis berikutnya').props.onClick();assert.equal(c.selection.index,2);c.h.cleanup();
});
const control=(tree,label)=>nodes(tree,n=>n.type==='button'&&n.props['aria-label']===label)[0];
test('carousel keyboard acts only on track; chart/dropdown arrows cannot advance it',()=>{
 const c=carouselHarness(),tree=c.render(),track=nodes(tree,n=>n.props?.className==='insight-carousel-track')[0];c.h.commit();let prevented=0;
 track.props.onKeyDown({key:'ArrowRight',target:'child',currentTarget:'track',preventDefault(){prevented++;}});assert.equal(c.selection.index,0);assert.equal(prevented,0);
 track.props.onKeyDown({key:'ArrowRight',target:'track',currentTarget:'track',preventDefault(){prevented++;}});assert.equal(c.selection.index,1);assert.equal(prevented,1);c.h.cleanup();
});
test('native carousel swipe updates indicator without forcing scroll or stealing vertical focus',()=>{
 const c=carouselHarness();let tree=c.render();c.h.commit();c.writes.length=0;c.viewport.scrollLeft=325;c.writes.length=0;
 nodes(tree,n=>n.props?.className==='insight-carousel-track')[0].props.onScroll({currentTarget:c.viewport});tree=c.render();c.h.commit();assert.equal(c.selection.index,1);assert.equal(c.writes.length,0);c.render();c.h.commit();assert.equal(c.writes.length,0);assert.equal(carouselPosition(610,[0,300,600]),2);c.h.cleanup();
});
test('carousel restores selected slide after loading and stays a grid without scroll on desktop',()=>{
 const c=carouselHarness(2);c.render();c.h.commit();assert.equal(c.viewport.scrollLeft,640);assert.equal(c.viewport.style.height,'288px');c.h.cleanup();
 const desktop=carouselHarness(2,1280,false);desktop.viewport.scrollWidth=1280;const tree=desktop.render();desktop.h.commit();assert.equal(desktop.writes.length,0);assert.equal(desktop.viewport.style.height,'');assert.ok(nodes(tree,n=>n.type==='section').every(n=>n.props.inert===false));desktop.h.cleanup();
});
test('responsive carousel CSS uses full-width snap columns and local bounds, preserving dock and wrapping',()=>{
 const css=fs.readFileSync(new URL('../src/app/insights/insights.css',import.meta.url),'utf8');assert.match(css,/@media \(max-width: 767px\)/);assert.match(css,/grid-auto-columns: 100%/);assert.match(css,/scroll-snap-type: x mandatory/);assert.match(css,/insight-slide:last-child \{ grid-column: auto; margin: 0/);assert.match(css,/minmax\(min\(100%, max\(8rem, calc\(\(100% - 12px\) \/ 2\)\)\), 1fr\)/);assert.match(css,/overflow-wrap: anywhere/);assert.doesNotMatch(css,/flex: 0 0 90%|margin-right: 10%|body|\.bottom-dock|\.app-header|\.main-content/);
 const code=fs.readFileSync(new URL('../src/components/insights-carousel.tsx',import.meta.url),'utf8');assert.doesNotMatch(code,/setInterval|scrollIntoView|scrollTop|fetch\(|smooth/);assert.match(code,/event.target !== event.currentTarget/);
});
test('annual mobile chart has four exact quarterly groups, readable labels and full monthly data',()=>{
 const r=report({kind:'current_year'});r.monthly=Array.from({length:12},(_,i)=>row(`2026-${String(i+1).padStart(2,'0')}`,{incomeMinor:String(BigInt(i)*9007199254740993n),spendingMinor:String(i*11000),netMinor:String(BigInt(i)*9007199254740993n-BigInt(i*11000)),activityCount:'1'}));
 const bins=visualTrend(r,'IDR',4);assert.equal(bins.intervals.length,4);assert.deepEqual(bins.intervals.map(b=>visualIntervalAxis(b,false)),[1,2,3,4].map(i=>({label:`TW${i}`,year:'2026'})));assert.deepEqual(totals(bins.intervals),totals(r.monthly));assert.equal(bins.fullIntervals.length,12);
 const h=harness(InsightsVisualTrend,[{report:r,currency:'IDR',exponent:0}]);let tree=h.render();assert.equal(nodes(tree,n=>n.props?.role==='button').length,4);assert.equal(picker(tree).props.value,'2026-10');h.driver.mobile=false;tree=h.render();assert.equal(nodes(tree,n=>n.props?.role==='button').length,12);h.cleanup();
});
test('axis labels retain actual years and do not call a cross-quarter range a quarter',()=>{
 assert.deepEqual(visualIntervalAxis({startDay:'2026-11-01',endDayExclusive:'2027-02-01'},false),{label:'Nov–Jan',year:'2026–2027'});
 assert.deepEqual(visualIntervalAxis({startDay:'2026-02-01',endDayExclusive:'2026-05-01'},false),{label:'Feb–Apr',year:'2026'});
 assert.deepEqual(visualIntervalAxis({startDay:'2026-01-15',endDayExclusive:'2026-04-01'},false),{label:'Jan–Mar',year:'2026'});
 assert.deepEqual(visualIntervalAxis({startDay:'2026-07-01',endDayExclusive:'2026-10-01'},false),{label:'TW3',year:'2026'});
 assert.deepEqual(visualIntervalAxis({startDay:'2026-10-05',endDayExclusive:'2026-10-12'},true),{label:'5 Okt',year:'2026'});
});
test('360/390/430 width models keep full-width positions, pagination, heights and inactive focus targets synchronized',()=>{
 for(const width of [360,390,430]){
  const c=carouselHarness(0,width);let tree=c.render();c.h.commit();control(tree,'Analisis 3 dari 3').props.onClick();tree=c.render();c.h.commit();assert.equal(c.viewport.scrollLeft,width*2);assert.equal(c.viewport.style.height,'288px');assert.equal(control(tree,'Analisis 3 dari 3').props['aria-current'],'true');assert.deepEqual(nodes(tree,n=>n.type==='section').map(n=>n.props.inert),[true,true,false]);
  c.writes.length=0;c.render();c.h.commit();assert.equal(c.writes.length,0);c.h.cleanup();
 }
});
test('resize observes width and active content, restores selected position without a measurement loop',()=>{
 let callback,observed=[],disconnected=0;const previous=globalThis.ResizeObserver;
 globalThis.ResizeObserver=class{constructor(cb){callback=cb;}observe(element){observed.push(element);}disconnect(){disconnected++;}};
 try{
  const c=carouselHarness(1,390);c.render();c.h.commit();assert.equal(observed.length,2);c.writes.length=0;callback();assert.equal(c.writes.length,0);
  c.viewport.clientWidth=430;c.viewport.scrollWidth=1290;c.viewport.children.forEach((s,i)=>s.offsetLeft=20+i*430);callback();assert.equal(c.viewport.scrollLeft,430);
  c.viewport.children[1].offsetHeight=610;c.writes.length=0;callback();assert.equal(c.viewport.style.height,'618px');assert.equal(c.writes.length,0);
  c.h.driver.mobile=false;c.render();c.h.commit();assert.equal(c.viewport.style.height,'');c.h.cleanup();assert.ok(disconnected>=2);
 }finally{globalThis.ResizeObserver=previous;}
});
test('secondary disclosure is closed and deferred on fresh mount, then retains explicit independent state',()=>{
 const h=harness(InsightsDisclosure,[{title:'Biaya',summary:'Rp0',children:'Detailed table'}]);let tree=h.render();assert.equal(tree.props.open,false);assert.equal(nodes(tree,n=>n.props?.className==='insight-disclosure-content').length,0);
 tree.props.onToggle({currentTarget:{open:true}});tree=h.render();assert.equal(tree.props.open,true);assert.equal(nodes(tree,n=>n.props?.className==='insight-disclosure-content')[0].props.children,'Detailed table');assert.equal(h.render().props.open,true);
 tree.props.onToggle({currentTarget:{open:false}});assert.equal(h.render().props.open,false);h.cleanup();
 const fresh=harness(InsightsDisclosure,[{title:'Akun',summary:'1 akun',children:'Accounts'}]);assert.equal(fresh.render().props.open,false);fresh.cleanup();
});

function pairHarness(label='Group A'){
 const items=[{key:'left',title:'Left',action:'Open left',content:'CHART LEFT',details:'DETAIL LEFT'},{key:'right',title:'Right',action:'Open right',content:'CHART RIGHT',details:'DETAIL RIGHT'}];
 const h=harness(InsightsDetailPair,[{label,items}]),focus=[],reveals=[];let top=400;
 const render=(nextItems=items)=>{
  const tree=h.render([{label,items:nextItems}]);nodes(tree,n=>n.props?.className==='surface insight-panel insight-detail-panel')[0].props.ref.current={contains(value){return value==='inside';}};
  for(const node of nodes(tree,n=>n.props?.className==='insight-detail-trigger'))node.props.ref({focus(options){focus.push({id:node.props.id,options});}});
  const heading=nodes(tree,n=>n.props?.className==='insight-detail-heading')[0];if(heading)heading.props.ref.current={getBoundingClientRect(){return {top};},scrollIntoView(options){reveals.push(options);}};
  return tree;
 };
 return {h,items,render,focus,reveals,setTop(value){top=value;}};
}
const trigger=(tree,key)=>nodes(tree,n=>n.props?.className==='insight-detail-trigger'&&n.props.id.endsWith('-'+key))[0];
const detailPanel=tree=>nodes(tree,n=>n.props?.className==='surface insight-panel insight-detail-panel')[0];

test('paired summary details toggle, replace within group and remain siblings of stable summary content',()=>{
 const priorDoc=globalThis.document,priorWindow=globalThis.window;globalThis.document={activeElement:'outside'};globalThis.window={innerHeight:800};
 try{
  const c=pairHarness();let tree=c.render();c.h.commit();const id=detailPanel(tree).props.id;assert.equal(detailPanel(tree).props.hidden,true);assert.equal(nodes(tree,n=>n.props?.className==='insight-detail-content').length,0);
  trigger(tree,'left').props.onClick();tree=c.render();c.h.commit();assert.equal(detailPanel(tree).props.hidden,false);assert.equal(trigger(tree,'left').props['aria-expanded'],true);assert.equal(trigger(tree,'right').props['aria-expanded'],false);assert.equal(detailPanel(tree).props['aria-labelledby'],trigger(tree,'left').props.id);assert.equal(trigger(tree,'left').props['aria-controls'],id);
  assert.equal(nodes(tree,n=>n.props?.className==='insight-detail-content')[0].props.children,'DETAIL LEFT');assert.ok(nodes(tree,n=>n.props?.className==='surface insight-panel insight-summary-card').every(n=>nodes(n,child=>child.props?.className==='insight-detail-content').length===0));
  trigger(tree,'right').props.onClick();tree=c.render();c.h.commit();assert.equal(detailPanel(tree).props.id,id);assert.equal(nodes(tree,n=>n.props?.className==='insight-detail-content').length,1);assert.equal(nodes(tree,n=>n.props?.className==='insight-detail-content')[0].props.children,'DETAIL RIGHT');assert.equal(detailPanel(tree).props['aria-labelledby'],trigger(tree,'right').props.id);
  trigger(tree,'right').props.onClick();tree=c.render();c.h.commit();assert.equal(detailPanel(tree).props.hidden,true);assert.equal(c.reveals.length,0);c.h.cleanup();
 }finally{globalThis.document=priorDoc;globalThis.window=priorWindow;}
});
test('different pairs retain independent state; data rerenders update detail without resetting selection or scrolling',()=>{
 const priorDoc=globalThis.document,priorWindow=globalThis.window;globalThis.document={activeElement:'outside'};globalThis.window={innerHeight:800};
 try{
  const a=pairHarness('A'),b=pairHarness('B');let ta=a.render(),tb=b.render();a.h.commit();b.h.commit();trigger(ta,'left').props.onClick();ta=a.render();a.h.commit();tb=b.render();b.h.commit();assert.equal(trigger(tb,'left').props['aria-expanded'],false);
  trigger(tb,'right').props.onClick();tb=b.render();b.h.commit();ta=a.render();a.h.commit();assert.equal(trigger(ta,'left').props['aria-expanded'],true);assert.equal(trigger(tb,'right').props['aria-expanded'],true);
  ta=a.render(a.items.map(item=>({...item,details:'NEW '+item.key})));a.h.commit();assert.equal(nodes(ta,n=>n.props?.className==='insight-detail-content')[0].props.children,'NEW left');assert.equal(a.reveals.length,0);a.h.cleanup();b.h.cleanup();
 }finally{globalThis.document=priorDoc;globalThis.window=priorWindow;}
});
test('inline panel close/Escape restores focus only when focus is inside; replacing restores new trigger',()=>{
 const priorDoc=globalThis.document,priorWindow=globalThis.window;globalThis.document={activeElement:'outside'};globalThis.window={innerHeight:800};
 try{
  const c=pairHarness();let tree=c.render();c.h.commit();trigger(tree,'left').props.onClick();tree=c.render();c.h.commit();globalThis.document.activeElement='inside';nodes(tree,n=>n.type==='button'&&n.props['aria-label']==='Tutup rincian Left')[0].props.onClick();tree=c.render();c.h.commit();assert.equal(detailPanel(tree).props.hidden,true);assert.ok(c.focus[0].id.endsWith('-left'));assert.deepEqual(c.focus[0].options,{preventScroll:true});
  globalThis.document.activeElement='outside';trigger(tree,'left').props.onClick();tree=c.render();c.h.commit();globalThis.document.activeElement='inside';trigger(tree,'right').props.onClick();tree=c.render();c.h.commit();assert.ok(c.focus[1].id.endsWith('-right'));
  let stopped=false;detailPanel(tree).props.onKeyDown({key:'Escape',stopPropagation(){stopped=true;}});tree=c.render();c.h.commit();assert.equal(stopped,true);assert.equal(detailPanel(tree).props.hidden,true);assert.ok(c.focus[2].id.endsWith('-right'));c.h.cleanup();
 }finally{globalThis.document=priorDoc;globalThis.window=priorWindow;}
});
test('offscreen detail heading is revealed once on opening, with no scrolling on normal updates or closing',()=>{
 const priorDoc=globalThis.document,priorWindow=globalThis.window;globalThis.document={activeElement:'outside'};globalThis.window={innerHeight:800};
 try{
  const c=pairHarness();c.setTop(1000);let tree=c.render();c.h.commit();trigger(tree,'left').props.onClick();tree=c.render();c.h.commit();assert.deepEqual(c.reveals,[{block:'nearest',inline:'nearest',behavior:'instant'}]);c.render();c.h.commit();assert.equal(c.reveals.length,1);trigger(tree,'left').props.onClick();c.render();c.h.commit();assert.equal(c.reveals.length,1);c.h.cleanup();
 }finally{globalThis.document=priorDoc;globalThis.window=priorWindow;}
});
test('desktop CSS aligns natural summary rows with a full-width sibling panel based on actual content width',()=>{
 const css=fs.readFileSync(new URL('../src/app/insights/insights.css',import.meta.url),'utf8');assert.match(css,/insight-report \{ container-type: inline-size/);assert.match(css,/@container \(min-width: 900px\)/);assert.match(css,/insight-detail-pair \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);assert.match(css,/insight-detail-panel \{ grid-column: 1 \/ -1/);assert.match(css,/insight-detail-trigger \{[^\n]*margin-top: auto/);assert.doesNotMatch(css,/insight-summary-card[^\n]*(?:min-height|height):/);
});
