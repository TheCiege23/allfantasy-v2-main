// @vitest-environment node
/**
 * `loadDefenseHub` — the loader's first test — on a league whose roster ids are not Sleeper ids.
 *
 * A Fleaflicker roster id is a short number in Sleeper's range: '6038' on a Fleaflicker roster is
 * NOT Sleeper's '6038'. The hub looked every roster id up as `SportsPlayer.sleeperId` and priced the
 * whole league through `loadLeagueIdpVorp` by the same ids, so it showed the manager a stranger as
 * "your linebacker", with the stranger's value and snaps.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadLeagueIdpVorp = vi.fn()
vi.mock('@/lib/idp-projections/leagueIdpVorp', () => ({
  loadLeagueIdpVorp: (...a: unknown[]) => loadLeagueIdpVorp(...a),
}))
vi.mock('@/lib/kicker-values/leagueKickerValue', () => ({
  resolveLeagueKickerValue: () => ({ value: null }),
}))
vi.mock('@/lib/core-app/snapShare', () => ({ loadSnapShares: vi.fn(async () => new Map()) }))
vi.mock('@/lib/idp-projections/actualWeeklyPoints', () => ({ loadActualWeeklyPoints: vi.fn(async () => new Map()) }))
vi.mock('@/lib/core-app/myRoster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/myRoster')>()),
  findMyRoster: vi.fn(async () => ({ found: true, playerData: { players: ['6038'] } })),
}))

import { loadDefenseHub } from '@/lib/idp-projections/defenseHub'

/** The fake Sleeper player table: '6038' IS a real Sleeper id, and it is somebody else. */
const SLEEPER_PLAYERS = [{ sleeperId: '6038', name: 'Wrong Player', team: 'KC', position: 'LB', updatedAt: new Date() }]

const prismaOn = (platform: string) =>
  ({
    league: {
      findUnique: async () => ({
        id: 'L1',
        settings: { roster_positions: ['LB', 'DL', 'DB'] },
        leagueType: 'redraft',
        platform,
      }),
      findFirst: async () => null,
    },
    roster: { findMany: async () => [{ playerData: { players: ['6038'] } }] },
    sportsPlayer: {
      findMany: async ({ where }: { where: { sleeperId: { in: string[] } } }) =>
        SLEEPER_PLAYERS.filter((p) => where.sleeperId.in.includes(p.sleeperId)),
    },
    playerGameStat: { findMany: async () => [] },
  }) as never

beforeEach(() => {
  loadLeagueIdpVorp.mockReset()
  loadLeagueIdpVorp.mockResolvedValue({
    vorpBySleeperId: new Map([['6038', 4.2]]),
    positionRankBySleeperId: new Map([['6038', 3]]),
    valueBySleeperId: new Map([['6038', 2100]]),
    projectionBySleeperId: new Map([['6038', 12.5]]),
    projectedFor: { season: 2026, week: 4 },
    skipped: null,
    coverage: { defenders: 1, projected: 1, priced: 1 },
  })
})

describe('loadDefenseHub — foreign roster ids', () => {
  it('does not show or price the Sleeper player who shares a Fleaflicker roster id', async () => {
    const hub = await loadDefenseHub({ prisma: prismaOn('fleaflicker'), leagueId: 'L1', userId: 'u-1' })
    expect(JSON.stringify(hub)).not.toContain('Wrong Player')
    expect(hub.defenders).toEqual([])
    // Neither the caller's nor the league's ids reach the pricer.
    expect(JSON.stringify(loadLeagueIdpVorp.mock.calls)).not.toContain('6038')
    // Counted and said, not silently dropped.
    expect(hub.notes.join(' ')).toMatch(/cannot resolve/)
  })

  it('CONTROL: the same id in a Sleeper league IS shown and priced', async () => {
    const hub = await loadDefenseHub({ prisma: prismaOn('sleeper'), leagueId: 'L1', userId: 'u-1' })
    expect(hub.state).toBe('ok')
    expect(hub.defenders.map((d) => d.name)).toEqual(['Wrong Player'])
    expect(hub.defenders[0].value).toBe(2100)
  })
})
