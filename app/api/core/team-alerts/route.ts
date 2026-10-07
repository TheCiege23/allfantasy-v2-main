import {getServedOrigin} from '@/lib/http/served-origin'
import {ALERT_EVENTS,issueAlertMeasurement,verifyAlertMeasurement,recordAlertEvent,readAlertUsefulness,type AlertEvent} from '@/lib/core-app/teamAlertEngagement'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueMembership } from '@/lib/league-access'
import { readTeamAlerts } from '@/lib/core-app/teamAlertService'
import { readTeamDeliveryReceipts } from '@/lib/core-app/teamDeliveryReceipts'
export const dynamic='force-dynamic'
export async function GET(req:Request){
  const started=performance.now(),timings:string[]=[]
  async function timed<T>(name:'auth'|'access'|'alerts'|'delivery',read:()=>Promise<T>):Promise<T>{
    const start=performance.now()
    try{return await read()}finally{timings.push(`${name};dur=${Math.max(0,performance.now()-start).toFixed(1)}`)}
  }
  const session=await timed('auth',()=>getServerSession(authOptions as never)) as {user?:{id?:string}}|null,userId=session?.user?.id
  if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401})
  const leagueId=new URL(req.url).searchParams.get('league')??'',access=await timed('access',()=>resolveLeagueMembership(leagueId,userId))
  if(!access.ok)return NextResponse.json({error:'Forbidden'},{status:access.status})
  if(new URL(req.url).searchParams.get('metrics')==='1')return NextResponse.json(await readAlertUsefulness(userId,leagueId),{headers:{'Cache-Control':'private, no-store'}})
  // Parallel durations overlap; total is elapsed work, not the sum of phases.
  const [alerts,delivery]=await Promise.all([
    timed('alerts',()=>readTeamAlerts(leagueId,userId)),
    timed('delivery',()=>readTeamDeliveryReceipts(leagueId,userId)),
  ])
  timings.push(`total;dur=${Math.max(0,performance.now()-started).toFixed(1)}`)
  // Fixed metric names and durations only, exposed after membership authorization.
  return NextResponse.json({...alerts,alerts:alerts.alerts.map(alert=>({...alert,measurement:issueAlertMeasurement(userId,leagueId,alert.key,alert.kind)})),delivery},{headers:{'Cache-Control':'private, no-store','Server-Timing':timings.join(', ')}})
}

export async function POST(req:Request){
 const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null,userId=session?.user?.id
 if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401})
 const origin=req.headers.get('origin'),allowedOrigins=new Set([getServedOrigin(req)])
 for(const configured of [process.env.NEXTAUTH_URL,process.env.NEXT_PUBLIC_APP_URL]){if(configured){try{allowedOrigins.add(new URL(configured).origin)}catch{/* Ignore invalid server configuration. */}}}
 if(!origin||!allowedOrigins.has(origin)||req.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Forbidden'},{status:403})
 if(!req.headers.get('content-type')?.startsWith('application/json'))return NextResponse.json({error:'Invalid request'},{status:400})
 const text=await req.text();if(text.length>2048)return NextResponse.json({error:'Invalid request'},{status:400})
 let body;try{body=JSON.parse(text)}catch{return NextResponse.json({error:'Invalid request'},{status:400})}
 if(!body||typeof body.league!=='string'||body.league.length>128||!ALERT_EVENTS.includes(body.event))return NextResponse.json({error:'Invalid request'},{status:400})
 const access=await resolveLeagueMembership(body.league,userId)
 if(!access.ok)return NextResponse.json({error:'Forbidden'},{status:access.status})
 const measurement=verifyAlertMeasurement(userId,body.league,body.measurement)
 if(!measurement)return NextResponse.json({error:'Invalid measurement'},{status:400})
 await recordAlertEvent(userId,body.league,body.event as AlertEvent,measurement)
 return NextResponse.json({ok:true},{headers:{'Cache-Control':'private, no-store'}})
}
