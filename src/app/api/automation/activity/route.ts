import { NextRequest, NextResponse } from 'next/server';
import { currentOwnerSession } from '@/lib/auth/session';
import { readAutomationActivityDetail } from '@/lib/automation/review-service';
import type { Storage } from '@/lib/automation/composable-facade';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
  if(!await currentOwnerSession())return reply({error:'Sesi berakhir.'},401);
  try{return reply(await readAutomationActivityDetail(request.nextUrl.searchParams.get('storage') as Storage,request.nextUrl.searchParams.get('id')??''));}
  catch{return reply({error:'Rincian aktivitas belum dapat dimuat.'},400);}
}
