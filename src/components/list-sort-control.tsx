"use client";

import { useId } from "react";
import { temporalSortOptions, isSortDirection, type SortDirection, type TemporalListMode } from "@/lib/list-order";

export function ListSortControl({ direction, setDirection, mode = "history", label = "Urutan" }: {
  direction: SortDirection; setDirection: (value: SortDirection) => void; mode?: TemporalListMode; label?: string;
}) {
  return <ListOrderControl value={direction} setValue={value=>{if(isSortDirection(value))setDirection(value);}} options={temporalSortOptions[mode]} label={label} />;
}
export function ListOrderControl({value,setValue,options,label="Urutan",className=""}:{value:string;setValue:(value:string)=>void;options:readonly {value:string;label:string}[];label?:string;className?:string}) {
  const id=useId();
  return <label className={`list-sort-control ${className}`} htmlFor={id}><span className={label === "Urutan" ? "sr-only" : undefined}>{label}</span><select id={id} value={value} onChange={event=>{if(options.some(option=>option.value===event.target.value))setValue(event.target.value);}}>
    {options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}
