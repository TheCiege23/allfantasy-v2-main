import 'server-only'
import { isRosterChopped } from '@/lib/guillotine/guillotineGuard'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { getStarterSlotLabels } from '@/lib/league/rosterSlots'
import { findSportsPlayersForLeague } from '@/lib/player-identity/findSportsPlayerByLeagueId'
import { getPlayerGameLockStateForAutoCoach } from '@/lib/autocoach/playerGameLock'
import { nativeAutoSubsSlotHold,type NativeAutoSubsAssessment,type AutoSubsHoldReason } from './nativeAutoSubsAssessmentPolicy'
import type { NativeAutoSubsAssignment } from './nativeAutoSubsPolicy'
export async function assessNativeAutoSubs(league:{id:string;sport:string;platform:string;starters:unknown;settings:unknown;season:number|null;lockAllMoves:boolean|null},roster:{id:string;playerData:unknown},assignment:NativeAutoSubsAssignment|null):Promise<NativeAutoSubsAssessment>{
  const now=Date.now(),base:NativeAutoSubsAssessment={checkedAt:new Date(now).toISOString(),slots:[],state:'waiting',reason:null}
  const season=league.season
  if(season==null)return {...base,state:'paused',reason:'period_unavailable'}
  const settings=league.settings as Record<string,unknown>|null
  const held=(state:NativeAutoSubsAssessment['state'],reason:AutoSubsHoldReason):NativeAutoSubsAssessment=>({...base,state,reason})
  if(settings?.nativeAutoSubsEnabled!==true)return held('paused','commissioner_disabled')
  if(!assignment?.enabled)return held('off','owner_disabled')
  if(league.lockAllMoves)return held('paused','league_locked')
  if(await isRosterChopped(league.id,roster.id))return held('paused','roster_eliminated')
  const sections=getNormalizedLineupSections(roster.playerData),starters=sections.starters.map(p=>String(p.id))
  if(JSON.stringify(starters)!==JSON.stringify(assignment.starters))return held('paused','lineup_changed')
  const labels=getStarterSlotLabels(Array.isArray(league.starters)?league.starters as string[]:[])
  const players=await findSportsPlayersForLeague(league.sport,league.platform,[...starters,...Object.values(assignment.backups)])
  const slots:NativeAutoSubsAssessment['slots']=[]
  for(const [key,backup] of Object.entries(assignment.backups).slice(0,40)){
    const index=Number(key),out=players.get(starters[index]),into=players.get(backup)
    const input={out,into,onBench:sections.bench.some(p=>String(p.id)===backup),slotLabel:labels[index],now}
    let reason=nativeAutoSubsSlotHold(input),locks:Awaited<ReturnType<typeof getPlayerGameLockStateForAutoCoach>>[]=[]
    if(!reason&&out&&into){
      const args={sport:league.sport,leagueSeason:season,leagueSettings:league.settings}
      locks=await Promise.all([getPlayerGameLockStateForAutoCoach({...args,teamAbbr:out.team}),getPlayerGameLockStateForAutoCoach({...args,teamAbbr:into.team})])
      reason=nativeAutoSubsSlotHold({...input,locks,now:Date.now()})
    }
    slots.push({slot:index,slotLabel:labels[index]??key,starterName:out?.name??'?',backupName:into?.name??'?',reason,statusSource:out?.source??null,statusFetchedAt:out?.fetchedAt.toISOString()??null,starterGameAt:locks[0]?.nextKickoffUtc?.toISOString()??null,backupGameAt:locks[1]?.nextKickoffUtc?.toISOString()??null})
  }
  return {checkedAt:new Date().toISOString(),slots,state:slots.some(s=>!s.reason)?'ready':'waiting',reason:null}
}
