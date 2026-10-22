import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Exercise the real hooks with controlled effect commits and deferred network responses.
registerHooks({resolve(specifier,context,next){
 if(specifier==='react'&&/\/(use-list-request|use-automation-history|use-insights-report|use-insights-month|insights-workspace|activity-page)\.tsx?$/.test(context.parentURL??''))return {shortCircuit:true,url:'data:text/javascript,export const useState=(...args)=>globalThis.listHarness.state(...args);export const useEffect=(...args)=>globalThis.listHarness.effect(...args);export const useCallback=(...args)=>globalThis.listHarness.callback(...args);'};
 if(specifier==='@/lib/finance/client')return {shortCircuit:true,url:'data:text/javascript,export const requestJson=(...args)=>globalThis.listHarness.request(...args);'};
 if(specifier.startsWith('@/')){const url=new URL('../src/'+specifier.slice(2),import.meta.url);return next(url.href+(fs.existsSync(new URL(url.href+'.tsx'))?'.tsx':'.ts'),context);}
 if(specifier.startsWith('.')&&context.parentURL?.includes('/src/')&&!/\.[a-z]+$/i.test(specifier)){const url=new URL(specifier,context.parentURL);return next(url.href+(fs.existsSync(new URL(url.href+'.tsx'))?'.tsx':'.ts'),context);}
 return next(specifier,context);
},load(url,context,next){if(url.endsWith('.tsx'))return {format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});
const {useAutomationHistory}=await import('../src/components/use-automation-history.ts');
const {useActivityPage}=await import('../src/components/activity-page.tsx');
const {ListContent}=await import('../src/components/list-content.tsx');
const {useInsightsReport}=await import('../src/components/use-insights-report.ts');
const {InsightsWorkspace}=await import('../src/components/insights-workspace.tsx');

function harness(hook,args){
 const slots=[],pending=[],requests=[];let cursor=0,currentArgs=args;
 const same=(a,b)=>a?.length===b?.length&&a.every((value,i)=>Object.is(value,b[i]));
 const driver={
  state(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
  effect(callback,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};pending.push(()=>{slots[i].cleanup=callback();});}},
  callback(callback,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:callback};return slots[i].value;},
  request(url,init){return new Promise((resolve,reject)=>requests.push({url,signal:init.signal,resolve,reject}));}
 };
 globalThis.listHarness=driver;
 return {requests,render(next=currentArgs){currentArgs=next;cursor=0;return hook(...currentArgs);},commit(){while(pending.length)pending.shift()();},cleanup(){for(const slot of slots)slot?.cleanup?.();}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Insights SSR report is ready immediately without a duplicate initial request',()=>{
 const report={version:'p6a.v1',summary:[{currency:'IDR'}]},h=harness(useInsightsReport,[report,'period=current_month&currency=IDR','']);
 const state=h.render();assert.equal(state.loading,false);assert.equal(state.report,report);h.commit();assert.equal(h.requests.length,0);h.cleanup();
});
test('Insights filters hide stale data before effects, cancel obsolete responses and commit loading with report atomically',async()=>{
 const initial={summary:[{currency:'IDR'}]},h=harness(useInsightsReport,[initial,'period=current_month&currency=IDR','']);let state=h.render();h.commit();
 state.apply('period=previous_month&currency=USD');state=h.render();assert.equal(state.loading,true);assert.equal(state.report,undefined);h.commit();
 assert.match(h.requests[0].url,/currency=USD/);
 state.apply('period=custom&start=2026-10-01&end=2026-10-10&currency=IDR');state=h.render();assert.equal(state.report,undefined);h.commit();assert.equal(h.requests[0].signal.aborted,true);
 h.requests[0].resolve({old:true});const current={new:true};h.requests[1].resolve(current);await tick();state=h.render();assert.equal(state.loading,false);assert.equal(state.report,current);h.cleanup();
});
test('Insights failed refresh and retry never expose an old report under a new result',async()=>{
 const h=harness(useInsightsReport,[{old:true},'period=current_month&currency=IDR','']);let state=h.render();h.commit();state.retry();state=h.render();assert.equal(state.report,undefined);h.commit();h.requests[0].reject(Error('Sesi berakhir'));await tick();state=h.render();assert.equal(state.loading,false);assert.equal(state.report,undefined);assert.equal(state.error,'Sesi berakhir');
 state.retry();state=h.render();assert.equal(state.loading,true);assert.equal(state.error,'');h.commit();const empty={summary:[]};h.requests[1].resolve(empty);await tick();state=h.render();assert.equal(state.report,empty);assert.equal(state.loading,false);h.cleanup();
});
test('Insights initial server failure stays an error until explicitly retried',async()=>{
 const h=harness(useInsightsReport,[null,'period=current_month','Database unavailable']);let state=h.render();assert.equal(state.loading,false);assert.equal(state.report,undefined);assert.equal(state.error,'Database unavailable');h.commit();assert.equal(h.requests.length,0);
 state.retry();state=h.render();assert.equal(state.error,'');assert.equal(state.loading,true);h.commit();h.requests[0].resolve({ready:true});await tick();state=h.render();assert.equal(state.report.ready,true);h.cleanup();
});
test('Insights server refresh replaces initial SSR data without a blank frame or redundant API request',()=>{
 const first={version:1},second={version:2},h=harness(useInsightsReport,[first,'period=current_month','']);h.render();h.commit();
 const state=h.render([second,'period=current_month','']);assert.equal(state.report,second);assert.equal(state.loading,false);h.commit();assert.equal(h.requests.length,0);h.cleanup();
});
const findElements=(root,predicate)=>{
 const matches=[];function visit(node){if(!node||typeof node!=='object')return;if(predicate(node))matches.push(node);for(const child of [node.props?.children].flat(Infinity))visit(child);}visit(root);return matches;
};
test('Insights real controls apply currency/period to API and URL; browser-history event restores default without stale report',async()=>{
 const original=globalThis.window,handlers={},pushed=[];
 globalThis.window={location:{pathname:'/insights',search:''},history:{pushState(_a,_b,url){pushed.push(url);}},addEventListener(name,callback){handlers[name]=callback;},removeEventListener(name){delete handlers[name];}};
 const initial={period:{startDay:'2026-10-01',endDayExclusive:'2026-11-01'},summary:[{currency:'IDR'}],generatedAt:'2026-10-11T08:00:00Z',monthly:[{currency:'IDR',key:'2026-10',activityCount:'2'}]};
 const h=harness(InsightsWorkspace,[{initial,initialQuery:'period=current_month&currency=IDR',initialError:'',currencies:[{currency:'IDR',exponent:0},{currency:'USD',exponent:2}]}]);
 try{
  let tree=h.render();h.commit();findElements(tree,n=>n.props?.slideSelection)[0].props.slideSelection.select(2);tree=h.render();let selects=findElements(tree,n=>n.type==='select');selects[0].props.onChange({target:{value:'previous_month'}});selects[1].props.onChange({target:{value:'USD'}});
  tree=h.render();findElements(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});tree=h.render();assert.equal(findElements(tree,n=>n.props?.report).length,0);h.commit();assert.equal(pushed[0],'/insights?period=previous_month&currency=USD');assert.match(h.requests[0].url,/period=previous_month&currency=USD/);
  const previous={period:{startDay:'2026-09-01',endDayExclusive:'2026-10-01'},summary:[{currency:'USD'}],generatedAt:'2026-10-11T09:00:00Z',monthly:[{currency:'USD',key:'2026-09',activityCount:'0'}]};
  h.requests[0].resolve(previous);await tick();tree=h.render();assert.equal(findElements(tree,n=>n.props?.report)[0].props.currency,'USD');assert.equal(findElements(tree,n=>n.props?.report)[0].props.monthSelection.month,'2026-09');assert.equal(findElements(tree,n=>n.props?.report)[0].props.slideSelection.index,2);
  handlers.popstate();tree=h.render();assert.equal(findElements(tree,n=>n.props?.report).length,0);h.commit();assert.match(h.requests[1].url,/period=current_month&currency=IDR/);
  h.requests[1].resolve(initial);await tick();tree=h.render();assert.equal(findElements(tree,n=>n.props?.report)[0].props.monthSelection.month,'2026-10');
  window.location.search='?period=previous_month&currency=USD';handlers.popstate();h.render();h.commit();h.requests[2].resolve(previous);await tick();tree=h.render();assert.equal(findElements(tree,n=>n.props?.report)[0].props.monthSelection.month,'2026-09');
 }finally{h.cleanup();globalThis.window=original;}
});
test('Insights invalid date submission stays editable with an error and never issues a report request',()=>{
 const original=globalThis.window;globalThis.window={location:{pathname:'/insights'},history:{pushState(){throw Error('Invalid draft must not navigate');}},addEventListener(){},removeEventListener(){}};
 const h=harness(InsightsWorkspace,[{initial:{period:{startDay:'2026-10-01',endDayExclusive:'2026-11-01'},summary:[],generatedAt:'2026-10-11T08:00:00Z'},initialQuery:'period=current_month&currency=IDR',initialError:'',currencies:[{currency:'IDR',exponent:0}]}]);
 try{
  let tree=h.render();h.commit();findElements(tree,n=>n.type==='select')[0].props.onChange({target:{value:'custom'}});tree=h.render();const dates=findElements(tree,n=>n.type==='input'&&n.props.type==='date');dates[0].props.onChange({target:{value:'2026-10-20'}});dates[1].props.onChange({target:{value:'2026-10-01'}});
  tree=h.render();findElements(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});tree=h.render();assert.equal(findElements(tree,n=>n.props?.role==='alert').length,1);h.commit();assert.equal(h.requests.length,0);
 }finally{h.cleanup();globalThis.window=original;}
});
const page=(items,next=null,remaining=0)=>({items:items.map(key=>({key})),next,remaining});
const content=(state)=>renderToStaticMarkup(React.createElement(ListContent,{loading:state.loading,error:state.error,hasItems:state.items.length>0,onRetry:()=>{},empty:'Tidak ada hasil.'},React.createElement('table',null,React.createElement('tbody',null,React.createElement('tr',null,React.createElement('td',null,'Data'))))));

test('first history frame and in-flight request show loading without a false empty result; success commits rows and stops loading together',async()=>{
 const h=harness(useAutomationHistory,[true,'','','desc',false,{}]);
 let state=h.render();assert.equal(state.loading,true);assert.doesNotMatch(content(state),/Tidak ada hasil/);h.commit();
 h.requests[0].resolve(page(['newer','older']));await tick();state=h.render();assert.equal(state.loading,false);assert.deepEqual(state.items.map(i=>i.key),['newer','older']);assert.doesNotMatch(content(state),/Memuat/);h.cleanup();
});

test('only completed empty responses display empty text; failures retain an error and retry without claiming no results',async()=>{
 const h=harness(useAutomationHistory,[true,'','','desc',false,{}]);h.render();h.commit();h.requests[0].reject(new Error('Jaringan gagal'));await tick();let state=h.render();
 assert.equal(state.loading,false);assert.match(content(state),/Jaringan gagal/);assert.doesNotMatch(content(state),/Tidak ada hasil|Memuat/);
 state.retry();state=h.render();assert.equal(state.loading,true);assert.equal(state.error,'');h.commit();h.requests[1].resolve(page([]));await tick();state=h.render();assert.match(content(state),/Tidak ada hasil/);assert.doesNotMatch(content(state),/Memuat/);h.cleanup();
});

test('changed filter/direction immediately enters loading, aborts stale responses, and uses only the latest complete order',async()=>{
 const revision={};const h=harness(useAutomationHistory,[true,'','','desc',false,revision]);h.render();h.commit();
 let state=h.render([true,'time','','asc',false,revision]);assert.equal(state.loading,true);assert.equal(state.items.length,0);h.commit();assert.equal(h.requests[0].signal.aborted,true);
 h.requests[0].resolve(page(['obsolete']));h.requests[1].resolve(page(['older','newer']));await tick();state=h.render();assert.equal(state.loading,false);assert.deepEqual(state.items.map(i=>i.key),['older','newer']);h.cleanup();
});

test('progressive reveal keeps current rows, merges unique identities atomically and collapses back to the first page',async()=>{
 const revision={};const h=harness(useAutomationHistory,[true,'','','desc',true,revision]);h.render();h.commit();const boundary={at:'2026-10-08T00:00:00Z',key:'b'};
 h.requests[0].resolve(page(['a','b'],boundary,5));await tick();let state=h.render();state.showMore();state=h.render();assert.equal(state.loading,true);assert.deepEqual(state.items.map(i=>i.key),['a','b']);assert.doesNotMatch(content(state),/Memuat|Tidak ada hasil/);h.commit();
 assert.equal(new URL(h.requests[1].url,'http://local').searchParams.get('limit'),'5');h.requests[1].resolve(page(['b','c']));await tick();state=h.render();assert.equal(state.loading,false);assert.deepEqual(state.items.map(i=>i.key),['a','b','c']);assert.equal(state.canCollapse,true);
 state.collapse();h.render();h.commit();h.requests[2].resolve(page(['a','b'],boundary,5));await tick();state=h.render();assert.deepEqual(state.items.map(i=>i.key),['a','b']);assert.equal(state.canCollapse,false);h.cleanup();
});

test('server revision changes discard stale data before effects run and obsolete completion cannot dismiss the new loading state',async()=>{
 const revision={};const h=harness(useAutomationHistory,[true,'','','desc',false,revision]);h.render();h.commit();h.requests[0].resolve(page(['old']));await tick();h.render();
 let state=h.render([true,'','','desc',false,{}]);assert.equal(state.loading,true);assert.equal(state.items.length,0);h.commit();h.requests[1].resolve(page(['fresh']));await tick();state=h.render();assert.equal(state.loading,false);assert.equal(state.items[0].key,'fresh');h.cleanup();
});

test('transaction filter and pagination have the same atomic loading/empty contract while default server rows remain visible',async()=>{
 const initial=[{id:'current',occurredAt:'2026-10-09T00:00:00Z'}];const h=harness(useActivityPage,[initial,'all',false,'desc']);let state=h.render();assert.equal(state.items[0].id,'current');h.commit();state=h.render();assert.doesNotMatch(content(state),/Memuat/);
 state=h.render([initial,'expense',false,'asc']);assert.equal(state.loading,true);assert.equal(state.items.length,0);h.commit();h.requests[1].resolve({items:[{id:'expense'}],next:{at:'2026-10-09T00:00:00Z',id:'expense'}});await tick();state=h.render();assert.equal(state.loading,false);state.next();state=h.render();assert.equal(state.pageNumber,2);assert.equal(state.loading,true);assert.equal(state.items.length,0);h.commit();
 h.requests[2].resolve({items:[],next:null});await tick();state=h.render();assert.equal(state.loading,false);assert.match(content(state),/Tidak ada hasil/);assert.equal(state.hasNext,false);h.cleanup();
});

test('hiding the history tab aborts its request; returning resumes loading rather than fabricating an empty state',async()=>{
 const revision={};const h=harness(useAutomationHistory,[true,'','','desc',false,revision]);h.render();h.commit();h.render([false,'','','desc',false,revision]);h.commit();assert.equal(h.requests[0].signal.aborted,true);
 h.requests[0].resolve(page(['obsolete']));await tick();let state=h.render([true,'','','desc',false,revision]);assert.equal(state.loading,true);assert.equal(state.items.length,0);h.commit();h.requests[1].resolve(page(['active']));await tick();state=h.render();assert.equal(state.items[0].key,'active');assert.equal(state.loading,false);h.cleanup();
});

test('mobile viewport detection does not restart the initial request when the page size stays unchanged',async()=>{
 const revision={};const h=harness(useAutomationHistory,[true,'','','desc',false,revision]);h.render();h.commit();h.render([true,'','','desc',true,revision]);h.commit();assert.equal(h.requests.length,1);assert.equal(h.requests[0].signal.aborted,false);
 h.requests[0].resolve(page(['first']));await tick();assert.equal(h.render().loading,false);h.cleanup();
});

test('a failed additional page preserves rows and retry merges once without leaving a loading message',async()=>{
 const revision={};const h=harness(useAutomationHistory,[true,'','','desc',false,revision]);h.render();h.commit();h.requests[0].resolve(page(['a'],{at:'2026-10-09T00:00:00Z',key:'a'},10));await tick();let state=h.render();state.showMore();h.render();h.commit();h.requests[1].reject(new Error('Halaman berikutnya gagal'));await tick();state=h.render();assert.equal(state.loading,false);assert.equal(state.items[0].key,'a');assert.match(content(state),/Halaman berikutnya gagal/);assert.doesNotMatch(content(state),/Tidak ada hasil|Memuat/);
 state.retry();h.render();h.commit();h.requests[2].resolve(page(['a','b']));await tick();state=h.render();assert.equal(state.loading,false);assert.deepEqual(state.items.map(i=>i.key),['a','b']);assert.equal(state.error,'');h.cleanup();
});
