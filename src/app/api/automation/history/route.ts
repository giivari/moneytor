import { NextRequest, NextResponse } from "next/server";
import { currentOwnerSession } from "@/lib/auth/session";
import { readAutomationHistoryPage, type HistoryBoundary } from "@/lib/automation/history-page";
import { isSortDirection } from "@/lib/list-order";

export const dynamic="force-dynamic";
export async function GET(request:NextRequest) {
  const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store"}});
  if(!await currentOwnerSession())return reply({error:"Sesi berakhir"},401);
  const params=request.nextUrl.searchParams,direction=params.get("direction")??"desc";
  let after:HistoryBoundary|undefined;
  try{const raw=params.get("after");if(raw&&raw.length>220)throw new Error();after=raw?JSON.parse(raw):undefined;if(!isSortDirection(direction))throw new Error();}
  catch{return reply({error:"Urutan riwayat tidak valid"},400);}
  try{return reply(await readAutomationHistoryPage({direction,limit:Number(params.get("limit")??10),source:params.get("source")??"",category:params.get("category")??"",after}));}
  catch{return reply({error:"Riwayat otomatisasi belum dapat dimuat"},400);}
}
