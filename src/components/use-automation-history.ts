"use client";

import { useCallback, useState } from "react";
import type { WorkspaceInstance } from "@/lib/automation/composable-facade";
import type { SortDirection } from "@/lib/list-order";
import { requestJson } from "@/lib/finance/client";
import { useListRequest } from './use-list-request';
type Boundary={at:string;key:string};
type Page={items:WorkspaceInstance[];next:Boundary|null;remaining:number};
export function useAutomationHistory(enabled:boolean,source:string,category:string,direction:SortDirection,compact:boolean,revision:unknown) {
  const key=JSON.stringify([source,category,direction]);
  const [navigation,setNavigation]=useState<{key:string;after:Boundary|null;expanded:boolean;generation:number;revision:unknown}>({key,after:null,expanded:false,generation:0,revision});
  const after=navigation.key===key&&navigation.revision===revision?navigation.after:null;
  const expanded=navigation.key===key&&navigation.revision===revision&&navigation.expanded;
  const limit=after&&compact?5:10;
  const requestKey=JSON.stringify([key,after,limit,navigation.generation]);
  const load=useCallback((signal:AbortSignal)=>{
    const params=new URLSearchParams({source,category,direction,limit:String(limit)});
    if(after)params.set("after",JSON.stringify(after));
    return requestJson<Page>("/api/automation/history?"+params,{cache:"no-store",signal});
  },[source,category,direction,after,limit]);
  const merge=useCallback((page:Page,previous:Page|undefined)=>({...page,items:after&&previous?[...previous.items,...page.items.filter(item=>!previous.items.some(old=>old.key===item.key))]:page.items}),[after]);
  const {data,loading,error}=useListRequest({enabled,scope:key,requestKey,revision,load,merge});
  return {items:data?.items??[],loading,error,canShowMore:!!data?.next,canCollapse:expanded,
    hiddenCount:data?.remaining??0,nextBatchCount:Math.min(data?.remaining??0,compact?5:10),
    showMore:()=>{if(data?.next&&!loading)setNavigation({key,after:data.next,expanded:true,generation:navigation.generation,revision});},
    collapse:()=>setNavigation({key,after:null,expanded:false,generation:navigation.generation+1,revision}),
    retry:()=>setNavigation({key,after,expanded,generation:navigation.generation+1,revision})};
}
