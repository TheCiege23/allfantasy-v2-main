import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockLeagueFindFirst,
  mockRosterFindFirst,
  mockTeamWeekResultFindUnique,
  mockFantasyStandingFindMany,
  mockBuildRosterLabelMap,
  mockResolveRedraftMatchupContext,
  mockLoadCanonicalPlayerScores,
  mockAttachPlayerMediaBatch,
} = vi.hoisted(() => ({
  mockLeagueFindFirst: vi.fn(),
  mockRosterFindFirst: vi.fn(),
  mockTeamWeekResultFindUnique: vi.fn(),
  mockFantasyStandingFindMany: vi.fn(),
  mockBuildRosterLabelMap: vi.fn(),
  mockResolveRedraftMatchupContext: vi.fn(),
  mockLoadCanonicalPlayerScores: vi.fn(),
  mockAttachPlayerMediaBatch: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: mockLeagueFindFirst },
    roster: { findFirst: mockRosterFindFirst },
    teamWeekResult: { findUnique: mockTeamWeekResultFindUnique },
    fantasyStanding: { findMany: mockFantasyStandingFindMany },
  },
}))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({ buildRosterLabelMap: mockBuildRosterLabelMap }))
vi.mock('@/server/services/matchupSources/redraftMatchupSource', () => ({ resolveRedraftMatchupContext: mockResolveRedraftMatchupContext }))
vi.mock('@/server/services/canonicalPlayerScores', () => ({ loadCanonicalPlayerScores: mockLoadCanonicalPlayerScores }))
vi.mock('@/lib/player-media', () => ({ attachPlayerMediaBatch: mockAttachPlayerMediaBatch }))

import { buildMatchupCenterPayload } from '@/server/services/matchupCenterService'

// Phase 34, Track A: real, verified production bug. resolveGenericMatchupContext()
// previously returned `bye` whenever TeamWeekResult had no opponentRosterId set --
// including when NO TeamWeekResult row exists at all (a real .env.test finding: that
// table has 0 rows total). This conflated "we have no matchup data" with "you are
// genuinely on a bye." The fix mirrors the already-established, real pattern in the
// sibling redraftMatchupSource.ts: a missing row -> `none` (unavailable, with a
// truthful reason); a real row that explicitly has no opponent -> `bye` (evidence-backed).
describe('matchupCenterService — generic path bye vs unavailable (Phase 34)', () => {
  const BASE_LEAGUE = {
    id: 'league-1',
    season: 2026,
    sport: 'NBA',
    settings: {},
    leagueVariant: null,
    userId: 'owner-1',
    teams: [{ platformUserId: 'viewer-1' }],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveRedraftMatchupContext.mockResolvedValue(null) // not redraft-family -> falls to generic
    mockBuildRosterLabelMap.mockResolvedValue(new Map())
    mockFantasyStandingFindMany.mockResolvedValue([])
    mockLoadCanonicalPlayerScores.mockResolvedValue(new Map())
    mockAttachPlayerMediaBatch.mockResolvedValue(new Map())
    mockLeagueFindFirst.mockResolvedValue(BASE_LEAGUE)
    mockRosterFindFirst.mockResolvedValue({ id: 'roster-1', playerData: {} })
  })

  it('returns an honest unavailable state (not bye) when no TeamWeekResult row exists at all', async () => {
    mockTeamWeekResultFindUnique.mockResolvedValue(null)

    const result = await buildMatchupCenterPayload({ leagueId: 'league-1', viewerUserId: 'viewer-1' })

    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.right.rosterId).not.toBe('bye')
    expect(result.conceptOverlay).toMatch(/no matchup/i)
    expect(result.partialData).toBe(true)
  })

  it('returns a genuine bye when a real TeamWeekResult row exists with no opponentRosterId (positive evidence)', async () => {
    mockTeamWeekResultFindUnique.mockResolvedValue({ status: 'upcoming', totalPoints: null, opponentRosterId: null })

    const result = await buildMatchupCenterPayload({ leagueId: 'league-1', viewerUserId: 'viewer-1' })

    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.right.rosterId).toBe('bye')
  })

  it('still returns a real matchup when a TeamWeekResult row has a real opponentRosterId', async () => {
    mockTeamWeekResultFindUnique
      .mockResolvedValueOnce({ status: 'upcoming', totalPoints: null, opponentRosterId: 'roster-2' })
      .mockResolvedValueOnce({ status: 'upcoming', totalPoints: null, opponentRosterId: 'roster-1' })
    mockRosterFindFirst
      .mockResolvedValueOnce({ id: 'roster-1', playerData: {} })
      .mockResolvedValueOnce({ id: 'roster-2', playerData: {} })

    const result = await buildMatchupCenterPayload({ leagueId: 'league-1', viewerUserId: 'viewer-1' })

    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.right.rosterId).toBe('roster-2')
  })
})
