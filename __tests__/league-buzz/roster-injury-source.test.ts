// @vitest-environment node
/**
 * AF_LEAGUE_BUZZ §8 — an injury item is emitted ONLY for a player the viewer actually rosters, and
 * only when the cached status is roster-affecting. The source starts from the viewer's own exposure,
 * so a non-owned injured player can never leak into the feed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { exposureMock, injuryMock, namesMock } = vi.hoisted(() => ({
  exposureMock: vi.fn(),
  injuryMock: vi.fn(),
  namesMock: vi.fn(),
}))

vi.mock('@/lib/shared-services/game-day/UserPlayerExposureService', () => ({
  computeUserPlayerExposure: exposureMock,
}))
vi.mock('@/lib/decision-os/world/injuryEnrichedWorld', () => ({
  resolveInjuryContext: injuryMock,
}))
vi.mock('@/lib/roster/resolvePlayerNames', () => ({
  resolvePlayerNamesForSport: namesMock,
}))

import { collectRosterInjuryActivity } from '@/lib/activity/sources/rosterInjuryActivity'

function inj(availabilityCategory: string, status: string) {
  return { status, availabilityCategory, freshness: { updatedAt: '2026-07-12T00:00:00.000Z', fetchedAt: null } }
}

beforeEach(() => {
  vi.clearAllMocks()
  namesMock.mockResolvedValue(new Map())
})

describe('collectRosterInjuryActivity — only for owned + injured players (§8)', () => {
  it('emits only for owned players whose status is uncertain/unavailable', async () => {
    exposureMock.mockResolvedValue({
      exposures: [
        { playerId: 'p_cmc', playerName: 'Christian McCaffrey', position: 'RB', leagueCount: 2 },
        { playerId: 'p_ok', playerName: 'Healthy Guy', position: 'WR', leagueCount: 1 },
      ],
      connectedLeagueCount: 2,
    })
    injuryMock.mockResolvedValue({
      byId: new Map([
        ['p_cmc', inj('uncertain', 'Q')],
        ['p_ok', inj('available', 'Active')],
        // A non-owned injured player the resolver happened to return — must NEVER appear, because
        // the source iterates the viewer's own exposures, not the injury map.
        ['p_not_owned', inj('unavailable', 'O')],
      ]),
      resolvedCount: 2,
      unresolvedIds: [],
      warnings: [],
    })

    const items = await collectRosterInjuryActivity({ userId: 'u1', leagues: [], limit: 50 })

    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.type).toBe('injury')
    expect(item.source).toBe('injury')
    expect(item.href).toBe('/my-players')
    expect(item.description).toBe('Christian McCaffrey (RB) → Questionable — on 2 of your rosters')
    // Only owned player ids were ever queried for injury status.
    expect(injuryMock).toHaveBeenCalledWith('NFL', ['p_cmc', 'p_ok'])
  })

  it('returns an honest empty list when the viewer rosters nobody', async () => {
    exposureMock.mockResolvedValue({ exposures: [], connectedLeagueCount: 0 })
    const items = await collectRosterInjuryActivity({ userId: 'u1', leagues: [], limit: 50 })
    expect(items).toEqual([])
    expect(injuryMock).not.toHaveBeenCalled()
  })
})
