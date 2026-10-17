// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

const enabled = process.env.RUN_LEAGUE_READINESS_DB === '1'
if (enabled) {
  const target = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/readiness') throw new Error('Readiness integration tests require the disposable local readiness database')
}
vi.mock('@/lib/realtime-events/realtimeEventService', () => ({ publishMatchupLiveTickDebounced: vi.fn() }))
import { prisma } from '@/lib/prisma'
import { runBigBrotherAdminAction } from '@/lib/big-brother/BigBrotherAdminService'
import { runAutomation } from '@/lib/big-brother/BigBrotherAutomationService'
import { transitionPhase } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { setNominations, getFinalNomineeRosterIds } from '@/lib/big-brother/BigBrotherNominationEngine'
import { applyBigBrotherVeto } from '@/lib/big-brother/BigBrotherVetoEngine'
import { getEligibleHOHRosterIds } from '@/lib/big-brother/BigBrotherHOHEngine'
import { getEligibleVoterRosterIds, submitEvictionVote } from '@/lib/big-brother/BigBrotherVoteEngine'
import { submitFinaleVote } from '@/lib/big-brother/BigBrotherJuryEngine'
import { isFinaleReached, runFinaleTallyAndAnnounce } from '@/lib/big-brother/BigBrotherFinaleService'
import { getBigBrotherStandings } from '@/lib/big-brother/BigBrotherStandingsService'
import { getBigBrotherSchedule } from '@/lib/big-brother/BigBrotherScheduleService'
import { runBbReminderSweep } from '@/lib/big-brother/automation/reminders'
import { runBigBrotherAutomationTick } from '@/lib/big-brother/automation/tick'
import { handleBbStatCorrectionSignal } from '@/lib/big-brother/automation/statCorrection'
import { processLeagueWeek } from '@/server/services/weeklyProcessor'

const leagueIds: string[] = [], userIds: string[] = [], playerIds: string[] = []
async function fixture(size = 6, options: { sport?: 'NFL' | 'NCAAF'; finale?: 'final_2' | 'final_3' } = {}) {
  const id = randomUUID()
  const user = await prisma.appUser.create({ data: { email: `${id}@readiness.invalid`, username: `readiness-${id}` } })
  userIds.push(user.id)
  await prisma.tenant.upsert({ where: { id: 'allfantasy' }, create: { id: 'allfantasy', slug: 'allfantasy', name: 'Local integration tests' }, update: {} })
  const league = await prisma.league.create({ data: { userId: user.id, platform: 'allfantasy', platformLeagueId: id, name: 'Isolated readiness fixture', season: 2026, sport: options.sport ?? 'NFL', leagueType: 'big_brother' } })
  leagueIds.push(league.id)
  const config = await prisma.bigBrotherLeagueConfig.create({ data: { leagueId: league.id, challengeMode: 'deterministic_score', autoNominationFallback: 'lowest_season_points', juryStartMode: 'fixed_week', juryStartWeek: 1, finaleFormat: options.finale ?? 'final_2' } })
  const rosters = []
  for (let i = 0; i < size; i++) {
    const roster = await prisma.roster.create({ data: { leagueId: league.id, platformUserId: i === 0 ? user.id : `fixture-${id}-${i}`, playerData: [{ id: `fixture-player-${i}`, slot: 'RB' }], waiverPriority: i + 1 } })
    rosters.push(roster)
    await prisma.leagueTeam.create({ data: { leagueId: league.id, externalId: roster.id, teamName: `Fixture team ${i + 1}`, ownerName: 'Fixture manager', claimedByUserId: i === 0 ? user.id : null } })
  }
  const cycle = await prisma.bigBrotherCycle.create({ data: { leagueId: league.id, configId: config.id, week: 1, phase: 'HOH_OPEN', createdAt: new Date('2026-09-01T00:00:00Z') } })
  return { league, config, rosters, cycle, user }
}
async function clean() {
  for (const id of leagueIds.splice(0)) { await prisma.transactionFact.deleteMany({ where: { leagueId: id } }); await prisma.league.delete({ where: { id } }) }
  for (const id of userIds.splice(0)) await prisma.appUser.delete({ where: { id } })
  if (playerIds.length) await prisma.playerWeeklyScore.deleteMany({ where: { playerId: { in: playerIds.splice(0) } } })
}

describe.runIf(enabled)('five readiness areas against real isolated PostgreSQL', () => {
  beforeAll(async () => { await prisma.$connect() })
  afterEach(clean)
  afterAll(async () => { await prisma.$disconnect() })

  it('waits for all current-season final challenge scores, including legitimate zero scores', async () => {
    const f = await fixture(4)
    const run = () => runAutomation({ leagueId: f.league.id, action: 'auto_hoh' })
    expect((await run()).actionTaken).toBe('skipped_awaiting_final_scores')
    for (let i = 0; i < f.rosters.length; i++) await prisma.teamWeekResult.create({ data: { leagueId: f.league.id, season: 2026, week: 1, rosterId: f.rosters[i].id, totalPoints: i * 10, status: i === 3 ? 'active' : 'final' } })
    expect((await run()).actionTaken).toBe('skipped_awaiting_final_scores')
    expect((await prisma.bigBrotherCycle.findUniqueOrThrow({ where: { id: f.cycle.id } })).hohRosterId).toBeNull()
    await prisma.teamWeekResult.updateMany({ where: { leagueId: f.league.id, season: 2026, week: 1 }, data: { status: 'final' } })
    expect((await run()).actionTaken).toBe('auto_hoh')
    expect((await prisma.bigBrotherCycle.findUniqueOrThrow({ where: { id: f.cycle.id } })).hohRosterId).toBe(f.rosters[3].id)
  })

  it.each(['NFL', 'NCAAF'] as const)('runs a complete %s season: scored HOH, nominations, veto/save/replacement, eviction, jury, final ballot and publication', async sport => {
    const f = await fixture(6, { sport })
    expect((await submitFinaleVote(f.league.id, f.rosters[0].id, f.rosters[1].id)).ok).toBe(false)
    expect((await runAutomation({ leagueId: f.league.id, action: 'close_eviction' })).ok).toBe(false)
    for (let week = 1; week <= 4; week++) {
      let cycle = await prisma.bigBrotherCycle.findFirstOrThrow({ where: { leagueId: f.league.id, week } })
      const eligible = await getEligibleHOHRosterIds(f.league.id, f.config.id, week, false)
      for (let i = 0; i < f.rosters.length; i++) await prisma.teamWeekResult.create({ data: { leagueId: f.league.id, season: 2026, week, rosterId: f.rosters[i].id, totalPoints: i === 0 ? 0 : i === 1 ? -2 : i * 10, status: 'final' } })
      expect((await runAutomation({ leagueId: f.league.id, action: 'auto_hoh' })).ok).toBe(true)
      cycle = await prisma.bigBrotherCycle.findUniqueOrThrow({ where: { id: cycle.id } })
      expect(eligible).toContain(cycle.hohRosterId)
      expect(cycle.phase).toBe('HOH_LOCKED')
      await runAutomation({ leagueId: f.league.id })
      const out = await prisma.bigBrotherCycle.findMany({ where: { leagueId: f.league.id, evictedRosterId: { not: null } } })
      const active = f.rosters.filter(r => !out.some(c => c.evictedRosterId === r.id))
      const nominees = active.filter(r => r.id !== cycle.hohRosterId).slice(0, 2)
      expect((await setNominations(cycle.id, nominees[0].id, 'foreign-roster')).ok).toBe(false)
      expect((await setNominations(cycle.id, nominees[0].id, nominees[1].id)).ok).toBe(true)
      await runAutomation({ leagueId: f.league.id, action: 'auto_nominate' })
      expect(await getFinalNomineeRosterIds(cycle.id)).toEqual(nominees.map(r => r.id))
      await runAutomation({ leagueId: f.league.id })
      await runAutomation({ leagueId: f.league.id, action: 'veto_draw' })
      await runAutomation({ leagueId: f.league.id })
      if (week === 1) {
        expect((await applyBigBrotherVeto(cycle.id, nominees[0].id)).ok).toBe(true)
        expect((await transitionPhase(cycle.id, 'REPLACEMENT_NOMINATION_OPEN')).ok).toBe(true)
        expect((await runAutomation({ leagueId: f.league.id, action: 'auto_replacement' })).ok).toBe(true)
        const finalNoms = await getFinalNomineeRosterIds(cycle.id)
        expect(new Set(finalNoms).size).toBe(2); expect(finalNoms).not.toContain(nominees[0].id)
      } else expect((await runAutomation({ leagueId: f.league.id, action: 'veto_decision_timeout' })).ok).toBe(true)
      const target = (await getFinalNomineeRosterIds(cycle.id))[0]
      const voters = await getEligibleVoterRosterIds(f.league.id, cycle.id, true)
      expect(voters.length).toBeGreaterThan(0)
      for (const voter of voters) expect((await submitEvictionVote(cycle.id, voter, target)).ok).toBe(true)
      const closures = await Promise.all([runAutomation({ leagueId: f.league.id, action: 'close_eviction' }), runAutomation({ leagueId: f.league.id, action: 'close_eviction' })])
      expect(closures.filter(r => r.ok).length).toBe(1)
      expect((await submitEvictionVote(cycle.id, voters[0], target)).ok).toBe(false)
      cycle = await prisma.bigBrotherCycle.findUniqueOrThrow({ where: { id: cycle.id } })
      expect(cycle.phase).toBe('EVICTION_RESOLVED'); expect(cycle.evictedRosterId).toBe(target)
      expect((await prisma.roster.findUniqueOrThrow({ where: { id: target } })).playerData).toEqual([])
      expect(await prisma.bigBrotherJuryMember.count({ where: { leagueId: f.league.id } })).toBe(week)
      if (week < 4) for (let step = 0; step < 3; step++) expect((await runAutomation({ leagueId: f.league.id, now: new Date('2026-10-10') })).ok).toBe(true)
    }
    expect(await isFinaleReached(f.league.id)).toBe(true)
    expect((await runAutomation({ leagueId: f.league.id })).actionTaken).toBe('skipped_finale_ready')
    const evictions = await prisma.bigBrotherCycle.findMany({ where: { leagueId: f.league.id } })
    const finalists = f.rosters.filter(r => !evictions.some(c => c.evictedRosterId === r.id))
    const jury = await prisma.bigBrotherJuryMember.findMany({ where: { leagueId: f.league.id } })
    expect((await runFinaleTallyAndAnnounce(f.league.id)).ok).toBe(false)
    expect((await submitFinaleVote(f.league.id, jury[0].rosterId, jury[1].rosterId)).ok).toBe(false)
    for (let i = 0; i < jury.length; i++) expect((await submitFinaleVote(f.league.id, jury[i].rosterId, finalists[i === 3 ? 1 : 0].id)).ok).toBe(true)
    const published = await runFinaleTallyAndAnnounce(f.league.id)
    expect(published.winnerRosterId).toBe(finalists[0].id)
    expect((await runFinaleTallyAndAnnounce(f.league.id)).winnerRosterId).toBe(published.winnerRosterId)
    expect(await prisma.bigBrotherAuditLog.count({ where: { leagueId: f.league.id, eventType: 'finale_vote' } })).toBe(1)
    expect(await prisma.leagueChatMessage.count({ where: { leagueId: f.league.id, metadata: { path: ['event'], equals: 'finale_winner' } } })).toBe(1)
    expect((await submitFinaleVote(f.league.id, jury[0].rosterId, finalists[1].id)).ok).toBe(false)
    const standings = await getBigBrotherStandings(f.league.id, f.user.id)
    expect(standings?.rows.find(r => r.rosterId === published.winnerRosterId)?.place).toBe(1)
    expect((await getBigBrotherSchedule(f.league.id))?.winnerPublished).toBe(true)
  }, 60_000)

  it('deduplicates concurrent reminders, honors extensions and pauses, catches an overdue Sunday deadline on Monday', async () => {
    const f = await fixture(4)
    const now = new Date('2026-09-27T19:30:00Z')
    await prisma.bigBrotherLeagueConfig.update({ where: { id: f.config.id }, data: { nominationDeadlineDayOfWeek: 7, nominationDeadlineTimeUtc: '20:00', evictionVoteCloseDayOfWeek: 7, evictionVoteCloseTimeUtc: '22:00' } })
    await prisma.bigBrotherCycle.update({ where: { id: f.cycle.id }, data: { phase: 'NOMINATION_OPEN', createdAt: new Date('2026-09-27T18:00:00Z'), hohRosterId: f.rosters[0].id } })
    const dry = await runBbReminderSweep({ now, dryRun: true }); expect(dry.remindersScheduled).toBe(1)
    expect(await prisma.leagueChatMessage.count({ where: { leagueId: f.league.id } })).toBe(0)
    const sends = await Promise.all([runBbReminderSweep({ now }), runBbReminderSweep({ now })])
    expect(sends.reduce((n, r) => n + r.remindersScheduled, 0)).toBe(1)
    expect((await runBbReminderSweep({ now })).remindersScheduled).toBe(0)
    const message = await prisma.leagueChatMessage.findFirstOrThrow({ where: { leagueId: f.league.id } })
    expect(message.userId).toBe(f.user.id); expect((message.metadata as any).chimmy).toBe(true)
    await prisma.bigBrotherCycle.update({ where: { id: f.cycle.id }, data: { phase: 'VOTING_OPEN', nominee1RosterId: f.rosters[1].id, nominee2RosterId: f.rosters[2].id, voteDeadlineAt: new Date('2026-09-28T12:00:00Z') } })
    const schedule = await getBigBrotherSchedule(f.league.id)
    expect(schedule?.weeks[0].events.find(e => e.key === 'eviction')?.deadlineAt).toBe('2026-09-28T12:00:00.000Z')
    expect((await runBigBrotherAutomationTick({ now: new Date('2026-09-28T01:00Z'), forceLeagueId: f.league.id })).skipped).toBe(1)
    await prisma.bigBrotherLeagueConfig.update({ where: { id: f.config.id }, data: { weekProgressionPaused: true } })
    expect((await runBbReminderSweep({ now })).remindersScheduled).toBe(0)
    expect((await runBigBrotherAutomationTick({ now: new Date('2026-09-29'), forceLeagueId: f.league.id })).processed).toBe(0)
    await prisma.bigBrotherLeagueConfig.update({ where: { id: f.config.id }, data: { weekProgressionPaused: false } })
    await prisma.bigBrotherCycle.update({ where: { id: f.cycle.id }, data: { voteDeadlineAt: null } })
    await prisma.bigBrotherEvictionVote.create({ data: { cycleId: f.cycle.id, voterRosterId: f.rosters[3].id, targetRosterId: f.rosters[1].id } })
    const caughtUp = await runBigBrotherAutomationTick({ now: new Date('2026-09-28T01:00Z'), forceLeagueId: f.league.id })
    expect(caughtUp.processed).toBe(1)
    expect((await prisma.bigBrotherCycle.findUniqueOrThrow({ where: { id: f.cycle.id } })).phase).toBe('EVICTION_RESOLVED')
  })

  it('resolves an HOH contingency tie ballot and reopens an unresolved vote with a future deadline', async () => {
    const f=await fixture(5)
    await prisma.bigBrotherLeagueConfig.update({where:{id:f.config.id},data:{evictionTieBreakMode:'hoh_vote'}})
    await prisma.bigBrotherCycle.update({where:{id:f.cycle.id},data:{phase:'VOTING_OPEN',hohRosterId:f.rosters[0].id,nominee1RosterId:f.rosters[1].id,nominee2RosterId:f.rosters[2].id}})
    const {closeEviction}=await import('@/lib/big-brother/BigBrotherEvictionService')
    expect((await closeEviction(f.cycle.id)).ok).toBe(false)
    const recovered=await runBigBrotherAdminAction({leagueId:f.league.id,action:'extend_vote_window',params:{minutes:60}})
    expect(recovered.ok).toBe(true)
    expect((await prisma.bigBrotherCycle.findUniqueOrThrow({where:{id:f.cycle.id}})).voteDeadlineAt!.getTime()).toBeGreaterThan(Date.now())
    expect((await submitEvictionVote(f.cycle.id,f.rosters[3].id,f.rosters[1].id)).ok).toBe(true)
    expect((await submitEvictionVote(f.cycle.id,f.rosters[4].id,f.rosters[2].id)).ok).toBe(true)
    expect((await submitEvictionVote(f.cycle.id,f.rosters[0].id,f.rosters[2].id)).ok).toBe(true)
    const closed=await closeEviction(f.cycle.id)
    expect(closed.ok).toBe(true);expect(closed.result?.evictedRosterId).toBe(f.rosters[2].id)
    expect(closed.result?.voteCount).toEqual({[f.rosters[1].id]:1,[f.rosters[2].id]:1})
  })
  it('allows a commissioner to resolve only an actual configured tie', async () => {
    const f=await fixture(5)
    await prisma.bigBrotherLeagueConfig.update({where:{id:f.config.id},data:{evictionTieBreakMode:'commissioner'}})
    await prisma.bigBrotherCycle.update({where:{id:f.cycle.id},data:{phase:'VOTING_OPEN',hohRosterId:f.rosters[0].id,nominee1RosterId:f.rosters[1].id,nominee2RosterId:f.rosters[2].id}})
    await submitEvictionVote(f.cycle.id,f.rosters[3].id,f.rosters[1].id)
    await submitEvictionVote(f.cycle.id,f.rosters[4].id,f.rosters[2].id)
    expect((await runAutomation({leagueId:f.league.id,action:'close_eviction'})).ok).toBe(false)
    expect((await runBigBrotherAdminAction({leagueId:f.league.id,action:'resolve_eviction_tie',params:{rosterId:f.rosters[4].id}})).ok).toBe(false)
    expect((await runBigBrotherAdminAction({leagueId:f.league.id,action:'resolve_eviction_tie',params:{rosterId:f.rosters[2].id}})).ok).toBe(true)
    expect((await prisma.bigBrotherCycle.findUniqueOrThrow({where:{id:f.cycle.id}})).evictedRosterId).toBe(f.rosters[2].id)
  })
  it('gates a final-three finale and refuses to publish incomplete or tied jury ballots', async () => {
    const f=await fixture(5,{finale:'final_3'})
    for(let i=0;i<2;i++) {
      if(i===0) await prisma.bigBrotherCycle.update({where:{id:f.cycle.id},data:{evictedRosterId:f.rosters[i].id,closedAt:new Date(),phase:'EVICTION_RESOLVED'}})
      else await prisma.bigBrotherCycle.create({data:{leagueId:f.league.id,configId:f.config.id,week:2,evictedRosterId:f.rosters[i].id,closedAt:new Date(),phase:'EVICTION_RESOLVED'}})
      await prisma.bigBrotherJuryMember.create({data:{leagueId:f.league.id,configId:f.config.id,rosterId:f.rosters[i].id,evictedWeek:i+1}})
    }
    expect(await isFinaleReached(f.league.id)).toBe(true)
    expect((await submitFinaleVote(f.league.id,f.rosters[0].id,f.rosters[2].id)).ok).toBe(true)
    expect((await runFinaleTallyAndAnnounce(f.league.id)).ok).toBe(false)
    expect((await submitFinaleVote(f.league.id,f.rosters[1].id,f.rosters[3].id)).ok).toBe(true)
    expect((await runFinaleTallyAndAnnounce(f.league.id)).ok).toBe(false)
    expect(await prisma.bigBrotherAuditLog.count({where:{leagueId:f.league.id,eventType:'finale_vote'}})).toBe(0)
    expect((await submitFinaleVote(f.league.id,f.rosters[1].id,f.rosters[2].id)).ok).toBe(true)
    expect((await runFinaleTallyAndAnnounce(f.league.id)).winnerRosterId).toBe(f.rosters[2].id)
  })
  it('keeps missing stats active, excludes unfinished opponents, recomputes corrections from the original lineup, and notices a revision once', async () => {
    const f = await fixture(2)
    for (let i = 0; i < 2; i++) {
      const playerId = `readiness-player-${randomUUID()}`; playerIds.push(playerId)
      await prisma.roster.update({ where: { id: f.rosters[i].id }, data: { playerData: [{ id: playerId, slot: 'RB' }] } })
      await prisma.playerWeeklyScore.create({ data: { playerId, sport: 'NFL', season: 2026, week: 1, stats: { rushing_yards: i === 0 ? 100 : 50, rushing_td: i === 0 ? 1 : 0 }, isFinalized: false } })
    }
    await processLeagueWeek({ leagueId: f.league.id, season: 2026, week: 1 })
    expect(await prisma.teamWeekResult.count({ where: { leagueId: f.league.id, status: 'active' } })).toBe(2)
    expect((await getBigBrotherStandings(f.league.id, f.user.id))?.rows.every(r => r.processedPoints === null)).toBe(true)
    await prisma.playerWeeklyScore.updateMany({ where: { playerId: { in: playerIds } }, data: { isFinalized: true } })
    await processLeagueWeek({ leagueId: f.league.id, season: 2026, week: 1 })
    const result = await prisma.teamWeekResult.findMany({ where: { leagueId: f.league.id }, orderBy: { totalPoints: 'desc' } })
    expect(result.map(r => r.totalPoints)).toEqual([16, 5]); expect(result.map(r => r.winLoss)).toEqual(['W', 'L'])
    // A completed cycle is immutable; its fantasy totals can still be corrected.
    await prisma.bigBrotherCycle.update({ where: { id: f.cycle.id }, data: { phase: 'EVICTION_RESOLVED', closedAt: new Date(), hohRosterId: f.rosters[0].id, evictedRosterId: f.rosters[1].id } })
    await handleBbStatCorrectionSignal({ leagueId: f.league.id, week: 1 }) // baseline only
    expect(await prisma.leagueChatMessage.count({ where: { leagueId: f.league.id, messageSubtype: 'bb_stat_correction' } })).toBe(0)
    await prisma.roster.update({ where: { id: f.rosters[0].id }, data: { playerData: [] } })
    await prisma.playerWeeklyScore.update({ where: { playerId_week_season_sport: { playerId: playerIds[0], season: 2026, week: 1, sport: 'NFL' } }, data: { stats: { rushing_yards: 200, rushing_td: 1 } } })
    await processLeagueWeek({ leagueId: f.league.id, season: 2026, week: 1 })
    expect((await prisma.teamWeekResult.findUniqueOrThrow({ where: { leagueId_season_week_rosterId: { leagueId: f.league.id, season: 2026, week: 1, rosterId: f.rosters[0].id } } })).totalPoints).toBe(26)
    expect((await getBigBrotherStandings(f.league.id, f.user.id))?.rows.find(r => r.rosterId === f.rosters[0].id)?.processedPoints).toBe(26)
    await handleBbStatCorrectionSignal({ leagueId: f.league.id, week: 1 })
    await processLeagueWeek({ leagueId: f.league.id, season: 2026, week: 1 })
    expect(await prisma.leagueChatMessage.count({ where: { leagueId: f.league.id, messageSubtype: 'bb_stat_correction' } })).toBe(1)
    const unchanged = await prisma.bigBrotherCycle.findUniqueOrThrow({ where: { id: f.cycle.id } })
    expect(unchanged.hohRosterId).toBe(f.rosters[0].id); expect(unchanged.evictedRosterId).toBe(f.rosters[1].id)
  }, 60_000)
})
