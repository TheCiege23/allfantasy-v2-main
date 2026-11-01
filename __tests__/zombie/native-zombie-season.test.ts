import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A NATIVE ZOMBIE LEAGUE NEVER RAN A WEEK. Nothing set `status: 'active'`, nothing seeded its
 * teams or picked the Whisperer, a resolved week pointed the league at the SAME week (so it stalled
 * after week 1), and infection read the import warehouse, which nothing writes for a league made
 * in the app. These pin each of those.
 */

/** Prisma double: every delegate method resolves to a harmless default unless overridden. */
const overrides = vi.hoisted(() => new Map<string, (...a: unknown[]) => unknown>())
const calls = vi.hoisted(() => [] as Array<{ key: string; args: unknown }>)
vi.mock('@/lib/prisma', () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => async (args: unknown) => {
          const key = `${name}.${method}`
          calls.push({ key, args })
          const o = overrides.get(key)
          if (o) return o(args)
          if (method === 'findMany') return []
          if (method === 'count') return 0
          if (method === 'aggregate') return { _sum: {} }
          if (method.startsWith('update') || method.startsWith('create') || method === 'upsert') return { count: 1 }
          return null
        },
      },
    )
  const db = new Proxy({}, { get: (_t, prop: string) => prop === '$queryRaw' ? async () => [] : prop === '$transaction' ? async (callback: (tx: unknown) => Promise<unknown>) => callback(db) : model(prop) })
  return { prisma: db }
})

const m = vi.hoisted(() => ({
  ensureLeagueTeamRows: vi.fn(),
  selectWhisperer: vi.fn(),
  getZombieLeagueConfig: vi.fn(),
}))
vi.mock('@/lib/zombie/ZombieOwnerStatusService', async (orig) => ({
  ...(await orig<typeof import('@/lib/zombie/ZombieOwnerStatusService')>()),
  ensureLeagueTeamRows: m.ensureLeagueTeamRows,
}))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({ getZombieLeagueConfig: m.getZombieLeagueConfig }))

// Weekly resolution's collaborators — this suite pins only where the week pointer lands.
vi.mock('@/lib/zombie/beta2025ItemService', () => ({ usesBeta2025Items: () => false, refreshItemScores: vi.fn() }))
vi.mock('@/lib/zombie/weeklySettlementSnapshot', async orig => {
  const actual = await orig<typeof import('@/lib/zombie/weeklySettlementSnapshot')>()
  return { ...actual, captureZombieSettlementSnapshot: vi.fn(async (leagueId: string, id: string, _sport: string, week: number, season: number) => {
    // This suite pins winnings and progression for pre-item-policy snapshots.
    const snapshot = await actual.captureZombieSettlementSnapshot(leagueId, id, 'NBA', week, season)
    return { ...snapshot, rules: { ...snapshot.rules, bashingThreshold: 60, maulingThreshold: 60 } }
  }) }
})
vi.mock('@/lib/zombie/infectionEngine', () => ({ resolveWeeklyInfections: vi.fn(async () => ({ infectionsCreated: 0 })) }))
vi.mock('@/lib/zombie/serumEngine', () => ({
  finalizePendingSerumsForWeek: vi.fn(async () => undefined),
  autoReviveEligibleZombies: vi.fn(async () => undefined),
  awardNativeSerumsForWeek: vi.fn(async () => undefined),
}))
vi.mock('@/lib/zombie/bashingEngine', () => ({ detectAndProcessBashings: vi.fn(async () => []) }))
vi.mock('@/lib/zombie/maulingEngine', () => ({ detectAndProcessMaulings: vi.fn(async () => []) }))
vi.mock('@/lib/zombie/weaponEngine', () => ({
  checkAndAwardWeapons: vi.fn(async () => undefined),
  finalizePendingWeaponsForWeek: vi.fn(async () => undefined),
}))
vi.mock('@/lib/zombie/weeklyUpdateEngine', () => ({ tryPostWeeklyUpdateAfterResolution: vi.fn(async () => undefined) }))
vi.mock('@/lib/zombie/universeStatEngine', () => ({ syncUniverseStats: vi.fn(async () => undefined) }))
vi.mock('@/lib/zombie/commissionerNotificationService', () => ({ notifyCommissioner: vi.fn(async () => undefined), notifyZombiePlayer: vi.fn(async () => undefined) }))
vi.mock('@/lib/zombie/matchupCompletion', async (orig) => ({
  ...(await orig<typeof import('@/lib/zombie/matchupCompletion')>()),
}))
vi.mock('@/lib/zombie/auditService', () => ({ logAuditEntry: vi.fn(async () => undefined) }))
vi.mock('@/lib/zombie/zombieLeagueMode', () => ({ getLeagueMode: () => 'standard' }))
vi.mock('@/lib/zombie/ZombieHordeSitOutEngine', () => ({ applyZombieHordeSitOutToScoring: vi.fn(async () => ({ sitOutExcludedUserIds: [], hordeScoreBeforeSitOut: 0, hordeScoreAfterSitOut: 0 })) }))
vi.mock('@/lib/zombie/animationEngine', () => ({ queueAnimation: vi.fn(async () => undefined) }))

import { ensureZombieSeasonActivated } from '@/lib/zombie/activateNativeZombieLeague'
import { runWeeklyResolution } from '@/lib/zombie/weeklyResolutionEngine'
import { getNativeMatchupOutcomes } from '@/lib/zombie/ZombieInfectionEngine'
import { checkAllMatchupsComplete } from '@/lib/zombie/matchupCompletion'
import { selectSecondWhisperer, selectWhisperer } from '@/lib/zombie/whispererEngine'

const argsOf = (key: string) => calls.filter((c) => c.key === key).map((c) => c.args as Record<string, any>)

beforeEach(() => {
  vi.clearAllMocks()
  overrides.clear()
  calls.length = 0
  m.getZombieLeagueConfig.mockResolvedValue({ whispererSelection: 'random' })
})

describe('ensureZombieSeasonActivated', () => {
  beforeEach(() => {
    overrides.set('zombieLeague.findUnique', async () => ({ id: 'z1', status: 'setup' }))
    overrides.set('redraftSeason.findFirst', async () => ({ season: 2026, totalWeeks: 17 }))
  })

  it('seeds the teams, picks the Whisperer and starts the league on the draft’s season', async () => {
    const withWhisperer = vi.spyOn(await import('@/lib/zombie/whispererEngine'), 'selectWhisperer').mockResolvedValue({ whispererRecordId: 'w', rosterId: 'R1' })

    const r = await ensureZombieSeasonActivated({ leagueId: 'L1', redraftSeasonId: 's1' })

    expect(r).toEqual({ ok: true, activated: true, whispererPicked: true, zombieLeagueId: 'z1' })
    expect(m.ensureLeagueTeamRows).toHaveBeenCalledWith('L1', 'z1')
    expect(withWhisperer).toHaveBeenCalledWith('z1', 'random')
    expect(argsOf('zombieLeague.updateMany')[0]).toMatchObject({
      where: { id: 'z1', status: { in: ['setup', 'registering'] } },
      data: { status: 'active', season: 2026, totalWeeks: 17, currentWeek: 1 },
    })
    withWhisperer.mockRestore()
  })

  it('ends the zombie season at the last scheduled week, not at totalWeeks (NBA: 22 weeks, schedule ends at 19)', async () => {
    overrides.set('redraftSeason.findFirst', async () => ({ season: 2026, totalWeeks: 22 }))
    // The schedule's last week is 19; its first is 1 (drafted before the season).
    overrides.set('redraftMatchup.findFirst', async (args: any) => ({ week: args?.orderBy?.week === 'asc' ? 1 : 19 }))
    const spy = vi.spyOn(await import('@/lib/zombie/whispererEngine'), 'selectWhisperer').mockResolvedValue({ whispererRecordId: 'w', rosterId: 'R1' })

    await ensureZombieSeasonActivated({ leagueId: 'L1', redraftSeasonId: 's1' })

    expect(argsOf('zombieLeague.updateMany')[0].data).toMatchObject({ status: 'active', season: 2026, totalWeeks: 19, currentWeek: 1 })
    expect(argsOf('redraftMatchup.findFirst')[0]).toMatchObject({ where: { seasonId: 's1', awayRosterId: { not: null } } })
    spy.mockRestore()
  })

  /*
   * 🛑 A LEAGUE DRAFTED MID-SEASON STARTED AT WEEK 1 AND NEVER LEFT IT. Its schedule now begins at the
   * sport's current week, and the zombie league must begin there too — week 1 has no matchups.
   */
  it('a league drafted mid-season starts on its first scheduled week, not week 1', async () => {
    overrides.set('redraftSeason.findFirst', async () => ({ season: 2026, totalWeeks: 22 }))
    overrides.set('redraftMatchup.findFirst', async (args: any) => ({ week: args?.orderBy?.week === 'asc' ? 6 : 19 }))
    const spy = vi.spyOn(await import('@/lib/zombie/whispererEngine'), 'selectWhisperer').mockResolvedValue({ whispererRecordId: 'w', rosterId: 'R1' })

    await ensureZombieSeasonActivated({ leagueId: 'L1', redraftSeasonId: 's1' })

    expect(argsOf('zombieLeague.updateMany')[0].data).toMatchObject({ status: 'active', season: 2026, totalWeeks: 19, currentWeek: 6 })
    spy.mockRestore()
  })

  it('[control] with no schedule yet it still starts at week 1', async () => {
    const spy = vi.spyOn(await import('@/lib/zombie/whispererEngine'), 'selectWhisperer').mockResolvedValue({ whispererRecordId: 'w', rosterId: 'R1' })
    await ensureZombieSeasonActivated({ leagueId: 'L1', redraftSeasonId: 's1' })
    expect(argsOf('zombieLeague.updateMany')[0].data).toMatchObject({ currentWeek: 1 })
    spy.mockRestore()
  })

  it('never re-picks a Whisperer (a re-pick resets ambushes and re-rolls the role)', async () => {
    overrides.set('whispererRecord.findUnique', async () => ({ id: 'existing' }))
    const spy = vi.spyOn(await import('@/lib/zombie/whispererEngine'), 'selectWhisperer')

    const r = await ensureZombieSeasonActivated({ leagueId: 'L1', redraftSeasonId: 's1' })

    expect(r).toMatchObject({ ok: true, whispererPicked: false })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('leaves a paused (or finished) league alone', async () => {
    overrides.set('zombieLeague.findUnique', async () => ({ id: 'z1', status: 'paused' }))
    expect(await ensureZombieSeasonActivated({ leagueId: 'L1', redraftSeasonId: 's1' })).toEqual({ ok: false, reason: 'NOT_STARTABLE' })
    expect(m.ensureLeagueTeamRows).not.toHaveBeenCalled()
    expect(argsOf('zombieLeague.updateMany')).toHaveLength(0)
  })

  it('does nothing for a league that is not zombie', async () => {
    overrides.set('zombieLeague.findUnique', async () => null)
    expect(await ensureZombieSeasonActivated({ leagueId: 'L1', redraftSeasonId: 's1' })).toEqual({ ok: false, reason: 'NOT_ZOMBIE' })
  })
})

describe('runWeeklyResolution — the league moves on to the next week', () => {
  /** A zombie league whose resolving week has every matchup final, scheduled through `lastScheduledWeek`. */
  function arrange(currentWeek: number, totalWeeks = 17, lastScheduledWeek = totalWeeks) {
    overrides.set('zombieLeague.findUnique', async () => ({
      id: 'z1', leagueId: 'L1', sport: 'NFL', season: 2026, currentWeek, totalWeeks, universeId: null, league: {},
    }))
    overrides.set('redraftSeason.findFirst', async () => ({ id: 's1' }))
    overrides.set('redraftMatchup.findMany', async () => [
      { homeRosterId: 'r1', awayRosterId: 'r2', homeScore: 100, awayScore: 90, status: 'final' },
    ])
    overrides.set('redraftMatchup.findFirst', async () => ({ week: lastScheduledWeek }))
  }
  const leagueUpdate = () => argsOf('zombieLeague.update').at(-1)!

  for (const sport of ['NFL', 'NBA', 'NHL', 'MLB']) {
    it(`resolves a final native ${sport} week and advances independently`, async () => {
      arrange(3)
      overrides.set('zombieLeague.findUnique', async () => ({
        id: 'z1', leagueId: 'L1', sport, season: 2026, currentWeek: 3,
        totalWeeks: sport === 'NFL' ? 17 : 23, universeId: null, league: {},
      }))
      const result = await runWeeklyResolution('z1', 3)
      expect(result.resolution).toBeTruthy()
      expect(argsOf('zombieWeeklyResolution.update').at(-1)?.data.status).toBe('complete')
      expect(leagueUpdate().data.currentWeek).toBe(4)
    })
  }

  it('holds a league with an old-policy winnings ledger before weekly side effects', async () => {
    arrange(3)
    overrides.set('zombieWeeklyWinnings.findMany', async () => [{ rosterId: 'a', amount: 100, source: 'weekly_settlement' }])
    const result = await runWeeklyResolution('z1', 3)
    expect(result).toMatchObject({ skipped: true, reason: 'winnings_policy_review_required' })
    expect(argsOf('zombieWeeklyResolution.upsert')[0].create).toMatchObject({ status: 'review_required' })
    expect(argsOf('zombieLeague.update')).toEqual([])
    expect(argsOf('zombieWeeklyWinnings.upsert')).toEqual([])
  })

  it('points the league at the week after the one it resolved', async () => {
    arrange(3)
    await runWeeklyResolution('z1', 3, { force: true })
    expect(leagueUpdate().data).toEqual({ currentWeek: 4 })
    // …and the season's own pointer, which the hourly roll never moves for zombie.
    expect(argsOf('redraftSeason.updateMany').at(-1)).toEqual({
      where: { leagueId: 'L1', season: 2026, currentWeek: { lt: 4 } },
      data: { currentWeek: 4 },
    })
  })

  it('a replayed older week never drags the pointer back', async () => {
    arrange(6)
    await runWeeklyResolution('z1', 2, { force: true })
    expect(leagueUpdate().data).toEqual({ currentWeek: 6 })
  })

  it('the last week finishes the league', async () => {
    arrange(17)
    await runWeeklyResolution('z1', 17, { force: true })
    expect(leagueUpdate().data).toEqual({ currentWeek: 17, status: 'complete' })
  })

  /*
   * 🛑 NBA: `totalWeeks` 22, playoffs from week 20, so the schedule stops at week 19. Ending at
   * `totalWeeks` parked the league on week 20 — no matchups, never "complete", no winner, forever.
   */
  it('the last SCHEDULED week finishes the league, even when totalWeeks runs into the playoffs', async () => {
    arrange(19, 22, 19)
    await runWeeklyResolution('z1', 19)
    expect(leagueUpdate().data).toEqual({ currentWeek: 19, status: 'complete' })
  })

  it('[control] a mid-season week under the same schedule does not finish it', async () => {
    arrange(18, 22, 19)
    await runWeeklyResolution('z1', 18)
    expect(leagueUpdate().data).toEqual({ currentWeek: 19 })
  })

  /*
   * 🛑 `force` used to skip the finished-matchups gate. The infection engine reads only final scores,
   * so a forced unfinished week resolved nothing, wrote "complete", and moved the league on.
   */
  it('a forced run on a week whose matchups are not final is refused, and the league does not move', async () => {
    arrange(5)
    overrides.set('redraftMatchup.findMany', async () => [
      { homeRosterId: 'r1', awayRosterId: 'r2', homeScore: 40, awayScore: 30, status: 'active' },
    ])
    const r = await runWeeklyResolution('z1', 5, { force: true })
    expect(r).toEqual({ resolution: null, skipped: true, reason: 'matchups_incomplete' })
    expect(argsOf('zombieLeague.update')).toHaveLength(0)
    expect(argsOf('zombieWeeklyResolution.upsert')).toHaveLength(0)
  })

  /*
   * 🛑 Weekly winnings were never written for a native league. A resolved week now banks each team's
   * score in the ledger — here an NBA 1,000 v 850 win, a bashing (150 ≥ 128), moves 25% of the loser's week.
   */
  it('a resolved week records the 2025 award and cumulative loot rather than fantasy scores', async () => {
    overrides.set('zombieLeague.findUnique', async () => ({
      id: 'z1', leagueId: 'L1', season: 2026, sport: 'NBA', currentWeek: 5, totalWeeks: 19, universeId: null, league: {},
    }))
    overrides.set('redraftSeason.findFirst', async () => ({ id: 's1' }))
    overrides.set('redraftMatchup.findMany', async () => [
      { id: 'm1', homeRosterId: 'r1', awayRosterId: 'r2', homeScore: 1000, awayScore: 850, status: 'final' },
    ])
    overrides.set('redraftMatchup.findFirst', async () => ({ week: 19 }))
    overrides.set('roster.findMany', async () => [
      { id: 'R1', platformUserId: 'u1', redraftRosterId: 'r1' },
      { id: 'R2', platformUserId: 'u2', redraftRosterId: 'r2' },
    ])

    let savedSnapshot: unknown
    overrides.set('zombieLeagueTeam.findMany', async () => [
      { id: 't1', rosterId: 'R1', status: 'Survivor' }, { id: 't2', rosterId: 'R2', status: 'Survivor' },
    ])
    overrides.set('zombieWeeklyWinnings.findMany', async () => [{ rosterId: 'R2', amount: 10, source: 'weekly_settlement_2025' }])
    overrides.set('zombieWeeklyResolution.upsert', async (args: any) => {
      savedSnapshot = args.create.settlementSnapshot
      return { id: 'resolution', settlementSnapshot: savedSnapshot }
    })
    overrides.set('zombieWeeklyResolution.findUnique', async () => savedSnapshot ? { settlementSnapshot: savedSnapshot } : null)
    await runWeeklyResolution('z1', 5)

    const ledger = argsOf('zombieWeeklyWinnings.upsert').map((a) => [a.create.rosterId, a.create.amount])
    expect(ledger).toEqual([['R1', 12], ['R2', -10]])
  })
})

describe('native infection results', () => {
  it('reads the league’s own final matchups, in zombie roster space', async () => {
    overrides.set('redraftSeason.findFirst', async () => ({ id: 's1' }))
    overrides.set('redraftMatchup.findMany', async () => [
      { id: 'm1', homeRosterId: 'rr-a', awayRosterId: 'rr-b', homeScore: 120, awayScore: 90, status: 'final' },
      { id: 'm2', homeRosterId: 'rr-c', awayRosterId: 'rr-d', homeScore: 80, awayScore: 101, status: 'final' },
      { id: 'm3', homeRosterId: 'rr-a', awayRosterId: 'rr-c', homeScore: 90, awayScore: 90, status: 'final' }, // tie
      { id: 'm4', homeRosterId: 'rr-b', awayRosterId: 'rr-d', homeScore: 50, awayScore: 10, status: 'active' }, // not final
      { id: 'm5', homeRosterId: 'rr-e', awayRosterId: null, homeScore: 70, awayScore: null, status: 'final' }, // bye
    ])
    overrides.set('redraftRoster.findMany', async () => [
      { id: 'rr-a', ownerId: 'user-a' },
      { id: 'rr-b', ownerId: 'user-b' },
      { id: 'rr-c', ownerId: 'roster:R-c' },
      { id: 'rr-d', ownerId: 'user-d' },
    ])
    overrides.set('roster.findMany', async () => [
      { id: 'R-a', platformUserId: 'user-a', redraftRosterId: null },
      { id: 'R-b', platformUserId: 'user-b', redraftRosterId: null },
      { id: 'R-c', platformUserId: 'open-slot-3', redraftRosterId: null },
      { id: 'R-d', platformUserId: 'someone-else', redraftRosterId: 'rr-d' }, // the stored link wins
    ])

    expect(await getNativeMatchupOutcomes('L1', 4, 2026)).toEqual([
      { matchupId: 'm1', winnerRosterId: 'R-a', loserRosterId: 'R-b' },
      { matchupId: 'm2', winnerRosterId: 'R-d', loserRosterId: 'R-c' },
    ])
  })

  it('a Survivor who loses to a Zombie in a native league is infected', async () => {
    m.getZombieLeagueConfig.mockResolvedValue({ infectionLossToWhisperer: true, infectionLossToZombie: true })
    overrides.set('zombieLeagueTeam.findMany', async () => [
      { rosterId: 'R-a', status: 'Zombie' },
      { rosterId: 'R-b', status: 'Survivor' },
    ])
    overrides.set('redraftSeason.findFirst', async () => ({ id: 's1' }))
    overrides.set('redraftMatchup.findMany', async () => [
      { id: 'm1', homeRosterId: 'rr-a', awayRosterId: 'rr-b', homeScore: 120, awayScore: 90, status: 'final' },
    ])
    overrides.set('redraftRoster.findMany', async () => [
      { id: 'rr-a', ownerId: 'user-a' },
      { id: 'rr-b', ownerId: 'user-b' },
    ])
    overrides.set('roster.findMany', async () => [
      { id: 'R-a', platformUserId: 'user-a', redraftRosterId: null },
      { id: 'R-b', platformUserId: 'user-b', redraftRosterId: null },
    ])
    const { computeInfections } = await import('@/lib/zombie/ZombieInfectionEngine')

    const outcome = await computeInfections({ leagueId: 'L1', week: 4, season: 2026 })

    expect(outcome.infected).toEqual([{ survivorRosterId: 'R-b', infectedByRosterId: 'R-a', matchupId: 'm1' }])
    // The import warehouse is not consulted for a league with its own season.
    expect(argsOf('matchupFact.findMany')).toHaveLength(0)
  })

  it('is null for a league with no native season, so the warehouse path still serves imports', async () => {
    expect(await getNativeMatchupOutcomes('L1', 4, 2026)).toBeNull()
  })
})

describe('checkAllMatchupsComplete — odd-sized leagues', () => {
  it('a bye does not hold the week open', async () => {
    overrides.set('redraftSeason.findFirst', async () => ({ id: 's1' }))
    overrides.set('redraftMatchup.findMany', async () => [
      { awayRosterId: 'r2', status: 'final' },
      { awayRosterId: null, status: 'scheduled' },
    ])
    expect(await checkAllMatchupsComplete('L1', 3, 2026)).toBe(true)
  })
})

describe('two independent Whisperers', () => {
  it('chooses a distinct managed Survivor for the second NBA seat', async () => {
    overrides.set('zombieLeague.findUniqueOrThrow', async () => ({
      id: 'z1', leagueId: 'L1', sport: 'NBA', whispererCount: 2,
      experienceMode: 'enhanced', whispererAmbushCount: 3, whispererIsPublic: false,
    }))
    overrides.set('whispererRecord.findUnique', async () => ({ userId: 'primary' }))
    overrides.set('zombieLeagueTeam.findMany', async () => [
      { rosterId: 'R-primary', status: 'Whisperer' },
      { rosterId: 'R-second', status: 'Survivor', isVeteran: false },
      { rosterId: 'R-open', status: 'Survivor', isVeteran: false },
    ])
    overrides.set('roster.findMany', async () => [
      { id: 'R-primary', platformUserId: 'primary' },
      { id: 'R-second', platformUserId: 'second' },
      { id: 'R-open', platformUserId: 'open-slot-L1-3' },
    ])
    overrides.set('zombieCoWhisperer.create', async () => ({ id: 'co-1' }))
    const chosen = await selectSecondWhisperer('z1', 'random')
    expect(chosen).toEqual({ whispererRecordId: 'co-1', rosterId: 'R-second' })
    expect(argsOf('zombieCoWhisperer.create')[0].data).toMatchObject({
      zombieLeagueId: 'z1', userId: 'second', ambushesRemaining: 3,
    })
    expect(argsOf('zombieLeagueTeam.update')[0].data).toMatchObject({ status: 'Whisperer', isWhisperer: true })
  })
})

describe('selectWhisperer', () => {
  it('draws from managed teams, never an open seat, when any exist', async () => {
    overrides.set('zombieLeague.findUniqueOrThrow', async () => ({ id: 'z1', leagueId: 'L1', whispererAmbushCount: 3, league: {} }))
    overrides.set('zombieLeagueTeam.findMany', async () => [{ rosterId: 'R-open' }, { rosterId: 'R-human' }, { rosterId: 'R-orphan' }])
    overrides.set('roster.findMany', async () => [
      { id: 'R-open', platformUserId: 'open-slot-L1-2' },
      { id: 'R-human', platformUserId: 'user-1' },
      { id: 'R-orphan', platformUserId: 'orphan-R-orphan' },
    ])
    overrides.set('roster.findUnique', async () => ({ platformUserId: 'user-1' }))
    for (let i = 0; i < 5; i++) {
      const r = await selectWhisperer('z1', 'random')
      expect(r.rosterId).toBe('R-human')
    }
  })

  it("records the Whisperer's name — the person's, else the team's, never their user id", async () => {
    overrides.set('zombieLeague.findUniqueOrThrow', async () => ({ id: 'z1', leagueId: 'L1', whispererAmbushCount: 3, league: {} }))
    overrides.set('zombieLeagueTeam.findMany', async () => [{ rosterId: 'R-human' }])
    overrides.set('roster.findMany', async () => [{ id: 'R-human', platformUserId: 'user-1', playerData: null }])
    overrides.set('roster.findUnique', async () => ({ platformUserId: 'user-1' }))
    const upsertName = () =>
      (calls.filter((c) => c.key === 'whispererRecord.upsert').at(-1)?.args as { create: { displayName: string } }).create.displayName

    // AppUser.displayName is usually null — the case that used to store the uid.
    overrides.set('appUser.findUnique', async () => ({ displayName: null, username: 'guap' }))
    await selectWhisperer('z1', 'random')
    expect(upsertName()).toBe('guap')

    // Nobody resolvable: the team's name.
    overrides.set('appUser.findUnique', async () => null)
    overrides.set('leagueTeam.findMany', async () => [
      { id: 't1', externalId: 'x', platformUserId: 'user-1', claimedByUserId: null, teamName: 'Brain Drain', ownerName: '' },
    ])
    await selectWhisperer('z1', 'random')
    expect(upsertName()).toBe('Brain Drain')

    // Nothing at all: the role.
    overrides.set('leagueTeam.findMany', async () => [])
    await selectWhisperer('z1', 'random')
    expect(upsertName()).toBe('The Whisperer')
  })

  it('tells the chosen manager, and only them, that they are the Whisperer', async () => {
    const { notifyZombiePlayer } = await import('@/lib/zombie/commissionerNotificationService')
    vi.mocked(notifyZombiePlayer).mockClear()
    overrides.set('zombieLeague.findUniqueOrThrow', async () => ({
      id: 'z1', leagueId: 'L1', whispererAmbushCount: 3, whispererIsPublic: false, league: { name: 'Tip-Off Outbreak' },
    }))
    overrides.set('zombieLeagueTeam.findMany', async () => [{ rosterId: 'R-human' }])
    overrides.set('roster.findMany', async () => [{ id: 'R-human', platformUserId: 'user-1' }])
    overrides.set('roster.findUnique', async () => ({ platformUserId: 'user-1' }))
    await selectWhisperer('z1', 'random')
    expect(notifyZombiePlayer).toHaveBeenCalledTimes(1)
    const [userId, type, title, opts] = vi.mocked(notifyZombiePlayer).mock.calls[0]!
    expect([userId, type, title]).toEqual(['user-1', 'whisperer_selected', "You're the Whisperer"])
    expect(opts?.body).toContain('Nobody else knows')
    // The stored title must be the real one: spoiler-safe mode would store "League update".
    expect(opts?.pushSpoilerSafe).toBeFalsy()
  })

  it('notifies nobody when the only seat is open', async () => {
    const { notifyZombiePlayer } = await import('@/lib/zombie/commissionerNotificationService')
    vi.mocked(notifyZombiePlayer).mockClear()
    overrides.set('zombieLeague.findUniqueOrThrow', async () => ({ id: 'z1', leagueId: 'L1', whispererAmbushCount: 3, league: {} }))
    overrides.set('zombieLeagueTeam.findMany', async () => [{ rosterId: 'R-open' }])
    overrides.set('roster.findMany', async () => [{ id: 'R-open', platformUserId: 'open-slot-L1-1' }])
    overrides.set('roster.findUnique', async () => ({ platformUserId: 'open-slot-L1-1' }))
    await selectWhisperer('z1', 'random')
    expect(notifyZombiePlayer).not.toHaveBeenCalled()
  })
})
