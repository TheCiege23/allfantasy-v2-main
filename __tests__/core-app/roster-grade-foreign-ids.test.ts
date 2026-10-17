import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A FOREIGN LEAGUE'S ROSTER IDS COLLIDE WITH REAL SLEEPER IDS.
 *
 * `getRosterGrade` prices every rostered id through FantasyCalc snapshots keyed on `sleeperId`. A
 * Fleaflicker roster whose ids happen to be real Sleeper ids cleared the 50% coverage floor and was
 * graded on strangers' prices. It must now return null (the screen's honest "not computed").
 *
 * The same rosters in a Sleeper league are the CONTROL: they prove the harness prices at all.
 */

const rosterFindMany = vi.hoisted(() => vi.fn())
const loadSnapshots = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { roster: { findMany: rosterFindMany } } }))
vi.mock('@/lib/player-values/latestPlayerValueSnapshots', () => ({ loadLatestPlayerValueSnapshots: loadSnapshots }))
vi.mock('@/lib/trade-intel/valueLedger', () => ({ BASELINE_SCORING: {}, buildValueLedger: vi.fn(async () => new Map()) }))

import { getRosterGrade } from '@/lib/core-app/rosterGrade'

/* Every id below IS a Sleeper id in the fake snapshot table ("Wrong Player" prices). */
const TEAMS: Array<[string, string[]]> = [
  ['me', ['6038', '6039']],
  ['t2', ['7000', '7001']],
  ['t3', ['8000', '8001']],
]

function rostersIn(platform: string) {
  rosterFindMany.mockResolvedValue(
    TEAMS.map(([platformUserId, players]) => ({ platformUserId, playerData: { players }, league: { platform } })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  loadSnapshots.mockImplementation(async (args: { sleeperIds: string[] }) =>
    [...args.sleeperIds].map((sleeperId, i) => ({
      sleeperId,
      value: 1000 + i * 100,
      position: 'WR',
      capturedAt: new Date('2026-09-20T00:00:00Z'),
    })),
  )
})

const ARGS = { leagueId: 'L1', myPlatformUserIds: ['me'], isDynasty: false, starters: ['QB', 'WR'] }

describe('getRosterGrade — foreign roster ids never reach a Sleeper-id price', () => {
  it('CONTROL: a Sleeper league is graded on those ids', async () => {
    rostersIn('sleeper')
    const grade = await getRosterGrade(ARGS)
    expect(grade).not.toBeNull()
    expect(grade!.pricedPlayers).toBe(2)
    expect(loadSnapshots.mock.calls[0][0].sleeperIds).toContain('6038')
  })

  it('a Fleaflicker league with colliding ids is not graded on strangers’ prices', async () => {
    rostersIn('fleaflicker')
    const grade = await getRosterGrade(ARGS)
    expect(grade).toBeNull()
    // Not merely a null verdict: no colliding id was ever looked up as a Sleeper id.
    for (const call of loadSnapshots.mock.calls) expect(call[0].sleeperIds).not.toContain('6038')
  })

  it('selects the league platform on the roster read (a real relation, not a guessed column)', async () => {
    rostersIn('sleeper')
    await getRosterGrade(ARGS)
    expect(rosterFindMany.mock.calls[0][0].select).toMatchObject({ league: { select: { platform: true } } })
  })
})
