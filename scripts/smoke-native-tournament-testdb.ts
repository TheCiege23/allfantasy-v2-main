/** Persisted four-team native tournament checks. Never accepts a production database host. */
import {randomUUID} from 'node:crypto'
import {prisma} from '../lib/prisma'
import {validateCreatePayload} from '../lib/league-creation/canonical/validateCreateLeague'
import {runPresetEngine} from '../lib/league-creation/preset-engine/runPresetEngine'
import {createCanonicalLeagueInTransaction} from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import {createDefaultLeagueRosterConfig} from '../lib/roster-engine/UnifiedRosterConfigService'
import {applyDefaultNflScoringOnCreate} from '../lib/nfl-scoring'
import {syncCompletedDraftToRedraftSeason} from '../lib/redraft/finalizeDraftToRedraftSeason'
import {scoreRosterForWeek} from '../lib/redraft/scoringEngine'
import {ensureNativeTournamentEntries,runNativeTournamentWeek} from '../lib/bestball/nativeTournament'
import {recalculateMatchupsForSeasonWeek} from '../lib/redraft/scoringEngine'
import {configureEventInfrastructure,InMemoryOutboxStore} from '../lib/events'
const check=(ok:unknown,label:string)=>{if(!ok)throw new Error(label)}
async function main(){
 const host=new URL(process.env.DATABASE_URL??'').hostname
 check(host.startsWith('ep-muddy-leaf-')&&host.endsWith('.neon.tech'),'KNOWN_TEST_DATABASE_REQUIRED')
 check(!process.env.UPSTASH_REDIS_REST_URL&&!process.env.UPSTASH_REDIS_REST_TOKEN,'SHARED_REDIS_MUST_BE_DISABLED')
 configureEventInfrastructure({outboxStore:new InMemoryOutboxStore()})
 globalThis.fetch = async () => { throw new Error('EXTERNAL_HTTP_DISABLED') }
 const marker='special-'+randomUUID().slice(0,8),users:string[]=[],leagues:string[]=[],playerIds:string[]=[],contests:string[]=[],results:any[]=[]
 try{
  for(let i=0;i<4;i++)users.push((await prisma.appUser.create({data:{username:marker+'-'+i,email:marker+'-'+i+'@example.invalid'}})).id)
  for(const concept of ['best_ball']){
   const v=validateCreatePayload({concept,sport:'NFL',teamCount:4,draftType:'snake',scoringPreset:'fb_ppr',leagueName:marker+'-'+concept,timezone:'America/Chicago',conceptSetup:concept==='best_ball'?{bestBall:{contestStructure:'tournament',podSize:4,advancersPerPod:2,regularSeasonLength:2,tournamentAdvancementRounds:1,roundEndWeeks:[2,3],resetBetweenRounds:true,playoffTeams:0}}:{}})
   if(!v.ok)throw new Error('CREATION_'+concept+'_'+v.error)
   const leagueId=(await prisma.$transaction(tx=>createCanonicalLeagueInTransaction(tx,users[0],v.data,runPresetEngine({...v.data,commissionerId:users[0]})),{timeout:120000})).leagueId;leagues.push(leagueId);const linked=await prisma.league.findUniqueOrThrow({where:{id:leagueId}});check(linked.bbContestId,'CANONICAL_CONTEST_LINK');contests.push(linked.bbContestId!)
   await createDefaultLeagueRosterConfig(leagueId,'NFL',concept);await applyDefaultNflScoringOnCreate(leagueId,'af_ppr')
   const generic=(await prisma.roster.findMany({where:{leagueId},orderBy:{id:'asc'}})).sort((a,b)=>Number(b.platformUserId===users[0])-Number(a.platformUserId===users[0]))
   for(let i=0;i<4;i++){await prisma.leagueTeam.updateMany({where:{leagueId,platformUserId:generic[i].platformUserId},data:{platformUserId:users[i],claimedByUserId:users[i]}});await prisma.roster.update({where:{id:generic[i].id},data:{platformUserId:users[i]}})}
   const draft=await prisma.draftSession.findFirstOrThrow({where:{leagueId}})
   const positions=['QB','RB','RB','WR','WR','TE','WR','K','DEF','QB','RB','WR','TE','RB','WR','WR','RB','TE']
   const picks=Array.from({length:draft.rounds*4},(_,i)=>{const round=Math.floor(i/4),slot=i%4,owner=round%2===0?slot:3-slot,playerId=marker+'-'+concept.slice(0,1)+'-'+i;playerIds.push(playerId);return{sessionId:draft.id,overall:i+1,round:round+1,slot:owner+1,rosterId:generic[owner].id,playerId,playerName:playerId,position:positions[round%positions.length],sportType:'NFL',source:'simulation_fixture'}})
   await prisma.draftPick.createMany({data:picks});await prisma.draftSession.update({where:{id:draft.id},data:{status:'completed'}});await syncCompletedDraftToRedraftSeason(leagueId);await prisma.league.update({where:{id:leagueId},data:{lifecycleState:'post_draft'}})
   const season=await prisma.redraftSeason.findFirstOrThrow({where:{leagueId}}),rosters=await prisma.redraftRoster.findMany({where:{seasonId:season.id}})
   check(rosters.length===4,'FINALIZATION_'+concept)
   if(concept==='best_ball'){
    check(season.totalWeeks===3&&season.playoffStartWeek===4,'TOURNAMENT_CALENDAR')
    await ensureNativeTournamentEntries(leagueId,season.id);await ensureNativeTournamentEntries(leagueId,season.id)
    check(await prisma.bestBallEntry.count({where:{contestId:contests[0]}})===4,'DRAFT_ENTRIES_ONCE')
    check(await runNativeTournamentWeek(season.id,1)==='waiting_for_final_scores','NO_FABRICATED_ZERO')
    let lineupWeeks=0,benchQbSelections=0
    for(let week=1;week<=3;week++){
     for(const roster of rosters){
      const rows=await prisma.redraftRosterPlayer.findMany({where:{rosterId:roster.id},orderBy:{playerId:'asc'}})
      const qbs=rows.filter(p=>p.position==='QB');const benchQb=qbs.at(-1)!
      await prisma.redraftRosterPlayer.update({where:{id:benchQb.id},data:{slotType:'BENCH'}})
      await prisma.playerWeeklyScore.createMany({data:rows.map((p,i)=>({playerId:p.playerId,sport:'NFL',season:season.season,week,isFinalized:true,stats:p.position==='QB'?{pass_td:p.id===benchQb.id?10+rosters.indexOf(roster):1}:p.position==='DEF'?{def_sack:2}:p.position==='K'?{fgm:1}:{rec:i+week,rush_yd:10}}))})
      const score=await scoreRosterForWeek({leagueId,rosterId:roster.id,week,seasonYear:season.season})
      check(score.allFinal&&score.missingPlayerIds.length===0&&score.bestBall?.unfilledSlots.length===0,'BESTBALL_COMPLETE_'+week)
      check(score.bestBall!.assignments.some(a=>a.playerId===benchQb.playerId),'BENCH_QB_OPTIMAL');benchQbSelections++;lineupWeeks++
     }
     await recalculateMatchupsForSeasonWeek(season.id,week)
     const result=await runNativeTournamentWeek(season.id,week)
     check(result===['scored','advanced','complete'][week-1],'AUTO_ROUND_'+week+'_'+result)
     if(week===2)check(await prisma.bestBallEntry.count({where:{contestId:contests[0],isEliminated:false,currentRound:2}})===2,'SURVIVORS')
     if(week===3){
      const archive=await prisma.leagueSeason.findUniqueOrThrow({where:{leagueId_season:{leagueId,season:season.season}}})
      const winner=await prisma.bestBallEntry.findFirstOrThrow({where:{contestId:contests[0],overallRank:1}})
      const records=archive.teamRecords as any[]
      check(records.some(r=>r.rosterId===winner.id.slice(contests[0].length+1)&&r.rank===1&&r.tournamentChampion),'CONTEST_CHAMPION_ARCHIVED')
      check((await prisma.league.findUniqueOrThrow({where:{id:leagueId}})).lifecycleState==='offseason','OFFSEASON_HANDOFF')
      check(await runNativeTournamentWeek(season.id,week)==='complete','FINAL_RETRY')
      check(await prisma.leagueSeason.count({where:{leagueId}})===1,'IMMUTABLE_ARCHIVE_ONCE')
     }
     console.log('Best-ball week '+week+' verified')
    }
    results.push({concept,teams:4,rosterPlayers:picks.length,completeLineupWeeks:lineupWeeks,benchQbSelections,nativeContestCreated:true,draftEntriesIdempotent:true,scheduledAdvancement:true,finalRetrySafe:true})

   }
  }
 }finally{
  await prisma.playerWeeklyScore.deleteMany({where:{playerId:{in:playerIds}}});await prisma.guillotinePeriodScore.deleteMany({where:{leagueId:{in:leagues}}});await prisma.guillotineEventLog.deleteMany({where:{leagueId:{in:leagues}}});await prisma.guillotineRosterState.deleteMany({where:{leagueId:{in:leagues}}});await prisma.automationLock.deleteMany({where:{lockKey:{in:leagues.flatMap(id=>[1,2,3].map(w=>'guillotine-elimination:'+id+':'+w))}}});await prisma.league.deleteMany({where:{id:{in:leagues}}});await prisma.bestBallContest.deleteMany({where:{id:{in:contests}}});await prisma.appUser.deleteMany({where:{id:{in:users}}})
  const cleanup={contests:await prisma.bestBallContest.count({where:{id:{in:contests}}}),guillotineEvents:await prisma.guillotineEventLog.count({where:{leagueId:{in:leagues}}}),guillotineStates:await prisma.guillotineRosterState.count({where:{leagueId:{in:leagues}}}),leagues:await prisma.league.count({where:{id:{in:leagues}}}),users:await prisma.appUser.count({where:{id:{in:users}}}),scores:await prisma.playerWeeklyScore.count({where:{playerId:{in:playerIds}}})};check(Object.values(cleanup).every(n=>n===0),'CLEANUP');console.log(JSON.stringify({target:'known test DB',results,cleanup},null,2));await prisma.$disconnect()
 }
}
main().catch(e=>{console.error('Specialty simulation failed:',e.code??e.message);process.exitCode=1})
