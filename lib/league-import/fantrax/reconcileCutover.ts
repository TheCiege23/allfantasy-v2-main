import { prisma } from '@/lib/prisma'
import { createHash } from 'node:crypto'
import { getFantraxMatchupScores, getFantraxTeamRosters } from './fantraxApi'
import { object, readCutover, datedCutoverSport, periodDays } from './cutoverPolicy'
import { saveCutover } from './installCutover'
import { parseCutoverEvidence, verifyDatedRows } from './cutoverEvidence'
import { readDatedCutoverRoster } from './datedCutoverScoring'
import { daysInWindow } from '@/lib/redraft/dailyLineups'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import { fantraxNbaCategoryOutcome } from '@/lib/category-scoring/fantraxNbaCategories'
import { resolveCategoryMatchup } from '@/lib/category-scoring'
import { isScoringStarterSlot, scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { readWeekGames } from '@/lib/redraft/weekGames'
import { normalizeLockTeam } from '@/lib/redraft/lineupLock'

/** Commissioner exports supply historical assignments. Provider rosters, the live scoreboard and
 * native player lines independently verify them before a single scoring lock is released. */
export async function reconcileCutover(leagueId:string, actorId:string, csv:string) {
  const league = await prisma.league.findUniqueOrThrow({where:{id:leagueId},select:{settings:true,sport:true,season:true}})
  const cut = readCutover(league.settings,league.season ?? -1)
  if (!cut?.installedSeasonId || cut.policy!=='reconcile_open_period') throw Error('This league did not select an open-period handoff.')
  if (cut.settled) return { nativeFrom:cut.nativeFrom, reason:cut.reason }
  const period=cut.periods[cut.period-1], seasonId=cut.installedSeasonId, now=new Date(), sport=String(league.sport)
  if (now.getTime()>Date.parse(period.endDate)) throw Error('This period has closed. The scheduled Fantrax settlement will finish it.')
  const evidence=parseCutoverEvidence(csv,cut.season,cut.period)
  const provider=(await prisma.fantraxLeague.findUniqueOrThrow({where:{id:cut.snapshotId},select:{sourceLeagueId:true}})).sourceLeagueId
  if (!provider) throw Error('Reconnect the source league before verifying a live handoff.')
  const [sourceRosters,scoreboard,games] = await Promise.all([getFantraxTeamRosters(provider,cut.period),getFantraxMatchupScores(provider,cut.period),
    prisma.redraftMatchup.findMany({where:{seasonId,week:cut.period}})])
  if (!sourceRosters.ok || !scoreboard.ok || scoreboard.data.period!==cut.period) throw Error('An official current-period source is unavailable.')
  const nativeTeams=new Map<string,string>()
  for(const g of games){
    const s=object(object(g.lineupSnapshots).fantraxCutover)
    if (!s.sourceOwned || !g.awayRosterId) throw Error('A scheduled game has changed since the conversion.')
    nativeTeams.set(s.homeTeam,g.homeRosterId); nativeTeams.set(s.awayTeam,g.awayRosterId)
  }
  if(nativeTeams.size!==Object.keys(cut.teams).length || Object.keys(sourceRosters.data).length!==nativeTeams.size || [...evidence.values()].some(r=>!nativeTeams.has(r.team)))throw Error('The evidence must cover exactly the franchises in this handoff.')
  const category=nativeCategoryScoringContext(league.settings,sport)
  const keys=[...new Set(category?.categories.flatMap(c=>c.computation.kind==='sum'?[c.computation.statKey]:
    [c.computation.numeratorStatKey,c.computation.denominatorStatKey,...(c.computation.additionalNumeratorStatKeys??[])])??[])]
  const window=periodDays(period), today=easternCalendarDay(now)!
  const days=daysInWindow(window).filter(d=>d<=today).map(d=>d.toISOString().slice(0,10))
  const totals=new Map<string,{points:number;statTotals?:Record<string,number>}>()
  const locks:Array<{rosterId:string;playerId:string;scoringDay:Date;slotType:string}>=[]
  const ownership=await prisma.redraftRosterPlayer.findMany({where:{roster:{seasonId}},select:{id:true,rosterId:true,playerId:true,addedAt:true,droppedAt:true,slotType:true},orderBy:{id:'asc'}})
  if(ownership.some(p=>p.droppedAt))throw Error('Native transactions have changed the imported rosters. Keep this period on Fantrax.')
  const snapshotStamp=JSON.stringify(ownership)
  const allIds=ownership.map(r=>r.playerId), nfl=sport==='NFL'
  const identities=await prisma.playerIdentityMap.findMany({where:{sport,...(nfl?{sleeperId:{in:allIds}}:{rollingInsightsId:{in:allIds}})},select:{fantraxId:true,sleeperId:true,rollingInsightsId:true}})
  const fanByNative=new Map(identities.map(i=>[nfl?i.sleeperId:i.rollingInsightsId,i.fantraxId]))
  let matched=0,deadline=Date.parse(period.endDate)
  const nflDays=new Map<string,string>()
  if(nfl){
    const slate=await readWeekGames(prisma,{sport,season:cut.season,week:cut.period,seasonType:'regular'})
    if(!slate.length || slate.some(g=>!g.startTime || g.startTime.getTime()<Date.parse(period.startDate) || g.startTime.getTime()>deadline))throw Error('The native NFL slate does not match the selected source dates.')
    for(const game of slate){
      const instant=game.startTime!.getTime()
      if(instant>now.getTime()){deadline=Math.min(deadline,instant);continue}
      if(!/^(final|completed|closed|finished|ft)$/i.test(game.status??''))throw Error('An NFL game is underway. Retry between games.')
      for(const team of [game.homeTeam,game.awayTeam])nflDays.set(normalizeLockTeam('NFL',team),easternCalendarDay(game.startTime)!.toISOString().slice(0,10))
    }
  }
  for(const [team,rosterId] of nativeTeams){
    const players=ownership.filter(p=>p.rosterId===rosterId), providerItems=sourceRosters.data[team]?.rosterItems
    if(!providerItems || !players.length || providerItems.length!==players.length)throw Error('The open period has different source and native rosters.')
    const sourcePlayers=new Map(providerItems.map(p=>[p.id,p]))
    const overrides=new Map<string,string>()
    for(const p of players){
      const sourceId=fanByNative.get(p.playerId), current=sourceId && sourcePlayers.get(sourceId)
      if(!current || (current.status==='ACTIVE')!==isScoringStarterSlot(p.slotType))throw Error('An athlete or current lineup differs from Fantrax.')
      for(const day of days){
        const row=evidence.get(JSON.stringify([team,day,sourceId]))
        if(!row)throw Error('An elapsed day is missing a source athlete.')
        const slotType=row.slot==='ACTIVE'?'starter':row.slot==='RESERVE'?'bench':row.slot.toLowerCase()
        if(day===days.at(-1) && (row.slot==='ACTIVE')!==(current.status==='ACTIVE'))throw Error('The latest dated lineup differs from the source roster.')
        overrides.set(JSON.stringify([rosterId,day,p.playerId]),slotType)
        locks.push({rosterId,playerId:p.playerId,scoringDay:new Date(day+'T00:00:00Z'),slotType})
      }
    }
    if(datedCutoverSport(sport)){
      const dated=await readDatedCutoverRoster({leagueId,rosterId,sport,settings:league.settings,season:cut.season,period,now,sourceSlots:overrides})
      if(dated.summary.missingPlayerIds.length)throw Error('Native individual game data or team identities are still missing.')
      matched+=verifyDatedRows(evidence,team,days,dated.roster,dated.lines,keys)
      deadline=Math.min(deadline,dated.nextStart)
      totals.set(team,dated.summary)
    } else if(nfl){
      const scored=await scoreRosterForWeek({leagueId,rosterId,week:cut.period,seasonYear:cut.season,includeBench:true,collectPlayerPoints:true})
      if(scored.missingPlayerIds.length || !scored.playerPoints?.length || category)throw Error('Native weekly player scores are incomplete.')
      const playerPoints=new Map(scored.playerPoints.map(p=>[p.playerId,p]))
      const nflPlayers=await prisma.redraftRosterPlayer.findMany({where:{rosterId,droppedAt:null},select:{playerId:true,team:true}})
      const dayByPlayer=new Map(nflPlayers.map(p=>[p.playerId,nflDays.get(normalizeLockTeam('NFL',p.team))]))
      for(const p of players){
        const id=fanByNative.get(p.playerId), official=days.map(day=>evidence.get(JSON.stringify([team,day,id]))!)
        const native=playerPoints.get(p.playerId)
        if(!native || official.some(r=>r.points===null || (r.points!==0 && r.day!==dayByPlayer.get(p.playerId)) || (r.slot==='ACTIVE')!==native.isStarter) || Math.abs(official.reduce((a,r)=>a+(r.points??0),0)-native.points)>.005)throw Error('Weekly lineup or individual points have not reconciled.')
        matched+=official.length
      }
      totals.set(team,scored)
    } else throw Error('This sport needs dated native player scoring before an open-period transfer.')
  }
  if(matched!==evidence.size)throw Error('The file includes unexpected dates or athletes.')
  for(const m of games){
    const s=object(object(m.lineupSnapshots).fantraxCutover)
    const home=totals.get(s.homeTeam)!, away=totals.get(s.awayTeam)!
    const pair=scoreboard.data.matchups.filter(g=>g.home.teamId===s.homeTeam && g.away.teamId===s.awayTeam || g.away.teamId===s.homeTeam && g.home.teamId===s.awayTeam)
    if(pair.length!==1)throw Error('An official open matchup is missing or ambiguous.')
    const g=pair[0], forward=g.home.teamId===s.homeTeam
    const points=category?fantraxNbaCategoryOutcome(resolveCategoryMatchup(home.statTotals??{},away.statTotals??{},category.categories),object(league.settings).fantrax_category_scoring,true):{homeScore:home.points,awayScore:away.points}
    if(Math.abs(points.homeScore-(forward?g.home.score:g.away.score))>.005 || Math.abs(points.awayScore-(forward?g.away.score:g.home.score))>.005)throw Error('The native matchup totals differ from the official current scoreboard.')
  }
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const latest=readCutover((await tx.league.findUniqueOrThrow({where:{id:leagueId},select:{settings:true}})).settings)
    if (!latest || latest.installedSeasonId!==seasonId || latest.settled || Date.now()>=deadline)throw Error('The scoring boundary changed. Refresh the handoff before retrying.')
    const current=await tx.redraftRosterPlayer.findMany({where:{roster:{seasonId}},select:{id:true,rosterId:true,playerId:true,addedAt:true,droppedAt:true,slotType:true},orderBy:{id:'asc'}})
    if(JSON.stringify(current)!==snapshotStamp)throw Error('A native roster changed during verification.')
    const existing=await tx.redraftDailyLineup.findMany({where:{leagueId,season:cut.season,scoringDay:{gte:window.start,lte:today}}})
    const owned=new Map(locks.map(l=>[JSON.stringify([l.rosterId,l.playerId,l.scoringDay.toISOString()]),l]))
    if(existing.some(r=>{const match=owned.get(JSON.stringify([r.rosterId,r.playerId,r.scoringDay.toISOString()]));return !match || isScoringStarterSlot(match.slotType)!==isScoringStarterSlot(r.slotType)}))throw Error('A locked native daily lineup differs from the source.')
    if(datedCutoverSport(sport)){
      for(let i=0;i<locks.length;i+=1000)await tx.redraftDailyLineup.createMany({data:locks.slice(i,i+1000).map(r=>({...r,leagueId,season:cut.season,week:cut.period,source:'fantrax_verified'})),skipDuplicates:true})
      await tx.redraftRosterPlayer.updateMany({where:{id:{in:current.map(p=>p.id)},addedAt:{gt:new Date(period.startDate)}},data:{addedAt:new Date(period.startDate)}})
    }
    for(const m of games)await tx.redraftMatchup.update({where:{id:m.id},data:{lineupSnapshots:{...object(m.lineupSnapshots),fantraxCutover:{...object(object(m.lineupSnapshots).fantraxCutover),sourceOwned:false}}}})
    latest.nativeFrom=cut.period;latest.settled=true;latest.reason='Native scoring owns the open period. Locked lineups, individual scores and matchup totals reconciled.'
    await saveCutover(tx,leagueId,latest)
    await tx.leagueAuditLog.create({data:{leagueId,userId:actorId,actionType:'fantrax_period_reconciled',entityType:'redraft_season',entityId:seasonId,afterState:{period:cut.period,matched,exportSha256:createHash('sha256').update(csv).digest('hex')}}})
  },{isolationLevel:'Serializable',timeout:60000})
  return {nativeFrom:cut.period,matched}
}
