/** Four-team real service season; synthetic data only on the explicitly guarded test DB. */
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { createDefaultLeagueRosterConfig } from '../lib/roster-engine/UnifiedRosterConfigService'
import { applyDefaultNflScoringOnCreate } from '../lib/nfl-scoring'
import { startDraftSession } from '../lib/live-draft-engine/DraftSessionService'
import { submitPick } from '../lib/live-draft-engine/PickSubmissionService'
import { updateMatchupScores } from '../lib/redraft/scoringEngine'
import { updateStandings } from '../lib/redraft/standingsEngine'
import { generateSchedule } from '../lib/redraft/scheduleEngine'
import { generateNflRedraftPlayoffRuntimeBracket, advanceNflRedraftPlayoffRuntimeRound, finalizeNflRedraftPlayoffRuntimeSeason } from '../lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'
import { scoreActivePlayoffRound } from '../lib/playoff-runtime/playoffRoundScoring'
import { createNextLeagueDraft } from '../lib/live-draft-engine/createNextLeagueDraft'
import { computeOptimalLineup } from '../lib/lineup-optimizer/optimalLineup'
import { resolveTiebreak } from '../lib/guillotine/GuillotineTiebreakResolver'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'
import { writeFileSync } from 'node:fs'
const assert = (ok: unknown, label: string) => { if (!ok) throw new Error(label) }
async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  assert(host.startsWith('ep-muddy-leaf-') && host.endsWith('.neon.tech'), 'KNOWN_TEST_DATABASE_REQUIRED')
  assert(!process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN, 'SHARED_REDIS_MUST_BE_DISABLED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })
  const marker = 'four-season-' + randomUUID().slice(0,8), users: string[] = [], playerIds: string[] = []
  let leagueId: string | undefined
  const report: any = { target: 'known test DB', creation: {}, limitations: ['Synthetic player identities and statistics do not certify live images, logos, ADP or provider coverage.', 'Playoff stat sealing is injected as finalized synthetic data; provider refresh and calendar jobs are not exercised.', 'Specialty four-team comparisons below are pure engine simulations, not accepted native creation or DB lifecycle certification.'] }
  try {
    for (const concept of ['redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine']) {
      const v = validateCreatePayload({ concept, sport: 'NFL', teamCount: 4, draftType: 'snake', scoringPreset: 'fb_ppr', leagueName: marker, timezone: 'America/Chicago' })
      report.creation[concept] = { accepted: v.ok }
    }
    for (let i=0;i<4;i++) users.push((await prisma.appUser.create({ data: { username: marker+'-'+i, email: marker+'-'+i+'@example.invalid' } })).id)
    const v = validateCreatePayload({ concept: 'redraft', sport: 'NFL', teamCount: 4, draftType: 'snake', scoringPreset: 'fb_ppr', leagueName: marker, timezone: 'America/Chicago', conceptSetup: { medianGame: true } })
    if (!v.ok) throw new Error('REJECTED_REDRAFT')
    leagueId = (await prisma.$transaction(tx => createCanonicalLeagueInTransaction(tx, users[0], v.data, runPresetEngine({ ...v.data, commissionerId: users[0] })), { timeout: 120000 })).leagueId
    await createDefaultLeagueRosterConfig(leagueId, 'NFL', 'redraft')
    await applyDefaultNflScoringOnCreate(leagueId, 'af_ppr')
    const generic = (await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } })).sort((a,b)=>Number(b.platformUserId===users[0])-Number(a.platformUserId===users[0]))
    for (let i=0;i<4;i++) {
      await prisma.leagueTeam.updateMany({ where: { leagueId, platformUserId: generic[i].platformUserId }, data: { platformUserId: users[i], claimedByUserId: users[i] } })
      await prisma.roster.update({ where: { id: generic[i].id }, data: { platformUserId: users[i] } })
    }
    const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
    await prisma.draftSession.update({ where: { id: draft.id }, data: { slotOrder: generic.map((r,i)=>({ slot:i+1, rosterId:r.id, displayName:'Team '+(i+1) })) } })
    assert((await startDraftSession(leagueId)).ok, 'DRAFT_START')
    const positions = ['QB','RB','RB','WR','WR','TE','WR','K','DEF','QB','RB','WR','TE','RB','WR']
    for(let overall=1;overall<=draft.rounds*4;overall++) {
      const round = Math.floor((overall-1)/4), slot=(overall-1)%4, owner=round%2===0?slot:3-slot
      const playerId=marker+'-player-'+overall; playerIds.push(playerId)
      const result=await submitPick({ leagueId, playerId, playerName:playerId, position:positions[round%positions.length], rosterId:generic[owner].id, madeByUserId:users[owner], source:'user', expectedOverall:overall })
      assert(result.success, 'PICK_'+overall+'_'+result.code)
      if(overall%4===0) console.log('Draft round '+(round+1)+' completed')
    }
    assert((await prisma.draftSession.findUniqueOrThrow({where:{id:draft.id}})).status==='completed','AUTO_DRAFT_COMPLETE')
    const season=await prisma.redraftSeason.findFirstOrThrow({where:{leagueId}})
    const rosters=await prisma.redraftRoster.findMany({where:{seasonId:season.id}})
    assert(rosters.length===4 && await prisma.redraftRosterPlayer.count({where:{rosterId:{in:rosters.map(r=>r.id)}}})===draft.rounds*4,'FINALIZED_ROSTERS')
    // Explicit simulation calendar: 15 regular weeks, one-week semifinal and championship.
    await prisma.league.update({where:{id:leagueId},data:{playoffTeams:4,playoffWeeksPerRound:1}})
    await prisma.redraftSeason.update({where:{id:season.id},data:{totalWeeks:17,playoffStartWeek:16}})
    await prisma.redraftMatchup.deleteMany({where:{seasonId:season.id}})
    await prisma.redraftMatchup.createMany({data:generateSchedule(rosters,17,16,'NFL').filter(g=>g.type!=='median').map(g=>({seasonId:season.id,leagueId:leagueId!,week:g.week,homeRosterId:g.home,awayRosterId:g.away}))})
    const expectedPoints=new Map(rosters.map(r=>[r.id,0]))
    for(let week=1;week<=17;week++) {
      for(const roster of rosters) {
        const i=users.indexOf(roster.ownerId)
        const players=await prisma.redraftRosterPlayer.findMany({where:{rosterId:roster.id}})
        // Put one QB in the starting lineup. Other rostered players receive real zero stat rows.
        const qb=players.find(p=>p.position==='QB')!
        await prisma.redraftRosterPlayer.updateMany({where:{rosterId:roster.id},data:{slotType:'BENCH'}})
        await prisma.redraftRosterPlayer.update({where:{id:qb.id},data:{slotType:'QB'}})
        for(const player of players) await prisma.playerWeeklyScore.create({data:{playerId:player.playerId,sport:'NFL',season:season.season,week,stats:player.id===qb.id?{pass_td:(i+week)%4+1}:{},isFinalized:true}})
        if(week<=15) expectedPoints.set(roster.id,expectedPoints.get(roster.id)!+4*((i+week)%4+1))
      }
      if(week<=15) {
        for(const game of await prisma.redraftMatchup.findMany({where:{seasonId:season.id,week}})) await updateMatchupScores(game.id)
        await updateStandings(season.id,week)
        const rows=await prisma.redraftRoster.findMany({where:{seasonId:season.id}})
        for(const row of rows) assert(row.wins+row.losses+row.ties===week*2 && row.pointsFor===expectedPoints.get(row.id),'RECORD_OR_POINTS_WEEK_'+week)
        console.log('Regular week '+week+' verified')
      }
    }
    await updateStandings(season.id,15)
    report.regularSeason={weeks:15,matchups:30,medianGamesPerTeam:15,standings:(await prisma.redraftRoster.findMany({where:{seasonId:season.id},orderBy:{playoffSeed:'asc'}})).map(r=>({team:users.indexOf(r.ownerId)+1,wins:r.wins,losses:r.losses,ties:r.ties,pointsFor:r.pointsFor}))}
    await generateNflRedraftPlayoffRuntimeBracket({seasonId:season.id,playoffTeams:4,actorUserId:users[0],lockBracket:true})
    for(const week of [16,17]) {
      const scored=await scoreActivePlayoffRound({seasonId:season.id,calendarWeek:week},{finalizeWeek:async()=>({finalized:true,alreadyFinal:false} as any)})
      assert(scored.matchupsScored>0,'PLAYOFF_SCORE_'+week+'_'+scored.outcome)
      const advanced=await advanceNflRedraftPlayoffRuntimeRound({seasonId:season.id,week,actorUserId:users[0]})
      assert(advanced.ok,'PLAYOFF_ADVANCE_'+week)
    }
    const final=await finalizeNflRedraftPlayoffRuntimeSeason({seasonId:season.id,actorUserId:users[0]})
    assert(final.ok && final.championRosterId,'CHAMPION')
    const repeat=await finalizeNflRedraftPlayoffRuntimeSeason({seasonId:season.id,actorUserId:users[0]})
    assert(repeat.ok && repeat.alreadyFinalized,'CHAMPION_IDEMPOTENCY')
    const renewal=await createNextLeagueDraft(leagueId,users[0]);assert(renewal.ok,'RENEWAL')
    report.redraft={draftRounds:draft.rounds,realSubmittedPicks:draft.rounds*4,autoFinalized:true,championTeam:users.indexOf(rosters.find(r=>r.id===final.championRosterId)!.ownerId)+1,championshipRecords:await prisma.leagueChampionship.count({where:{leagueId}}),renewalVerified:true}
    // Four-team specialty rules comparison uses production pure optimizer/tiebreak engines.
    let active=[0,1,2,3]; const chops=[];const bestBallTotals=[0,0,0,0]
    for(let week=1;week<=17;week++) for(let team=0;team<4;team++) {
      const players=[{playerId:'QB',positions:['QB'],points:4*((team+week)%4+1)},{playerId:'RB',positions:['RB'],points:20+team},{playerId:'QB2',positions:['QB'],points:5}]
      const best=computeOptimalLineup({players,slots:[{slot:'SUPER_FLEX',eligible:['QB','RB','WR','TE'],count:1},{slot:'QB',eligible:['QB'],count:1}]})
      assert(best.unfilledSlots.length===0 && new Set(best.assignments.map(a=>a.playerId)).size===2,'BESTBALL_LEGAL');bestBallTotals[team]+=best.total
    }
    for(let week=1;week<=3;week++) {
      const scores=active.map(team=>({rosterId:'team-'+team,periodPoints:team*10+week,seasonPointsCumul:team*10*week+week}))
      const lowest=Math.min(...scores.map(s=>s.periodPoints))
      const chop=resolveTiebreak({candidates:scores.filter(s=>s.periodPoints===lowest),tiebreakerOrder:['season_points','draft_slot'],teamsPerChop:1,weekOrPeriod:week,draftSlotByRoster:new Map(active.map(t=>['team-'+t,t+1]))})
      assert(chop.choppedRosterIds.length===1,'ONE_CHOP');const id=chop.choppedRosterIds[0];active=active.filter(t=>'team-'+t!==id);chops.push({week,choppedTeam:Number(id.split('-')[1])+1,survivors:active.length})
    }
    report.pureSpecialtyComparison={bestBall:{weeks:17,totals:bestBallTotals,winner:bestBallTotals.indexOf(Math.max(...bestBallTotals))+1},guillotine:{chops,winner:active[0]+1},dynasty:{requiredNextStep:'Retain entire roster, apply future traded picks, then rookie draft; real eight-team renewal already verified by smoke-league-finalization-testdb.ts.'},keeper:{requiredNextStep:'Lock eligible keepers and charge their draft rounds before drafting remaining pool; real eight-team keeper placement already verified by smoke-league-finalization-testdb.ts.'}}
  } finally {
    await new Promise(r=>setTimeout(r,5000))
    await prisma.trendSignalEvent.deleteMany({where:{playerId:{in:playerIds}}}); await prisma.playerMetaTrend.deleteMany({where:{playerId:{in:playerIds}}}); await prisma.playerWeeklyScore.deleteMany({where:{playerId:{in:playerIds}}})
    if(leagueId){await prisma.analyticsEvent.deleteMany({where:{OR:[{meta:{path:['leagueId'],equals:leagueId}},{userId:{in:users}}]}});await prisma.automationLock.deleteMany({where:{lockKey:'draft:'+leagueId+':pick'}});await prisma.league.deleteMany({where:{id:leagueId}})}
    await prisma.appUser.deleteMany({where:{id:{in:users}}})
    report.cleanup={leagues:leagueId?await prisma.league.count({where:{id:leagueId}}):0,users:await prisma.appUser.count({where:{id:{in:users}}}),scores:await prisma.playerWeeklyScore.count({where:{playerId:{in:playerIds}}})}
    assert(Object.values(report.cleanup).every(n=>n===0),'CLEANUP')
    writeFileSync('artifacts/four-team-season-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await prisma.$disconnect()
  }
}
main().catch(e=>{console.error('Four-team simulation failed:',e.code??e.message);process.exitCode=1})
