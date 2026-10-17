// @vitest-environment node
/**
 * AF_LEAGUE_BUZZ §8 — an injury item is emitted ONLY for a player the viewer actually rosters, and
 * only when the cached status is roster-affecting. The source starts from the viewer's own exposure,
 * so a non-owned injured player can never leak into the feed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { exposureMock, playerRowsMock, injuryRowsMock, namesMock } = vi.hoisted(() => ({
  exposureMock: vi.fn(),
  playerRowsMock: vi.fn(),
  injuryRowsMock: vi.fn(),
  namesMock: vi.fn(),
}))

vi.mock('@/lib/shared-services/game-day/UserPlayerExposureService', () => ({
  computeUserPlayerExposure: exposureMock,
}))
/* The real read port runs: `sportsPlayer` is the by-Sleeper-id identity read, `sportsInjury` the feed. */
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsPlayer: { findMany: playerRowsMock }, sportsInjury: { findMany: injuryRowsMock } },
}))
vi.mock('@/lib/roster/resolvePlayerNames', () => ({
  resolvePlayerNamesForSport: namesMock,
}))

import { collectRosterInjuryActivity } from '@/lib/activity/sources/rosterInjuryActivity'

function feedRow(playerName: string, team: string, position: string, status: string) {
  const at = new Date(Date.now() - 2 * 3_600_000)
  return { playerName, status, type: null, description: null, date: at, week: null, source: 'rolling_insights', fetchedAt: at, team, position }
}

beforeEach(() => {
  vi.clearAllMocks()
  namesMock.mockResolvedValue(new Map())
})

describe('collectRosterInjuryActivity — only for owned + injured players (§8)', () => {
  it('emits only for owned players whose status is uncertain/unavailable', async () => {
    exposureMock.mockResolvedValue({
      exposures: [
        { sport: 'NFL', idSpace: 'sleeper', playerId: 'p_cmc', playerName: 'Christian McCaffrey', position: 'RB', leagueCount: 2 },
        { sport: 'NFL', idSpace: 'sleeper', playerId: 'p_ok', playerName: 'Healthy Guy', position: 'WR', leagueCount: 1 },
      ],
      connectedLeagueCount: 2,
    })
    playerRowsMock.mockResolvedValue([
      { sleeperId: 'p_cmc', source: 'sleeper', name: 'Christian McCaffrey', team: 'San Francisco 49ers', position: 'RB', status: 'Active' },
      { sleeperId: 'p_ok', source: 'sleeper', name: 'Healthy Guy', team: 'Dallas Cowboys', position: 'WR', status: 'Active' },
    ])
    injuryRowsMock.mockResolvedValue([
      feedRow('Christian McCaffrey', 'San Francisco 49ers', 'RB', 'Questionable'),
      feedRow('Healthy Guy', 'Dallas Cowboys', 'WR', 'Active'),
      // A non-owned injured player the feed carries — must NEVER appear, because the source
      // iterates the viewer's own exposures, not the feed.
      feedRow('Not Owned', 'Detroit Lions', 'WR', 'Out'),
    ])

    const items = await collectRosterInjuryActivity({ userId: 'u1', leagues: [], limit: 50 })

    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.type).toBe('injury')
    expect(item.source).toBe('injury')
    expect(item.href).toBe('/my-players')
    expect(item.description).toBe('Christian McCaffrey (RB) → Questionable — on 2 of your rosters')
    // Only owned player ids were ever looked up.
    const asked = playerRowsMock.mock.calls[0]?.[0]?.where?.OR?.find((c: { sleeperId?: unknown }) => c.sleeperId)?.sleeperId?.in
    expect(asked).toEqual(['p_cmc', 'p_ok'])
  })

  it('returns an honest empty list when the viewer rosters nobody', async () => {
    exposureMock.mockResolvedValue({ exposures: [], connectedLeagueCount: 0 })
    const items = await collectRosterInjuryActivity({ userId: 'u1', leagues: [], limit: 50 })
    expect(items).toEqual([])
    expect(playerRowsMock).not.toHaveBeenCalled()
    expect(injuryRowsMock).not.toHaveBeenCalled()
  })
})

describe('collectRosterInjuryActivity — the designation is the injury feed’s, not the roster status', () => {
  const exposures = {
    exposures: [{ sport: 'NFL', idSpace: 'sleeper', playerId: '4866', playerName: 'Saquon Barkley', position: 'RB', leagueCount: 1 }],
    connectedLeagueCount: 1,
  }

  it('🛑 an Out starter whose Sleeper roster status still reads "Active" IS announced', async () => {
    exposureMock.mockResolvedValue(exposures)
    playerRowsMock.mockResolvedValue([
      { sleeperId: '4866', source: 'sleeper', name: 'Saquon Barkley', team: 'Philadelphia Eagles', position: 'RB', status: 'Active' },
    ])
    injuryRowsMock.mockResolvedValue([feedRow('Saquon Barkley', 'Philadelphia Eagles', 'RB', 'Out')])
    const items = await collectRosterInjuryActivity({ userId: 'u1', leagues: [], limit: 50 })
    expect(items.map((i) => i.description)).toEqual(['Saquon Barkley (RB) → Out — on 1 of your rosters'])
  })

  it('a STALE Questionable (last week’s report) is not announced as news', async () => {
    exposureMock.mockResolvedValue(exposures)
    playerRowsMock.mockResolvedValue([
      { sleeperId: '4866', source: 'sleeper', name: 'Saquon Barkley', team: 'Philadelphia Eagles', position: 'RB', status: 'Active' },
    ])
    const old = new Date(Date.now() - 10 * 24 * 3_600_000)
    injuryRowsMock.mockResolvedValue([
      { ...feedRow('Saquon Barkley', 'Philadelphia Eagles', 'RB', 'Questionable'), date: old },
    ])
    const items = await collectRosterInjuryActivity({ userId: 'u1', leagues: [], limit: 50 })
    expect(items).toEqual([])
  })
})
