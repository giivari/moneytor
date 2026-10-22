import "server-only";
import { database } from "@/lib/db/pool";
import { requireOwnerSession } from "@/lib/auth/session";
import { readAutomation } from "./service";
import { readIncomeEvents } from "./income-events";
import { readGeneralAutomation } from "./composable-service";
import { unifyAutomation } from "./composable-facade";
import { isSortDirection, type SortDirection } from "../list-order";
import { automationReviewReady } from "./review-service";
import { automationReviewQuery } from "./review-query";

export type HistoryBoundary={at:string;key:string};
/** Display-only union: filter/order the complete logical history before the keyset window. */
export async function readAutomationHistoryPage(input:{direction:SortDirection;limit:number;source:string;category:string;after?:HistoryBoundary}) {
  await requireOwnerSession();
  if(!isSortDirection(input.direction)||![5,10].includes(input.limit)||!["","time","transaction_posted"].includes(input.source)
    ||(input.category&&!/^[0-9a-f-]{36}$/i.test(input.category))
    ||(input.after&&(!Number.isFinite(Date.parse(input.after.at))||input.after.at.length>40||!/^(schedule|income_event|general):[0-9a-f-]{36}$/i.test(input.after.key))))throw new Error("Invalid history page");
  const connection=database();
  const projection=automationReviewQuery(await automationReviewReady(connection));
  if(!projection)return {items:[],next:null,remaining:0};
  const direction=input.direction==="asc"?"ASC":"DESC",operator=input.direction==="asc"?">":"<";
  const rows=(await connection.query<{key:string;id:string;cursor_time:string;remaining:string}>(`WITH records AS (${projection})
    SELECT *,event_at::text AS cursor_time,COUNT(*) OVER()::text AS remaining FROM records
    WHERE tab='history' AND ($1::text='' OR trigger_source=$1) AND ($2::uuid IS NULL OR category_id=$2)
      AND ($3::timestamptz IS NULL OR (event_at,key) ${operator} ($3::timestamptz,$4::text))
    ORDER BY event_at ${direction},key ${direction} LIMIT $5`,[input.source,input.category||null,input.after?.at??null,input.after?.key??null,input.limit])).rows;
  const ids=rows.map(row=>row.id);
  if(!ids.length)return {items:[],next:null,remaining:0};
  const [schedule,income,general]=await Promise.all([readAutomation(ids),readIncomeEvents(ids),readGeneralAutomation(ids)]);
  const indexed=new Map(unifyAutomation(schedule,income,general).instances.map(item=>[item.key,item]));
  const items=rows.map(row=>indexed.get(row.key)).filter(item=>item!==undefined);
  const remaining=Math.max(0,Number(rows[0].remaining)-rows.length),last=rows.at(-1)!;
  return {items,next:remaining?{at:last.cursor_time,key:last.key}:null,remaining};
}
