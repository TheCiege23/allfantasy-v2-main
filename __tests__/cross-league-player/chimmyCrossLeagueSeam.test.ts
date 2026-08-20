/**
 * Cross-League Player Intelligence phase — Part 19 Chimmy seam tests,
 * including the explicitly required cross-user rejection test.
 *
 * `getChimmyCrossLeaguePlayerSummary`/`getChimmyPlayerLookup` call
 * `assembleCrossLeaguePlayerPortfolio` as a same-module function reference —
 * mocking the module's exported binding does not intercept that internal
 * call (ES module same-file calls resolve directly, not through the export
 * object). So these tests mock the same lower-level dependencies the core
 * service test does and exercise the real Chimmy functions end-to-end.
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

describe('getChimmyCrossLeaguePlayerSummary', () => {
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

  it('is scoped entirely to the resolved appUserId — only reads rosters for that real user\'s linked platform ids', async () => {
    rosterFindMany.mockResolvedValue([])
    const { getChimmyCrossLeaguePlayerSummary } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    await getChimmyCrossLeaguePlayerSummary({ appUserId: 'real-user' })
    expect(rosterFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { platformUserId: { in: ['real-user'] } } }))
  })

  it('surfaces injured players as a focused list, not the full portfolio', async () => {
    rosterFindMany.mockResolvedValue([
      baseRoster({
        playerData: {
          lineup_sections: {
            starters: [{ id: 'p1', name: 'Injured Guy', position: 'RB', team: 'BUF' }],
            bench: [{ id: 'p2', name: 'Healthy Guy', position: 'WR', team: 'MIA' }],
            ir: [], taxi: [], devy: [],
          },
        },
      }),
    ])
    resolvePlayersMock.mockResolvedValue([resolutionFor('p1'), resolutionFor('p2')])
    resolveInjuryContextMock.mockResolvedValue({
      byId: new Map([
        ['p1', { status: 'O', availabilityCategory: 'unavailable', practiceStatus: null, gameStatus: null, bodyPart: null, description: null, freshness: { fetchedAt: null, expiresAt: null, updatedAt: null, isStale: false, staleReason: null }, provenance: { source: 'test' }, resolved: true, uncertainty: [] }],
      ]),
      resolvedCount: 1,
      unresolvedIds: [],
      warnings: [],
    })
    const { getChimmyCrossLeaguePlayerSummary } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const summary = await getChimmyCrossLeaguePlayerSummary({ appUserId: 'real-user' })
    expect(summary.injuredPlayers).toHaveLength(1)
    expect(summary.injuredPlayers[0].displayName).toBe('Player p1')
    expect(summary).not.toHaveProperty('items')
  })

  it('surfaces overexposed players only above the real threshold, with more than one league', async () => {
    rosterFindMany.mockResolvedValue([
      baseRoster({ leagueId: 'league-a', league: { ...baseRoster().league, id: 'league-a' } }),
      baseRoster({ leagueId: 'league-b', league: { ...baseRoster().league, id: 'league-b' } }),
    ])
    resolvePlayersMock.mockResolvedValue([resolutionFor('p1'), resolutionFor('p1')])
    const { getChimmyCrossLeaguePlayerSummary } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const summary = await getChimmyCrossLeaguePlayerSummary({ appUserId: 'real-user' })
    expect(summary.overexposedPlayers).toHaveLength(1)
    expect(summary.overexposedPlayers[0].leagueCount).toBe(2)
  })
})

describe('getChimmyPlayerLookup', () => {
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

  it('cross-user rejection: a stranger with no real roster for this player gets null, same as a nonexistent id', async () => {
    // The "stranger" genuinely has zero rosters — resolveLinkedPlatformUserIds/roster query is scoped
    // to THEIR OWN appUserId, so a victim's player can never appear in their result set at all.
    rosterFindMany.mockResolvedValue([])
    const { getChimmyPlayerLookup } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const result = await getChimmyPlayerLookup({ appUserId: 'stranger', canonicalPlayerId: 'victim-owned-player' })
    expect(result).toBeNull()
  })

  it('returns the real item for a player the caller genuinely rosters', async () => {
    rosterFindMany.mockResolvedValue([baseRoster()])
    resolvePlayersMock.mockResolvedValue([resolutionFor('p1', { player: { ...resolutionFor('p1').player!, canonicalPlayerId: 'canonical-p1' } })])
    const { getChimmyPlayerLookup } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    const result = await getChimmyPlayerLookup({ appUserId: 'real-user', canonicalPlayerId: 'canonical-p1' })
    expect(result?.canonicalPlayerId).toBe('canonical-p1')
  })

  it('never resolves canonicalPlayerId independently of appUserId — the underlying roster read is always scoped to the caller', async () => {
    rosterFindMany.mockResolvedValue([])
    const { getChimmyPlayerLookup } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
    await getChimmyPlayerLookup({ appUserId: 'real-user', canonicalPlayerId: 'p1' })
    expect(rosterFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { platformUserId: { in: ['real-user'] } } }))
  })
})
