import type { PrismaClient } from '@prisma/client'
import { createInjuryRowMatcher, injuryClaimAsOf } from '@/lib/injuries/matchInjuryRows'
import { injuryStaleAfterHours } from '@/lib/injuries/injuryRecency'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { buildWeekKickoffMap, easternDayKey, lockTeamLookupKeys, readLineupLockSettings } from '@/lib/redraft/lineupLock'
import { resolveCurrentLockTeams } from '@/lib/redraft/lineupLockCurrentTeam'
import { allowedPositionsForSlot, cannotStart, normalizeToken } from '@/lib/redraft/lineupValidation'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { previewRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { evaluatePirateLineup } from './lineupLegality'
import { piratePlanPlayerData } from './lineupPlans'

export type PiratePreLockAdvice = {
  week: number
  scoringDay: string | null
  deadlineAt: string
  issues: string[]
  moves: { playerName: string; slot: string }[]
}

/** Advisory only. Uses live DB data and a read-only save preview; never writes lock evidence or moves players. */
export async function readPiratePreLockAdvice(input: {
  leagueId: string; rosterId: string; ownerId: string; season: number; week: number; now?: Date
  leadWindowMs?: { min: number; max: number }
}, db: PrismaClient): Promise<PiratePreLockAdvice | null> {
  const now = input.now ?? new Date()
  const league = await db.league.findUnique({where:{id:input.leagueId},select:{
    id:true,sport:true,platform:true,leagueVariant:true,settings:true,lockAllMoves:true,
  }})
  if (!league || league.lockAllMoves) return null
  const sport = String(league.sport)
  const lock = readLineupLockSettings(league.settings, sport)
  if (lock.mode === 'manual' || lock.manualLockedWeeks.has(input.week) || lock.overrides.length) return null
  const schedule = await buildWeekKickoffMap(db, {sport,season:input.season,week:input.week})
  const scoringDay = lock.mode === 'daily' ? easternDayKey(now) : null
  const dayStarts = scoringDay ? [...schedule.byTeamDay?.values() ?? []].flatMap(days => days.get(scoringDay) ?? []) : []
  const deadline = scoringDay ? (dayStarts.length ? new Date(Math.min(...dayStarts.map(d => d.getTime()))) : null) : schedule.firstKickoff
  // Daily mode reports its normal behavior in warnings as an informational notice.
  const lockWarning = lock.warnings.some(warning =>
    !(lock.mode === 'daily' && warning.startsWith('Daily lineup lock is active:')))
  if (!deadline || deadline <= now || schedule.warnings.length || lockWarning) return null
  const lead = deadline.getTime() - now.getTime()
  if (input.leadWindowMs && (lead <= input.leadWindowMs.min || lead > input.leadWindowMs.max)) return null
  const roster = await db.redraftRoster.findFirst({where:{id:input.rosterId,leagueId:input.leagueId,ownerId:input.ownerId},select:{
    legacyRoster:{select:{id:true,playerData:true}},
    players:{where:{droppedAt:null},select:{playerId:true,playerName:true,position:true,slotType:true,team:true,byeWeek:true,injuryStatus:true}},
  }})
  if (!roster?.players.length) return null
  const config = resolveRedraftRosterConfig(sport, league.settings)
  const [injuries, sync, teams, daily] = await Promise.all([
    db.sportsInjury.findMany({where:{sport,expiresAt:{gt:now},OR:[{season:input.season},{season:null}]},take:5000,
      orderBy:{fetchedAt:'desc'},select:{playerId:true,playerName:true,team:true,position:true,sport:true,status:true,date:true,fetchedAt:true,source:true}}),
    db.providerSyncState.findFirst({where:{provider:'injuries-cron',entityType:'injuries',sport,key:'lineup-evidence-v2'},
      select:{lastSuccessAt:true,lastErrorAt:true,recordsSkipped:true}}),
    resolveCurrentLockTeams(db,{sport,platform:league.platform,playerIds:roster.players.map(p=>p.playerId)}),
    scoringDay ? db.redraftDailyLineup.findMany({where:{leagueId:input.leagueId,rosterId:input.rosterId,season:input.season,
      week:input.week,scoringDay:new Date(`${scoringDay}T00:00:00Z`)},select:{playerId:true,slotType:true}}) : null,
  ])
  const dailySlots = new Map(daily?.map(p=>[p.playerId,p.slotType]))
  if (scoringDay && roster.players.some(p=>!dailySlots.has(p.playerId))) return null
  const fresh = Boolean(sync?.lastSuccessAt && sync.lastSuccessAt <= now && now.getTime()-sync.lastSuccessAt.getTime()<=30*60000 &&
    (!sync.lastErrorAt || sync.lastErrorAt<=sync.lastSuccessAt) && !sync.recordsSkipped && injuries.length<5000)
  const match = createInjuryRowMatcher(injuries,sport)
  const names = new Set(injuries.map(r=>normalizeMatchName(r.playerName)))
  const players = roster.players.map(p=>{
    const team=teams.has(p.playerId)?teams.get(p.playerId):p.team
    const keys=lockTeamLookupKeys(sport,team)
    const kickoff=keys.map(k=>scoringDay?schedule.byTeamDay?.get(k)?.get(scoringDay):schedule.byTeam.get(k)).find(Boolean)
    const hit=match({name:p.playerName,team,position:p.position})
    const rows=hit && 'rows' in hit?hit.rows:[]
    const known=fresh && !(hit && 'ambiguous' in hit) && (Boolean(hit)||!names.has(normalizeMatchName(p.playerName))) &&
      rows.every(r=>r.status && !['UNKNOWN','NA','N/A','UNREVEALED'].includes(r.status.trim().toUpperCase()) &&
        injuryClaimAsOf(r)<=now && now.getTime()-injuryClaimAsOf(r).getTime()<=injuryStaleAfterHours(sport)*3600000) &&
      new Set(rows.map(r=>cannotStart({injuryStatus:r.status}))).size<=1
    const slotType=dailySlots.get(p.playerId)??p.slotType
    const gameKnown=Boolean(kickoff && (sport!=='NFL'||teams.has(p.playerId)||normalizeToken(p.position)==='DEF'))
    const eligible=known && gameKnown && !cannotStart(p) && (!rows.length || !cannotStart({injuryStatus:rows[0].status}))
    return {...p,slotType,injuryStatus:known ? rows[0]?.status ?? null : null,
      hasGameOnScoringDay:scoringDay && keys.some(k=>schedule.byTeam.has(k))?Boolean(kickoff):undefined,
      verifiedAvailable:eligible,addableBeforeLock:normalizeToken(slotType)==='BENCH' && eligible && !!kickoff && kickoff>now}
  })
  // Reuse the matching algorithm for today's roster; never expose its historical ruling.
  const evaluated = evaluatePirateLineup({sport,week:input.week,rosterConfig:config,roster:players,waivers:[],
    lineupAtLockCertified:true,availabilityAtLockCertified:true,waiverPoolCertified:false})
  if (!evaluated.issues.length) return null
  const advice: PiratePreLockAdvice={week:input.week,scoringDay,deadlineAt:deadline.toISOString(),issues:evaluated.issues,moves:[]}
  // A different saved daily lineup cannot be certified against the current roster editor.
  if (!evaluated.assignment || !roster.legacyRoster || (daily && roster.players.some(p=>normalizeToken(p.slotType)!==normalizeToken(dailySlots.get(p.playerId))))) return advice
  const byId=new Map(players.map(p=>[p.playerId,p]))
  if (!evaluated.assignment.every(seat=>byId.get(seat.playerId)?.verifiedAvailable)) return advice
  try {
    const template=await getRosterTemplateForLeague(league.sport,getFormatTypeForVariant(league.sport,league.leagueVariant),input.leagueId)
    const tokens=resolveLineupStarterSlots(league,template).map(slot=>{
      const token=normalizeToken(slot.label)
      return config.starterCapacities.has(token)?token:normalizeToken(slot.label.replace(/\d+$/,''))
    })
    if(tokens.length!==evaluated.assignment.length) return advice
    const next=piratePlanPlayerData(roster.legacyRoster.playerData,players,{eventAt:deadline.toISOString(),checkedAt:now.toISOString(),
      steps:[],assignment:evaluated.assignment},tokens)
    if (!next || !(await previewRosterLineupWithEngine({leagueId:input.leagueId,rosterId:roster.legacyRoster.id,
      actorUserId:input.ownerId,season:input.season,week:input.week,nextPlayerData:next})).ok || deadline <= new Date()) return advice
  } catch {
    return advice
  }
  advice.moves=evaluated.assignment.flatMap(seat=>{
    const player=byId.get(seat.playerId)!
    return normalizeToken(player.slotType)!==seat.slotType && allowedPositionsForSlot(sport,seat.slotType).includes(normalizeToken(player.position))
      ? [{playerName:player.playerName,slot:seat.slotType}]:[]
  })
  return advice
}
