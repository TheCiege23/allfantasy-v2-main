import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { isEligibleForSlot } from '@/lib/core-app/rosterSlots'
import { getMyTeamData } from '@/lib/core-app/myTeam'
import { readTeamPreference,saveTeamPreference } from '@/lib/core-app/teamPreferenceStore'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'
import { nativeAutoSubsKey,type NativeAutoSubsAssignment } from '@/lib/core-app/nativeAutoSubsPolicy'
import { assessNativeAutoSubs } from '@/lib/core-app/nativeAutoSubsAssessment'
import { publicDeliveryReceipt } from '@/lib/core-app/teamDeliveryReceipts'
export const dynamic='force-dynamic'
async function handle(req:Request){
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null,userId=session?.user?.id
  if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401})
  const leagueId=new URL(req.url).searchParams.get('league')??''
  const roster=await prisma.roster.findFirst({where:{leagueId,platformUserId:userId}})
  if(!roster)return NextResponse.json({error:'Roster owner only'},{status:403})
  const league=await prisma.league.findUnique({where:{id:leagueId}})
  if(!league || resolveWriteAuthority(league.platform)!=='NATIVE')return NextResponse.json({error:'Native leagues only'},{status:409})
  const data=await getMyTeamData(leagueId,userId),native=data?.nativeLineup
  if(!data?.workspaceScope || !native || native.rosterId!==roster.id || !native.week || leagueWeekFromSettings(league.settings)!==native.week || data.bestBall || data.preDraft || data.completed || data.eliminated || data.league.lineupMode==='automatic')return NextResponse.json({error:'Active manual native lineup required'},{status:409})
  const settings=league.settings as Record<string,unknown>|null,enabled=settings?.nativeAutoSubsEnabled===true
  const key=nativeAutoSubsKey(leagueId,roster.id,data.workspaceScope.season,native.week)
  const assignment=await readTeamPreference<NativeAutoSubsAssignment>(userId,key)
  if(req.method==='GET'){
    const audit=await prisma.automationAuditLog.findMany({where:{leagueId,userId,entityId:roster.id,action:'native_autosub.applied'},orderBy:{createdAt:'desc'},take:5,select:{id:true,message:true,createdAt:true,metadata:true}})
    const assessment=await assessNativeAutoSubs(league,roster,assignment)
    return NextResponse.json({commissionerEnabled:enabled,assignment,assessment,audit:audit.map(a=>({...a,metadata:undefined,delivery:publicDeliveryReceipt((a.metadata as Record<string,unknown>|null)?.deliveryReceipt)})),week:native.week},{headers:{'Cache-Control':'private, no-store'}})
  }
  let body:Record<string,unknown>
  try{body=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
  if(typeof body.enabled!=='boolean' || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion)<0 || !body.backups || typeof body.backups!=='object' || Array.isArray(body.backups))return NextResponse.json({error:'Invalid backup settings'},{status:400})
  if(body.enabled && !enabled)return NextResponse.json({error:'Commissioner has not enabled native AutoSubs'},{status:403})
  const backups:Record<string,string>={}
  for(const [slot,raw] of Object.entries(body.backups)){
    if(!raw)continue
    const index=Number(slot),starter=data.starters.available?data.starters.data[index]:null
    const bench=data.bench.available?data.bench.data.find(p=>p.sleeperId===raw):null
    if(!/^\d{1,2}$/.test(slot)||!starter?.player||!bench||!native.benchIds[bench.sleeperId]||!isEligibleForSlot(starter.slotLabel,bench.position))return NextResponse.json({error:'Refresh and choose an eligible bench backup.'},{status:400})
    backups[slot]=native.benchIds[bench.sleeperId]
  }
  if(new Set(Object.values(backups)).size!==Object.values(backups).length || (body.enabled && !Object.keys(backups).length))return NextResponse.json({error:'Choose distinct backups for the selected slots.'},{status:400})
  if(!await saveTeamPreference(userId,key,Number(body.expectedVersion),{enabled:body.enabled,backups,starters:native.starterIds}))return NextResponse.json({error:'Your backup settings changed. Reload before saving.'},{status:409})
  const saved=await readTeamPreference<NativeAutoSubsAssignment>(userId,key)
  return NextResponse.json({assignment:saved,commissionerEnabled:enabled,assessment:await assessNativeAutoSubs(league,roster,saved).catch(()=>undefined)},{headers:{'Cache-Control':'private, no-store'}})
}
export const GET=handle,PUT=handle
