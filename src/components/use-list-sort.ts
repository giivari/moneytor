"use client";

import { useCallback, useSyncExternalStore } from "react";
import { defaultSortDirection, isSortDirection, type SortDirection, type TemporalListMode } from "@/lib/list-order";

const listeners = new Set<() => void>();
const memory = new Map<string, string>();
function subscribe(notify: () => void) {
  listeners.add(notify);
  const changed = () => { memory.clear(); notify(); };
  window.addEventListener("storage", changed);
  return () => { listeners.delete(notify); window.removeEventListener("storage", changed); };
}
/** Independent, non-sensitive UI preferences; safe SSR default and storage-denied fallback. */
export function useListPreference(list:string, allowed:readonly string[], fallback:string) {
  const key = "moneytor:list-order:v1:" + list;
  const allowedKey=allowed.join("|");
  const read = useCallback(() => {
    const choices=allowedKey.split("|");
    const cached=memory.get(key);if(cached && choices.includes(cached))return cached;
    try { const value=window.localStorage.getItem(key);if(value && choices.includes(value))return value; } catch { /* storage may be unavailable */ }
    return fallback;
  },[key,fallback,allowedKey]);
  const server=useCallback(()=>fallback,[fallback]);
  const value=useSyncExternalStore(subscribe,read,server);
  const setValue=useCallback((next:string)=>{
    if(!allowedKey.split("|").includes(next))return;
    memory.set(key,next);try{window.localStorage.setItem(key,next);}catch{ /* retain this visit */ }
    listeners.forEach(notify=>notify());
  },[key,allowedKey]);
  return {value,setValue};
}
export function useListSort(list: string, mode: TemporalListMode = "history") {
  const {value,setValue}=useListPreference(list,["asc","desc"],defaultSortDirection(mode));
  return {direction:value as SortDirection,setDirection:useCallback((next:SortDirection)=>{if(isSortDirection(next))setValue(next);},[setValue])};
}
