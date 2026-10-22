"use client";

import { useEffect, useState } from "react";

type Snapshot<T> = { scope:string; requestKey:string; revision:unknown; value:T|undefined; status:'idle'|'loading'|'ready'|'error'; error:string };
type Options<T> = {
  enabled?:boolean; scope:string; requestKey:string; revision:unknown;
  load:(signal:AbortSignal)=>Promise<T>; merge?:(value:T,previous:T|undefined)=>T;
  initial?:{scope:string;requestKey:string;value:T};
};

/** Data and its request outcome commit together; obsolete responses cannot change the active list. */
export function useListRequest<T>({enabled=true,scope,requestKey,revision,load,merge,initial}:Options<T>) {
  const [snapshot,setSnapshot]=useState<Snapshot<T>>(()=>({scope:initial?.scope??'',requestKey:initial?.requestKey??'',
    revision,value:initial?.value,status:initial?'ready':'idle',error:''}));
  useEffect(()=>{
    if(!enabled)return;
    let active=true;const controller=new AbortController();
    const previous=(current:Snapshot<T>)=>current.scope===scope&&current.revision===revision?current.value:undefined;
    setSnapshot(current=>({scope,requestKey,revision,value:previous(current),status:'loading',error:''}));
    void load(controller.signal).then(value=>{
      if(active)setSnapshot(current=>({scope,requestKey,revision,value:merge?merge(value,previous(current)):value,status:'ready',error:''}));
    }).catch(cause=>{
      if(active)setSnapshot(current=>({scope,requestKey,revision,value:previous(current),status:'error',error:cause instanceof Error?cause.message:'Daftar belum dapat dimuat.'}));
    });
    return()=>{active=false;controller.abort();};
  },[enabled,scope,requestKey,revision,load,merge]);
  const compatible=snapshot.scope===scope&&snapshot.revision===revision;
  const current=compatible&&snapshot.requestKey===requestKey;
  return {data:compatible?snapshot.value:undefined,loading:enabled&&(!current||snapshot.status==='idle'||snapshot.status==='loading'),error:current?snapshot.error:''};
}
