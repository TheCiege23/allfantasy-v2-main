import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueMembership } from '@/lib/league-access'
import { readTeamAlerts } from '@/lib/core-app/teamAlertService'
export const dynamic='force-dynamic'
export async function GET(req:Request){
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null,userId=session?.user?.id
  if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401})
  const leagueId=new URL(req.url).searchParams.get('league')??'',access=await resolveLeagueMembership(leagueId,userId)
  if(!access.ok)return NextResponse.json({error:'Forbidden'},{status:access.status})
  return NextResponse.json(await readTeamAlerts(leagueId,userId),{headers:{'Cache-Control':'private, no-store'}})
}
