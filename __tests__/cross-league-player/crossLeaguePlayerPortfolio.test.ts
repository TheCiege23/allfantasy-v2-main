/**
 * Cross-League Player Intelligence phase — Parts 2-9, 20 tests: canonical
 * service, identity dedup, roster status, injury/schedule enrichment,
 * exposure, and privacy (cross-user isolation).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  rosterFindMany,
  leagueTeamFindMany,
  userProfileFindUnique,
  resolvePlayersMock,
  resolveInjuryContextMock,
  resolveScheduleContextMock,
  assembleUserOsRecommendationsMock,
} = vi.hoisted(() => ({
  rosterFindMany: vi.fn(),
  leagueTeamFindMany: vi.fn(),
  userProfileFindUnique: vi.fn(),
  resolvePlayersMock: vi.fn(),
  resolveInjuryContextMock: vi.fn(),
  resolveScheduleContextMock: vi.fn(),
  assembleUserOsRecommendationsMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: rosterFindMany },
    leagueTeam: { findMany: leagueTeamFindMany },
    userProfile: { findUnique: userProfileFindUnique },
    // Slice 4/18 — the assemble path dereferences these models; absent keys
    // throw TypeError inside the async fn and reject the whole portfolio.
    fantasyProjection: { findMany: () => Promise.resolve([]) },
  },
}))
vi.mock('@/lib/shared-services/player-identity', () => ({ resolvePlayers: resolvePlayersMock }))
vi.mock('@/lib/decision-os/world/injuryEnrichedWorld', () => ({ resolveInjuryContext: resolveInjuryContextMock }))
vi.mock('@/lib/decision-os/world/scheduleBye', () => ({ resolveScheduleContext: resolveScheduleContextMock }))
vi.mock('@/lib/shared-services/league-hub/userOsRecommendations', () => ({ assembleUserOsRecommendations: assembleUserOsRecommendationsMock }))

import { baseRoster, resolutionFor } from './fixtures'

describe('assembleCrossLeaguePlayerPortfolio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userProfileFindUnique.mockResolvedValue({ sleeperUserId: null })
    leagueTeamFindMany.mockResolvedValue([])
    resolveInjuryContextMock.mockResolvedValue({ byId: new Map(), resolvedCount: 0, unresolvedIds: [], warnings: [] })
    resolveScheduleContextMock.mockResolvedValue({ byTeam: new Map(), requestedTeams: 0, resolvedTeams: 0, completeness: 0, warnings: [], coverageGaps: [] })
    assembleUserOsRecommendationsMock.mockResolvedValue({
      bundle: { lineup: [], waiver: [], trade: [], roster: [], playoff: [], strategy: [], commissioner: [], totalCount: 0 },
      domainStatus: {},
      generatedAt: '',
      accessDenied: false,
    })
  })

  it('returns an empty portfolio when the user has no connected leagues', async () => {
    rosterFindMany.mockResolvedValue([])
    const { assembleCrossLeaguePlayerPortfolio } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const result = await assembleCrossLeaguePlayerPortfolio({ appUserId: 'user-1' })
    expect(result.items).toEqual([])
    expect(result.connectedLeagueCount).toBe(0)
  })

  it('never leaks another user\'s rosters — only rosters matching the resolved platform user ids are read', async () => {
    rosterFindMany.mockResolvedValue([baseRoster({ platformUserId: 'user-1' })])
    resolvePlayersMock.mockResolvedValue([resolutionFor('p1')])
    const { assembleCrossLeaguePlayerPortfolio } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    await assembleCrossLeaguePlayerPortfolio({ appUserId: 'user-1' })
    expect(rosterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ platformUserId: { in: ['user-1'] } }) })
    )
  })

  it('deduplicates the same real player rostered under different provider ids into one canonical item', async () => {
    rosterFindMany.mockResolvedValue([
      baseRoster({
        leagueId: 'league-a',
        league: { ...baseRoster().league, id: 'league-a', platform: 'sleeper' },
        playerData: { lineup_sections: { starters: [{ id: 'sleeper-1', name: 'Player One', position: 'RB', team: 'BUF' }], bench: [], ir: [], taxi: [], devy: [] } },
      }),
      baseRoster({
        leagueId: 'league-b',
        league: { ...baseRoster().league, id: 'league-b', platform: 'espn' },
        playerData: { lineup_sections: { starters: [], bench: [{ id: 'espn-99', name: 'Player One', position: 'RB', team: 'BUF' }], ir: [], taxi: [], devy: [] } },
      }),
    ])
    // Both raw provider ids resolve to the SAME canonical player.
    resolvePlayersMock.mockResolvedValue([
      resolutionFor('sleeper-1', { player: { ...resolutionFor('sleeper-1').player!, canonicalPlayerId: 'canonical-real-player' } }),
      resolutionFor('espn-99', { player: { ...resolutionFor('espn-99').player!, canonicalPlayerId: 'canonical-real-player' } }),
    ])
    const { assembleCrossLeaguePlayerPortfolio } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const result = await assembleCrossLeaguePlayerPortfolio({ appUserId: 'user-1' })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].exposure.leagueCount).toBe(2)
    expect(result.items[0].leagueAppearances).toHaveLength(2)
  })

  it('never merges an ambiguous or unresolved identity into another player\'s row', async () => {
    rosterFindMany.mockResolvedValue([
      baseRoster({
        playerData: {
          lineup_sections: {
            starters: [
              { id: 'sleeper-1', name: 'Player One', position: 'RB', team: 'BUF' },
              { id: 'sleeper-2', name: 'Player Two', position: 'WR', team: 'MIA' },
            ],
            bench: [],
            ir: [],
            taxi: [],
            devy: [],
          },
        },
      }),
    ])
    resolvePlayersMock.mockResolvedValue([
      resolutionFor('sleeper-1'),
      resolutionFor('sleeper-2', { player: null, confidence: 'unresolved', source: 'unresolved' }),
    ])
    const { assembleCrossLeaguePlayerPortfolio } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const result = await assembleCrossLeaguePlayerPortfolio({ appUserId: 'user-1' })
    expect(result.items).toHaveLength(2)
    const unresolved = result.items.find((i) => i.identityConfidence === 'unresolved')
    expect(unresolved?.canonicalPlayerId).toBe('unresolved:sleeper:sleeper-2')
  })

  it('derives real roster status from the normalized lineup sections — starter/bench/ir/taxi', async () => {
    rosterFindMany.mockResolvedValue([
      baseRoster({
        playerData: {
          lineup_sections: {
            starters: [{ id: 'p1', name: 'A', position: 'RB', team: 'BUF' }],
            bench: [{ id: 'p2', name: 'B', position: 'WR', team: 'MIA' }],
            ir: [{ id: 'p3', name: 'C', position: 'QB', team: 'KC' }],
            taxi: [{ id: 'p4', name: 'D', position: 'TE', team: 'SF' }],
            devy: [],
          },
        },
      }),
    ])
    resolvePlayersMock.mockResolvedValue(['p1', 'p2', 'p3', 'p4'].map((id) => resolutionFor(id)))
    const { assembleCrossLeaguePlayerPortfolio } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const result = await assembleCrossLeaguePlayerPortfolio({ appUserId: 'user-1' })
    const statuses = result.items.map((i) => i.leagueAppearances[0].rosterStatus).sort()
    expect(statuses).toEqual(['bench', 'ir', 'starter', 'taxi'])
  })

  it('surfaces a real "IR" raw status as injury.status "ir", not the generic "out" (regression — Part 21 found this collapsed to "out" via the 4-category mapping alone)', async () => {
    rosterFindMany.mockResolvedValue([baseRoster()])
    resolvePlayersMock.mockResolvedValue([resolutionFor('p1')])
    resolveInjuryContextMock.mockResolvedValue({
      byId: new Map([
        [
          'p1',
          {
            status: 'IR',
            availabilityCategory: 'unavailable',
            practiceStatus: null,
            gameStatus: null,
            bodyPart: null,
            description: null,
            freshness: { fetchedAt: null, expiresAt: null, updatedAt: null, isStale: false, staleReason: null },
            provenance: { source: 'test' },
            resolved: true,
            uncertainty: [],
          },
        ],
      ]),
      resolvedCount: 1,
      unresolvedIds: [],
      warnings: [],
    })
    const { assembleCrossLeaguePlayerPortfolio } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const result = await assembleCrossLeaguePlayerPortfolio({ appUserId: 'user-1' })
    expect(result.items[0].injury?.status).toBe('ir')
  })

  it('computes real exposure percentages from real connected league counts, never fabricated', async () => {
    rosterFindMany.mockResolvedValue([
      baseRoster({ leagueId: 'league-a', league: { ...baseRoster().league, id: 'league-a' } }),
      baseRoster({
        leagueId: 'league-b',
        league: { ...baseRoster().league, id: 'league-b' },
        playerData: { lineup_sections: { starters: [], bench: [], ir: [], taxi: [], devy: [] } },
      }),
    ])
    resolvePlayersMock.mockResolvedValue([resolutionFor('p1')])
    const { assembleCrossLeaguePlayerPortfolio } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const result = await assembleCrossLeaguePlayerPortfolio({ appUserId: 'user-1' })
    expect(result.connectedLeagueCount).toBe(2)
    expect(result.items[0].exposure.percentageOfUserLeagues).toBe(0.5)
  })

  it('never applies NFL-shaped bye logic to a daily-cadence sport — NBA uses the next-game model (Slice 6), not the bye model', async () => {
    // HISTORY: this test originally asserted NBA ∈ unsupportedSports. Slice 6
    // moved NBA to NEXT_GAME_SUPPORTED_SPORTS, which made that assertion
    // wrong — but the suite's prisma mock was missing `fantasyProjection`, so
    // the whole assemble call rejected with a TypeError and the outdated
    // expectation stayed masked until 2026-08-10.
    rosterFindMany.mockResolvedValue([
      baseRoster({ league: { ...baseRoster().league, sport: 'NBA' } }),
    ])
    resolvePlayersMock.mockResolvedValue([resolutionFor('p1', { player: { ...resolutionFor('p1').player!, sport: 'NBA' } })])
    const { assembleCrossLeaguePlayerPortfolio } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const result = await assembleCrossLeaguePlayerPortfolio({ appUserId: 'user-1' })
    // NBA is schedule-capable via the next-game model — honestly NOT unsupported.
    expect(result.unsupportedSports).not.toContain('NBA')
    // The NFL bye-week resolver must never run for a daily-cadence sport.
    expect(resolveScheduleContextMock).not.toHaveBeenCalled()
    // With no next-game cache rows available in this test, schedule degrades
    // to null rather than fabricating a bye week.
    expect(result.items[0].schedule).toBeNull()
  })

  it('marks a genuinely unsupported sport honestly in unsupportedSports', async () => {
    rosterFindMany.mockResolvedValue([
      baseRoster({ league: { ...baseRoster().league, sport: 'CRICKET' } }),
    ])
    resolvePlayersMock.mockResolvedValue([resolutionFor('p1', { player: { ...resolutionFor('p1').player!, sport: 'CRICKET' } })])
    const { assembleCrossLeaguePlayerPortfolio } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const result = await assembleCrossLeaguePlayerPortfolio({ appUserId: 'user-1' })
    expect(result.unsupportedSports).toContain('CRICKET')
    expect(result.items[0].schedule).toBeNull()
    expect(resolveScheduleContextMock).not.toHaveBeenCalled()
  })

  it('surfaces real per-league recommendations, never a single universal action applied to every league', async () => {
    rosterFindMany.mockResolvedValue([
      baseRoster({ leagueId: 'league-a', league: { ...baseRoster().league, id: 'league-a' } }),
      baseRoster({
        leagueId: 'league-b',
        league: { ...baseRoster().league, id: 'league-b' },
        playerData: { lineup_sections: { starters: [{ id: 'p1', name: 'Player One', position: 'RB', team: 'BUF' }], bench: [], ir: [], taxi: [], devy: [] } },
      }),
    ])
    resolvePlayersMock.mockResolvedValue([resolutionFor('p1'), resolutionFor('p1')])
    assembleUserOsRecommendationsMock.mockImplementation(async ({ canonicalLeagueId }: { canonicalLeagueId: string }) => {
      if (canonicalLeagueId === 'league-a') {
        return {
          bundle: {
            lineup: [{ id: 'r1', leagueId: 'league-a', domain: 'lineup', type: 'start', priority: 'high', title: 'Start Player One', summary: 'Deep league — start.', rationale: [], evidence: [], generatedAt: '', sourceFreshness: { state: 'fresh', lastSyncedAt: null }, executionCapability: 'recommendation_only', status: 'new', playerIds: ['p1'] }],
            waiver: [], trade: [], roster: [], playoff: [], strategy: [], commissioner: [], totalCount: 1,
          },
          domainStatus: {}, generatedAt: '', accessDenied: false,
        }
      }
      return {
        bundle: {
          lineup: [{ id: 'r2', leagueId: 'league-b', domain: 'lineup', type: 'bench', priority: 'medium', title: 'Bench Player One', summary: 'Shallow league — bench.', rationale: [], evidence: [], generatedAt: '', sourceFreshness: { state: 'fresh', lastSyncedAt: null }, executionCapability: 'recommendation_only', status: 'new', playerIds: ['p1'] }],
          waiver: [], trade: [], roster: [], playoff: [], strategy: [], commissioner: [], totalCount: 1,
        },
        domainStatus: {}, generatedAt: '', accessDenied: false,
      }
    })
    const { assembleCrossLeaguePlayerPortfolio } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const result = await assembleCrossLeaguePlayerPortfolio({ appUserId: 'user-1' })
    const titles = result.items[0].leagueAppearances.map((a) => a.recommendation?.title).sort()
    expect(titles).toEqual(['Bench Player One', 'Start Player One'])
  })
})
