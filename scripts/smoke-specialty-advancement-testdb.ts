import { randomUUID } from 'node:crypto'

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  const host = new URL(url).hostname
  if (!host.startsWith('ep-muddy-leaf-') || !host.endsWith('.neon.tech')) throw new Error('KNOWN_TEST_DATABASE_REQUIRED')
  for (const key of ['DIRECT_URL','POSTGRES_URL','POSTGRES_PRISMA_URL','POSTGRES_URL_NON_POOLING','NEON_DATABASE_URL']) process.env[key] = url
  for (const key of ['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','REDIS_URL','REDIS_HOST','REDIS_PORT','REDIS_PASSWORD','REDIS_USERNAME','RESEND_API_KEY','META_CONVERSIONS_API_TOKEN']) process.env[key] = ''
  globalThis.fetch = async () => { throw new Error('EXTERNAL_HTTP_DISABLED') }
  const { prisma } = await import('../lib/prisma')
  const { advancePodWinners, assignEntriesToPods } = await import('../lib/bestball/contestEngine')
  const { runElimination } = await import('../lib/guillotine/GuillotineEliminationEngine')
  const { determineFinalChampion } = await import('../lib/guillotine/endgameEngine')
  const marker = 'specialty-' + randomUUID().slice(0,8)
  const leagues: string[] = [], contests: string[] = [], users: string[] = []
  const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label) }
  try {
    for (let i=0;i<4;i++) users.push((await prisma.appUser.create({data:{username:marker+'-'+i,email:marker+'-'+i+'@example.invalid'}})).id)
    const contest = await prisma.bestBallContest.create({data:{name:marker,sport:'NFL',rounds:2,podSize:4,advancersPerPod:2,resetBetweenRounds:true,status:'active'}})
    contests.push(contest.id)
    const entries=[]
    for(let i=0;i<4;i++) entries.push(await prisma.bestBallEntry.create({data:{contestId:contest.id,userId:users[i],totalPoints:[200,200,190,210][i],weeklyScores:[{week:1,points:[100,140,180,110][i]},{week:2,points:[100,60,10,100][i]}]}}))
    await assignEntriesToPods(contest.id)
    await assignEntriesToPods(contest.id)
    check(await prisma.bestBallPod.count({where:{contestId:contest.id,roundNumber:1}})===1,'INITIAL_POD_CREATED_ONCE')
    await advancePodWinners(contest.id,1,'max_week')
    await advancePodWinners(contest.id,1,'max_week')
    const nextPods=await prisma.bestBallPod.findMany({where:{contestId:contest.id,roundNumber:2},include:{entries:true}})
    check(nextPods.length===1 && nextPods[0].entries.length===2,'NEXT_POD_CREATED_ONCE')
    check(nextPods[0].entries.every(entry=>entry.id===entries[1].id || entry.id===entries[3].id),'SAVED_MAX_WEEK_CHOICE')
    check(nextPods[0].entries.every(entry=>entry.totalPoints===0 && Array.isArray(entry.weeklyScores) && !entry.weeklyScores.length),'ROUND_SCORE_RESET')
    let refused=false
    try { await advancePodWinners(contest.id,2,'max_week') } catch { refused=true }
    check(refused && (await prisma.bestBallContest.findUniqueOrThrow({where:{id:contest.id}})).status!=='complete','NO_PREMATURE_FINAL')
    for(const entry of nextPods[0].entries) await prisma.bestBallEntry.update({where:{id:entry.id},data:{totalPoints:entry.id===entries[1].id?90:80,weeklyScores:[{week:3,points:entry.id===entries[1].id?90:80}]}})
    await advancePodWinners(contest.id,2,'max_week')
    await advancePodWinners(contest.id,2,'max_week')
    check((await prisma.bestBallContest.findUniqueOrThrow({where:{id:contest.id}})).status==='complete','CONTEST_COMPLETED')
    check((await prisma.bestBallEntry.findUniqueOrThrow({where:{id:entries[1].id}})).overallRank===1,'FINAL_CHAMPION')

    const league=await prisma.league.create({data:{name:marker,platform:'manual',platformLeagueId:marker,sport:'NFL',userId:users[0],leagueVariant:'guillotine',guillotineEndgame:'final_four',guillotineEndgameThreshold:4,settings:{eliminationSettings:{endgame:'final_four'}}}})
    leagues.push(league.id)
    await prisma.guillotineLeagueConfig.create({data:{leagueId:league.id,eliminationStartWeek:1,eliminationEndWeek:17,teamsPerChop:1,correctionWindow:'immediate',rosterReleaseTiming:'immediate'}})
    const season=await prisma.redraftSeason.create({data:{leagueId:league.id,sport:'NFL',season:2026,totalWeeks:17,playoffStartWeek:18,status:'active'}})
    const guillo=await prisma.guillotineSeason.create({data:{leagueId:league.id,redraftSeasonId:season.id,sport:'NFL',season:2026,totalTeamsStarted:4,currentTeamsActive:4,status:'active'}})
    const rosters=[]
    for(let i=0;i<4;i++) {
      const r=await prisma.redraftRoster.create({data:{leagueId:league.id,seasonId:season.id,ownerId:users[i],ownerName:'Team '+(i+1)}})
      rosters.push({redraft:r.id,engine:(await prisma.roster.create({data:{leagueId:league.id,platformUserId:users[i],redraftRosterId:r.id,playerData:{players:[marker+'-p'+i]}}})).id})
    }
    await prisma.guillotinePeriodScore.createMany({data:rosters.map(r=>({leagueId:league.id,rosterId:r.engine,weekOrPeriod:1,season:2025,periodPoints:-100,seasonPointsCumul:-100}))})
    for(let week=1;week<=3;week++) {
      const outcome=await runElimination({leagueId:league.id,season:2026,weekOrPeriod:week,periodEndedAt:new Date('2026-01-01'),skipChat:true,periodScores:rosters.map((r,index)=>({rosterId:r.engine,periodPoints:100+index*10,seasonPointsCumul:(100+index*10)*week}))})
      check(outcome?.choppedRosterIds.length===0,'NO_FINAL_STAGE_CHOPS')
      if(week<3) check(await determineFinalChampion(guillo.id)===null,'THREE_PERIODS_REQUIRED')
    }
    check(await determineFinalChampion(guillo.id)===rosters[3].redraft,'GUILLOTINE_CUMULATIVE_CHAMPION')
    check(await prisma.redraftRoster.count({where:{seasonId:season.id,isEliminated:false}})===4,'ALL_FINALISTS_SURVIVE')
    check((await prisma.guillotineSeason.findUniqueOrThrow({where:{id:guillo.id}})).status==='complete','FINAL_STAGE_COMPLETED')
    await runElimination({leagueId:league.id,season:2026,weekOrPeriod:3,periodEndedAt:new Date('2026-01-01'),skipChat:true})
    check(await prisma.guillotineRosterState.count({where:{leagueId:league.id}})===0,'FINAL_RETRY_NO_CHOP')
    // Simulate failure after state/flag writes but before the chop audit.
    await prisma.league.update({where:{id:league.id},data:{guillotineEndgame:'last_team_standing',guillotineEndgameThreshold:1,settings:{eliminationSettings:{endgame:'last_team_standing'}}}})
    await prisma.guillotineSeason.update({where:{id:guillo.id},data:{status:'active',currentScoringPeriod:0,isInFinalStage:false,finalStageStartPeriod:null}})
    await prisma.redraftSeason.update({where:{id:season.id},data:{status:'active'}})
    await prisma.guillotineRosterState.create({data:{leagueId:league.id,rosterId:rosters[0].engine,choppedInPeriod:1,choppedAt:new Date(),choppedReason:'Synthetic interrupted chop'}})
    await prisma.redraftRoster.update({where:{id:rosters[0].redraft},data:{isEliminated:true}})
    const recovered=await runElimination({leagueId:league.id,season:2026,weekOrPeriod:1,periodEndedAt:new Date('2026-01-01'),skipChat:true})
    check(recovered?.choppedRosterIds.join()===rosters[0].engine,'RECOVERY_PRESERVES_ORIGINAL_CHOP')
    check(await prisma.guillotineElimination.count({where:{seasonId:guillo.id,scoringPeriod:1}})===1,'MISSING_AUDIT_REPAIRED')
    check((await prisma.guillotineSeason.findUniqueOrThrow({where:{id:guillo.id}})).currentTeamsActive===3,'RECOVERY_COUNTER_ONCE')
    // Simulate a release failure after the audit was committed.
    await prisma.roster.update({where:{id:rosters[0].engine},data:{playerData:{players:[marker+'-release-retry']}}})
    await runElimination({leagueId:league.id,season:2026,weekOrPeriod:1,periodEndedAt:new Date('2026-01-01'),skipChat:true})
    const released=(await prisma.roster.findUniqueOrThrow({where:{id:rosters[0].engine}})).playerData as {players?:unknown[]}
    check(Array.isArray(released.players) && released.players.length===0,'AUDITED_RELEASE_RECOVERED')
    check(await prisma.guillotineRosterState.count({where:{leagueId:league.id}})===1,'RECOVERY_RETRY_NO_NEW_CHOP')
    console.log(JSON.stringify({teams:4,bestBall:{twoRounds:true,nextPodCreatedOnce:true,maxWeekTieHonored:true,scoresReset:true,prematureFinalRefused:true,championTeam:2},guillotine:{threeFinalPeriods:true,zeroChops:true,championTeam:4,retrySafe:true,interruptedAuditRepaired:true},limitations:'Persisted engine fixtures and synthetic period scores; no live optimizer/provider/calendar or browser DB journey.'},null,2))
  } finally {
    for(const leagueId of leagues) {
      await prisma.guillotineEventLog.deleteMany({where:{leagueId}})
      await prisma.guillotinePeriodScore.deleteMany({where:{leagueId}})
      await prisma.guillotineRosterState.deleteMany({where:{leagueId}})
      await prisma.league.deleteMany({where:{id:leagueId}})
    }
    await prisma.bestBallContest.deleteMany({where:{id:{in:contests}}})
    await prisma.appUser.deleteMany({where:{id:{in:users}}})
    check(await prisma.league.count({where:{id:{in:leagues}}})===0 && await prisma.bestBallContest.count({where:{id:{in:contests}}})===0 && await prisma.appUser.count({where:{id:{in:users}}})===0,'EXACT_FIXTURE_CLEANUP')
    console.log('Fixture cleanup verified: zero leagues, contests and users remain')
    await prisma.$disconnect()
  }
}
main().catch(error=>{console.error('Specialty fixture failed:',error.message);process.exitCode=1})
