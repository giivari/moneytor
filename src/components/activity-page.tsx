"use client";

import { useCallback, useState } from "react";
import type { FinanceActivity } from "@/lib/finance/types";
import type { SortDirection } from "@/lib/list-order";
import { requestJson } from "@/lib/finance/client";
import { useListRequest } from './use-list-request';

type Boundary={at:string;id:string};
type Page={items:FinanceActivity[];next:Boundary|null};
/** Query keys isolate direction/filter changes; obsolete responses never replace the current page. */
export function useActivityPage(initial:FinanceActivity[],kind:string,history:boolean,direction:SortDirection) {
  const queryKey=JSON.stringify([kind,history,direction]);
  const [navigation,setNavigation]=useState<{key:string;trail:(Boundary|null)[]}>({key:queryKey,trail:[null]});
  const trail=navigation.key===queryKey?navigation.trail:[null];
  const [retry,setRetry]=useState(0);
  const after=trail.at(-1)??null;
  const requestKey=queryKey+JSON.stringify(after);
  const load=useCallback((signal:AbortSignal)=>{
    const params=new URLSearchParams({kind:kind==="all"?"":kind,history:String(history),direction});
    if(after)params.set("after",JSON.stringify(after));
    return requestJson<Page>("/api/finance/activities?"+params,{cache:"no-store",signal});
  },[kind,history,direction,after]);
  const initialKey=JSON.stringify(["all",false,"desc"])+"null";
  const {data:page,loading,error}=useListRequest<Page>({scope:requestKey,requestKey:JSON.stringify([requestKey,retry]),revision:initial,load,
    initial:{scope:initialKey,requestKey:JSON.stringify([initialKey,0]),value:{items:initial.slice(0,50),next:initial.length>50?{at:initial[49].cursorTime??initial[49].occurredAt,id:initial[49].id}:null}}});
  return {items:page?.items??[],loading,error,pageNumber:trail.length,
    next:()=>{if(page?.next&&!loading)setNavigation({key:queryKey,trail:[...trail,page.next]});},hasNext:!!page?.next,
    previous:()=>{if(!loading&&trail.length>1)setNavigation({key:queryKey,trail:trail.slice(0,-1)});},retry:()=>setRetry(value=>value+1) };
}
