import { NextRequest, NextResponse } from "next/server";
import { currentOwnerSession } from "@/lib/auth/session";
import { listActivities } from "@/lib/finance/service";
import { activityReadOrder, type ActivityReadOrder } from "@/lib/finance/activity-order";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
  if (!await currentOwnerSession()) return reply({error:"Sesi berakhir"},401);
  const params=request.nextUrl.searchParams;
  let options:ActivityReadOrder;
  try {
    const cursor=params.get("after");
    options={direction:(params.get("direction")??"desc") as ActivityReadOrder["direction"],kind:(params.get("kind")||undefined) as ActivityReadOrder["kind"],after:cursor?JSON.parse(cursor):undefined};
    if (cursor && cursor.length>200) throw new Error("Boundary too long");
    activityReadOrder(options);
  } catch { return reply({error:"Urutan transaksi tidak valid"},400); }
  try {
    const rows=await listActivities(params.get("history")==="true",51,options);
    const items=rows.slice(0,50),last=items.at(-1);
    return reply({items,next:rows.length>50&&last?{at:last.cursorTime??last.occurredAt,id:last.id}:null});
  } catch {return reply({error:"Riwayat belum dapat dimuat"},500);}
}
