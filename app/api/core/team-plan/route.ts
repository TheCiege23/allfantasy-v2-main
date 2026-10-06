import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueMembership } from '@/lib/league-access'
import { getMyTeamData } from '@/lib/core-app/myTeam'
import { isEligibleForSlot } from '@/lib/core-app/rosterSlots'
import { parseWeekPlan, planScopeKey, type WeekPlan } from '@/lib/core-app/teamPlan'
import { readTeamPreference, saveTeamPreference } from '@/lib/core-app/teamPreferenceStore'
export const dynamic='force-dynamic'
async function handle(req:Request) {
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null
  const userId=session?.user?.id
  if(!userId) return NextResponse.json({error:'Unauthorized'},{status:401})
  const url=new URL(req.url),leagueId=url.searchParams.get('league') ?? '',week=Number(url.searchParams.get('week'))
  if(!leagueId || !Number.isInteger(week) || week<1 || week>30) return NextResponse.json({error:'Invalid league or week'},{status:400})
  const access=await resolveLeagueMembership(leagueId,userId)
  if(!access.ok) return NextResponse.json({error:'Forbidden'},{status:access.status})
  const data=await getMyTeamData(leagueId,userId,null,{savedRosterOnly:true})
  if(!data?.workspaceScope) return NextResponse.json({error:'Your roster and season could not be verified.'},{status:409})
  const {rosterKey,season}=data.workspaceScope,key=planScopeKey(leagueId,rosterKey,season,week)
  const current=await readTeamPreference<WeekPlan>(userId,key)
  if(req.method==='GET') return NextResponse.json({plan:current,scope:{leagueId,rosterKey,season,week}},{headers:{'Cache-Control':'private, no-store'}})
  let body:Record<string,unknown>
  try {body=await req.json()} catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
  if(!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion)<0) return NextResponse.json({error:'Expected version required'},{status:400})
  let value:{slots:Record<string,string>;note:string;deleted:boolean}
  try {
    const parsed=req.method==='DELETE' ? {slots:{},note:''} : parseWeekPlan(body)
    const players=[...(data.starters.available ? data.starters.data.flatMap(s=>s.player?[s.player]:[]) : []),...(data.bench.available?data.bench.data:[])]
    for(const [slot,id] of Object.entries(parsed.slots)) {
      if(!id) continue
      const s=data.starters.available ? data.starters.data[Number(slot)] : null,p=players.find(p=>p.sleeperId===id)
      if(!s || !p || !isEligibleForSlot(s.slotLabel,p.position)) throw new Error('Refresh the roster and check slot eligibility.')
    }
    value={...parsed,deleted:req.method==='DELETE'}
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid plan'},{status:400})}
  const saved=await saveTeamPreference(userId,key,Number(body.expectedVersion),value)
  if(!saved) return NextResponse.json({error:'This plan changed on another device. Reload the saved version before saving.',plan:await readTeamPreference(userId,key)},{status:409})
  return NextResponse.json({plan:await readTeamPreference(userId,key),tentative:true,lineupSubmitted:false})
}
export const GET=handle,PUT=handle,DELETE=handle
