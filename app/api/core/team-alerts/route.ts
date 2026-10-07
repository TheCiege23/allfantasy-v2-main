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
  // Parallel durations overlap; total is elapsed work, not the sum of phases.
  const [alerts,delivery]=await Promise.all([
    timed('alerts',()=>readTeamAlerts(leagueId,userId)),
    timed('delivery',()=>readTeamDeliveryReceipts(leagueId,userId)),
  ])
  timings.push(`total;dur=${Math.max(0,performance.now()-started).toFixed(1)}`)
  // Fixed metric names and durations only, exposed after membership authorization.
  return NextResponse.json({...alerts,delivery},{headers:{'Cache-Control':'private, no-store','Server-Timing':timings.join(', ')}})
}
