import { prisma } from '@/lib/prisma'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { readRiScheduleWindow, type ScheduleGame } from '@/lib/sports-data/riScheduleCache'
import { readWeekGames } from '@/lib/redraft/weekGames'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { normalizeLockTeam } from '@/lib/redraft/lineupLock'
import { dailySlotFor, loadDailyLineups } from '@/lib/redraft/dailyLineups'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { accumulateTeamTotals } from '@/lib/category-scoring'
import { buildLeagueStatScorer, isScoringStarterSlot } from '@/lib/redraft/scoringEngine'
import { object, periodDays, type CutoverPeriod } from './cutoverPolicy'

export type DatedPlayerLine = { day:string; game:string; player:string; roster:string; slot:string; points:number; stats:Record<string,number> }
async function cutoverGames(sport:string,season:number,period:CutoverPeriod):Promise<ScheduleGame[]> {
  const window=periodDays(period)
  const cached=await readRiScheduleWindow(prisma as never,{sport,season,window})
  if(cached?.length)return cached
  const rows=await readWeekGames(prisma,{sport,season,week:period.number,seasonType:'regular',dateWindow:window})
  return rows.flatMap(g=>g.startTime && g.homeTeam && g.awayTeam ? [{gameId:JSON.stringify([g.homeTeam,g.awayTeam,g.startTime]),day:easternCalendarDay(g.startTime)!.toISOString().slice(0,10),
    startTime:g.startTime.toISOString(),status:g.status,seasonType:'regular' as const,eventName:null,replacedBy:null,homeTeam:g.homeTeam,awayTeam:g.awayTeam}] : [])
}

/** Score league-specific intervals by the game's actual start. A shared sport-week cache cannot
 * identify the right Monday games when Fantrax starts a period at 7 PM. */
export async function readDatedCutoverRoster(args: {
  leagueId:string; rosterId:string; sport:string; settings:unknown; season:number; period:CutoverPeriod; now?:Date
  sourceSlots?: Map<string,string>
}) {
  const { sport,period } = args
  const normalizer = getDailySportNormalizer(sport)
  const scorer = buildLeagueStatScorer({ sport, settings:object(args.settings) } as Parameters<typeof buildLeagueStatScorer>[0])
  if (!normalizer || !scorer) throw Error('Native scoring rules are unavailable for this sport.')
  const window = periodDays(period), start = Date.parse(period.startDate), end = Date.parse(period.endDate), now = (args.now ?? new Date()).getTime()
  const [schedule, players, lineups, weekly,clubs] = await Promise.all([
    cutoverGames(sport,args.season,period),
    prisma.redraftRosterPlayer.findMany({ where:{rosterId:args.rosterId,OR:[{droppedAt:null},{droppedAt:{gte:new Date(start)}}]} }),
    loadDailyLineups(prisma,{redraftRosterIds:[args.rosterId],window}),
    loadWeekLineups(prisma,{redraftRosterIds:[args.rosterId],week:period.number,season:args.season}),
    prisma.sportsTeam.findMany({where:{sport},select:{name:true,shortName:true}}),
  ])
  if (!schedule?.length) throw Error('Waiting for the dated native game schedule.')
  const regular = schedule.filter(g=>g.seasonType === 'regular' && !g.replacedBy && !/cancel|postpon/i.test(g.status ?? ''))
  if (regular.some(g=>!g.startTime || !Number.isFinite(Date.parse(g.startTime)))) throw Error('A scheduled game is missing its start time.')
  const games = regular.filter(g=>Date.parse(g.startTime!) >= start && Date.parse(g.startTime!)<=end)
  if (!games.length) throw Error('No regular games verified in the source period.')
  const played = games.filter(g=>Date.parse(g.startTime!)<=now)
  const gameIds = played.map(g=>g.gameId)
  if (args.sourceSlots && played.some(g=>!/^(final|completed|closed|finished|ft)$/i.test(g.status ?? ''))) throw Error('A game is underway. Retry between games so individual scores cannot change during the handoff.')
  const identities = await prisma.playerIdentityMap.findMany({where:{ sport, rollingInsightsId:{in:players.map(p=>p.playerId)} },
    select:{ id:true, rollingInsightsId:true,fantraxId:true,currentTeam:true }})
  const ids = new Map(identities.map(i=>[i.rollingInsightsId,i]))
  if (ids.size !== identities.length || players.some(p=>!ids.has(p.playerId))) throw Error('A native game-log identity is missing or ambiguous.')
  const stats = await prisma.playerGameStat.findMany({where:{ sportType:sport,playerId:{in:identities.map(i=>i.id)},gameDate:{gte:window.start,lt:window.end}},
    select:{playerId:true,gameId:true,providerGameId:true,gameDate:true,team:true,opponent:true,normalizedStatMap:true}})
  const lines:DatedPlayerLine[] = [], missing = new Set<string>(), starterIds = new Set<string>()
  const active = new Map<string,number>(), bench = new Map<string,number>()
  const startedStats:Record<string,number>[] = []
  const byKey = new Map(stats.map(s=>[JSON.stringify([s.playerId,s.providerGameId ?? s.gameId]),s]))
  const namesByAlias=new Map<string,Set<string>>()
  for(const club of clubs){
    const full=normalizeLockTeam(sport,club.name), alias=normalizeLockTeam(sport,club.shortName)
    if(alias && full){const set=namesByAlias.get(alias)??new Set<string>();set.add(full);namesByAlias.set(alias,set)}
  }
  const clubKey=(raw:string|null|undefined)=>{
    const k=normalizeLockTeam(sport,raw), options=namesByAlias.get(k)
    return options?.size===1 ? [...options][0] : k
  }
  const allTeamNames = new Set(regular.flatMap(g=>[g.homeTeam,g.awayTeam]).map(clubKey))
  const boxes = gameIds.some(id=>id.startsWith('[')) ? await prisma.playerGameStat.groupBy({
    by:['gameDate','team','opponent','providerGameId'],where:{sportType:sport,gameDate:{gte:window.start,lt:window.end},team:{not:null},opponent:{not:null}},_count:{_all:true}}) : []
  const gameCoverage = gameIds.length ? await prisma.playerGameStat.groupBy({ by:['providerGameId','team'],where:{sportType:sport,providerGameId:{in:gameIds},team:{not:null}},_count:{_all:true} }) : []
  const seenTeams = new Map<string,Set<string>>()
  for (const r of gameCoverage) {
    if (!r.providerGameId || !r.team) continue
    const set=seenTeams.get(r.providerGameId) ?? new Set<string>()
    set.add(r.team); seenTeams.set(r.providerGameId,set)
  }
  const { WEEK_FINALIZE_GRACE_MS } = await import('@/lib/redraft/weekFinalizer')
  let allFinal = now>end+WEEK_FINALIZE_GRACE_MS && games.every(g=>/^(final|completed|closed|finished|ft)$/i.test(g.status ?? ''))
  for (const p of players) {
    const identity=ids.get(p.playerId)!
    const teamKeys=[identity.currentTeam,p.team].filter(Boolean).map(clubKey)
    const foundTeam = teamKeys.some(k=>allTeamNames.has(k))
    if (!foundTeam) missing.add(p.playerId)
    for (const g of played) {
      const stamp=Date.parse(g.startTime!), day=new Date(g.day+'T00:00:00Z')
      const proofKey=JSON.stringify([args.rosterId,g.day,p.playerId])
      const receiptSlot=args.sourceSlots?.get(proofKey)
      if ((!receiptSlot && p.addedAt.getTime()>stamp) || (p.droppedAt && p.droppedAt.getTime()<=stamp)) continue
      let row=byKey.get(JSON.stringify([identity.id,g.gameId]))
      if (!row && g.gameId.startsWith('[')) {
        const matches=stats.filter(s=>s.playerId===identity.id && s.gameDate?.toISOString().slice(0,10)===g.day &&
          [g.homeTeam,g.awayTeam].some(t=>clubKey(t)===clubKey(s.team)) && [g.homeTeam,g.awayTeam].some(t=>clubKey(t)===clubKey(s.opponent)))
        const sameDay=regular.filter(other=>other.day===g.day && [other.homeTeam,other.awayTeam].some(t=>teamKeys.includes(clubKey(t))))
        if(matches.length===1 && sameDay.length===1)row=matches[0]
      }
      if (!row && ![g.homeTeam,g.awayTeam].some(t=>teamKeys.includes(clubKey(t)))) continue
      const slot=receiptSlot ?? dailySlotFor(lineups,args.rosterId,p.playerId,day) ?? weekSlotType(p,weekly)
      const starter=isScoringStarterSlot(slot)
      if(starter) starterIds.add(p.playerId)
      const pair=[clubKey(g.homeTeam),clubKey(g.awayTeam)]
      const completeBox=(seenTeams.get(g.gameId)?.size??0)>=2 || (g.gameId.startsWith('[') && pair.every((t,i)=>boxes.some(b=>
        b.gameDate?.toISOString().slice(0,10)===g.day && clubKey(b.team)===t && clubKey(b.opponent)===pair[1-i])))
      if (!row && (!/^(final|completed|closed|finished|ft)$/i.test(g.status ?? '') || !completeBox)) {
        missing.add(p.playerId); allFinal=false; continue
      }
      const line=row ? normalizer(row.normalizedStatMap).stats : {}
      if (row && !Object.keys(line).length) { missing.add(p.playerId); allFinal=false; continue }
      const points=scorer(line,p.position)
      lines.push({day:g.day,game:g.gameId,player:p.playerId,roster:args.rosterId,slot,points,stats:line})
      if(starter) startedStats.push(line)
      const bucket=starter ? active : bench
      bucket.set(p.playerId,(bucket.get(p.playerId) ?? 0)+points)
    }
  }
  return { lines, nextStart:Math.min(end,...games.map(g=>Date.parse(g.startTime!)).filter(t=>t>now)), roster:players.map(p=>({player:p.playerId,fantraxId:ids.get(p.playerId)?.fantraxId,slot:p.slotType})), played:played.length,
    summary:{rosterId:args.rosterId,starterCount:starterIds.size,scoredStarterCount:[...starterIds].filter(id=>!missing.has(id)).length,
      points:[...active.values()].reduce((a,b)=>a+b,0),benchPoints:[...bench.values()].reduce((a,b)=>a+b,0),statTotals:accumulateTeamTotals(startedStats),
      missingPlayerIds:[...missing],allFinal:allFinal && !missing.size,
      playerPoints:[...active].map(([playerId,points])=>({playerId,points,isStarter:true})).concat([...bench].filter(([id])=>!active.has(id)).map(([playerId,points])=>({playerId,points,isStarter:false}))) } }
}
