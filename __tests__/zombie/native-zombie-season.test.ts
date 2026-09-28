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
  return { prisma: new Proxy({}, { get: (_t, prop: string) => model(prop) }) }
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
vi.mock('@/lib/zombie/infectionEngine', () => ({ resolveWeeklyInfections: vi.fn(async () => ({ infectionsCreated: 0 })) }))
vi.mock('@/lib/zombie/serumEngine', () => ({ finalizePendingSerumsForWeek: vi.fn(async () => undefined) }))
vi.mock('@/lib/zombie/bashingEngine', () => ({ detectAndProcessBashings: vi.fn(async () => []) }))
vi.mock('@/lib/zombie/maulingEngine', () => ({ detectAndProcessMaulings: vi.fn(async () => []) }))
vi.mock('@/lib/zombie/weaponEngine', () => ({ checkAndAwardWeapons: vi.fn(async () => undefined) }))
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
import { selectWhisperer } from '@/lib/zombie/whispererEngine'

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
    expect(argsOf('zombieLeague.updateMany')[0]).toEqual({
      where: { id: 'z1', status: { in: ['setup', 'registering'] } },
      data: { status: 'active', season: 2026, totalWeeks: 17, currentWeek: 1 },
    })
    withWhisperer.mockRestore()
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
  function arrange(currentWeek: number, totalWeeks = 17) {
    overrides.set('zombieLeague.findUnique', async () => ({
      id: 'z1', leagueId: 'L1', season: 2026, currentWeek, totalWeeks, universeId: null, league: {},
    }))
  }
  const leagueUpdate = () => argsOf('zombieLeague.update').at(-1)!

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
})
