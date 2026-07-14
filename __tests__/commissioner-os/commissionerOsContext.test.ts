/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 3/4 tests:
 * the authorization boundary (native/imported/attested commissioner access,
 * normal-manager rejection, cross-user rejection, revoked authority, deleted
 * league, stale attestation metadata) and the context assembler's real reads
 * (rivalries/drama/draft-grade unavailable-domain computation, snapshot-only
 * detection).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { leagueFindUnique, rosterFindFirst, leagueSeasonFindMany, rivalryRecordFindMany, dramaEventFindMany, draftGradeFindMany } =
  vi.hoisted(() => ({
    leagueFindUnique: vi.fn(),
    rosterFindFirst: vi.fn(),
    leagueSeasonFindMany: vi.fn(),
    rivalryRecordFindMany: vi.fn(),
    dramaEventFindMany: vi.fn(),
    draftGradeFindMany: vi.fn(),
  }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUnique },
    roster: { findFirst: rosterFindFirst },
    leagueSeason: { findMany: leagueSeasonFindMany },
    rivalryRecord: { findMany: rivalryRecordFindMany },
    dramaEvent: { findMany: dramaEventFindMany },
    draftGrade: { findMany: draftGradeFindMany },
  },
}))

vi.mock('@/lib/shared-services/commissioner', () => ({
  buildCommissionerContext: vi.fn().mockResolvedValue({
    leagueId: 'league-1',
    generatedAt: '2026-07-12T00:00:00.000Z',
    requestingUserRole: 'commissioner',
    missionControl: { leagueId: 'league-1', activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 }, managersAtRetentionRisk: [], recommendedActions: [], fieldProvenance: null },
    leagueAnalytics: {},
    formatAwareness: { leagueVariant: null, isDynasty: false, powerRankingSupport: 'supported', reason: null },
    gameDayAttentionItems: null,
    managerTendencies: {},
  }),
  buildLeagueHealthAssessment: vi.fn().mockReturnValue({
    leagueId: 'league-1', category: 'healthy', score: 88, issues: [], evidence: [], confidence: 90, freshness: 'fresh',
    sourceAttribution: { source: 'monitorLeagueHealth', fetchedAt: '', providerTimestamp: null, freshness: 'fresh', confidence: 90, missingDataReason: null },
  }),
  buildCommissionerAttentionItems: vi.fn().mockReturnValue([]),
  buildCommissionerRanking: vi.fn().mockResolvedValue(null),
  buildCommissionerBrief: vi.fn().mockReturnValue({ leagueId: 'league-1', week: 1, generatedAt: '', sections: [], isHealthy: true, confidence: 80 }),
}))

function baseLeague(overrides: Record<string, unknown> = {}) {
  return {
    id: 'league-1',
    userId: 'owner-1',
    platform: 'espn',
    sport: 'NFL',
    season: 2026,
    scoring: 'PPR',
    syncStatus: 'success',
    lastSyncedAt: new Date('2026-07-12T00:00:00Z'),
    settings: null,
    redraftMembers: [],
    teams: [],
    ...overrides,
  }
}

describe('assembleCommissionerOsContext — authorization boundary', () => {
  beforeEach(() => {
    // `mockReset()` (not a blanket `vi.resetAllMocks()`, which would also wipe the
    // `vi.mock('@/lib/shared-services/commissioner', ...)` factory's own `mockResolvedValue`
    // implementations set only once at module-mock definition time) on just the hoisted prisma
    // mocks — `clearAllMocks` alone leaves any queued-but-unconsumed `mockResolvedValueOnce`
    // values in place, which would otherwise leak into the next test whenever a prior test's flow
    // short-circuits before consuming every queued value (e.g. a rejection test that never reaches
    // the second `league.findUnique` call).
    leagueFindUnique.mockReset()
    rosterFindFirst.mockReset()
    leagueSeasonFindMany.mockReset()
    rivalryRecordFindMany.mockReset()
    dramaEventFindMany.mockReset()
    draftGradeFindMany.mockReset()
    rosterFindFirst.mockResolvedValue(null)
    leagueSeasonFindMany.mockResolvedValue([])
    rivalryRecordFindMany.mockResolvedValue([])
    dramaEventFindMany.mockResolvedValue([])
    draftGradeFindMany.mockResolvedValue([])
  })

  it('rejects a normal league member — real membership alone is not commissioner authority', async () => {
    leagueFindUnique.mockResolvedValueOnce(baseLeague({ redraftMembers: [{ role: 'member' }] }))
    const { assembleCommissionerOsContext } = await import('@/lib/shared-services/league-hub/commissionerOsContext')
    const result = await assembleCommissionerOsContext({ appUserId: 'normal-manager', canonicalLeagueId: 'league-1' })
    expect(result).toBeNull()
  })

  it('rejects a cross-user stranger with no real relationship to the league at all', async () => {
    leagueFindUnique.mockResolvedValueOnce(baseLeague())
    const { assembleCommissionerOsContext } = await import('@/lib/shared-services/league-hub/commissionerOsContext')
    const result = await assembleCommissionerOsContext({ appUserId: 'total-stranger', canonicalLeagueId: 'league-1' })
    expect(result).toBeNull()
  })

  it('rejects when the league does not exist — never distinguishable from "not the commissioner"', async () => {
    leagueFindUnique.mockResolvedValueOnce(null)
    const { assembleCommissionerOsContext } = await import('@/lib/shared-services/league-hub/commissionerOsContext')
    const result = await assembleCommissionerOsContext({ appUserId: 'anyone', canonicalLeagueId: 'deleted-league' })
    expect(result).toBeNull()
  })

  it('grants access to a native commissioner via LeagueTeam.isCommissioner', async () => {
    leagueFindUnique
      .mockResolvedValueOnce(baseLeague({ teams: [{ id: 'team-1', isCommissioner: true, isCoCommissioner: false }] }))
      .mockResolvedValueOnce({ platform: 'espn', sport: 'NFL', season: 2026, isDynasty: false })
    const { assembleCommissionerOsContext } = await import('@/lib/shared-services/league-hub/commissionerOsContext')
    const result = await assembleCommissionerOsContext({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result).not.toBeNull()
    expect(result?.isCommissioner).toBe(true)
  })

  it('grants access to an imported ESPN commissioner via a real, recorded attestation (the real fix this phase made)', async () => {
    // Real invariant (confirmed via `lib/league-import/commissionerGate.ts::recordCommissionerVerificationMethod`):
    // the attesting appUserId is always the importer, and the importer is always `League.userId` at
    // creation time — so a realistic fixture must also satisfy the membership gate via ownership,
    // not attestation metadata alone.
    leagueFindUnique
      .mockResolvedValueOnce(
        baseLeague({
          userId: 'attested-commissioner',
          settings: { commissionerVerification: { method: 'attestation', appUserId: 'attested-commissioner' } },
        })
      )
      .mockResolvedValueOnce({ platform: 'espn', sport: 'NFL', season: 2026, isDynasty: false })
    const { assembleCommissionerOsContext } = await import('@/lib/shared-services/league-hub/commissionerOsContext')
    const result = await assembleCommissionerOsContext({ appUserId: 'attested-commissioner', canonicalLeagueId: 'league-1' })
    expect(result).not.toBeNull()
    expect(result?.isCommissioner).toBe(true)
  })

  it('rejects a caller whose attestation was made by a DIFFERENT app user — revoked/mismatched authority', async () => {
    // The caller here is a real league member (so it passes the membership gate and actually
    // exercises the attestation-mismatch branch) but the attestation on file names someone else.
    leagueFindUnique.mockResolvedValueOnce(
      baseLeague({
        redraftMembers: [{ role: 'member' }],
        settings: { commissionerVerification: { method: 'attestation', appUserId: 'the-real-attested-commissioner' } },
      })
    )
    const { assembleCommissionerOsContext } = await import('@/lib/shared-services/league-hub/commissionerOsContext')
    const result = await assembleCommissionerOsContext({ appUserId: 'someone-else', canonicalLeagueId: 'league-1' })
    expect(result).toBeNull()
  })

  it('rejects membership-only verification — explicitly means no commissioner claim was made', async () => {
    leagueFindUnique.mockResolvedValueOnce(
      baseLeague({
        redraftMembers: [{ role: 'member' }],
        settings: { commissionerVerification: { method: 'membership-only', appUserId: 'member-1' } },
      })
    )
    const { assembleCommissionerOsContext } = await import('@/lib/shared-services/league-hub/commissionerOsContext')
    const result = await assembleCommissionerOsContext({ appUserId: 'member-1', canonicalLeagueId: 'league-1' })
    expect(result).toBeNull()
  })

  it('flags a Fantrax CSV-imported league as snapshot-only, never claiming it is live', async () => {
    leagueFindUnique
      .mockResolvedValueOnce(
        baseLeague({
          userId: 'commissioner-1',
          platform: 'fantrax',
          settings: { commissionerVerification: { method: 'attestation', appUserId: 'commissioner-1' } },
        })
      )
      .mockResolvedValueOnce({ platform: 'fantrax', sport: 'NFL', season: 2026, isDynasty: false })
    const { assembleCommissionerOsContext } = await import('@/lib/shared-services/league-hub/commissionerOsContext')
    const result = await assembleCommissionerOsContext({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result?.isSnapshotOnly).toBe(true)
  })

  it('a live-sync provider (Sleeper) is never flagged snapshot-only', async () => {
    leagueFindUnique
      .mockResolvedValueOnce(baseLeague({ platform: 'sleeper', teams: [{ id: 'team-1', isCommissioner: true, isCoCommissioner: false }] }))
      .mockResolvedValueOnce({ platform: 'sleeper', sport: 'NFL', season: 2026, isDynasty: false })
    const { assembleCommissionerOsContext } = await import('@/lib/shared-services/league-hub/commissionerOsContext')
    const result = await assembleCommissionerOsContext({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result?.isSnapshotOnly).toBe(false)
  })

  it('marks rivalries/draft unavailable when the real engines have zero rows for this league — never fabricated', async () => {
    leagueFindUnique
      .mockResolvedValueOnce(baseLeague({ teams: [{ id: 'team-1', isCommissioner: true, isCoCommissioner: false }] }))
      .mockResolvedValueOnce({ platform: 'espn', sport: 'NFL', season: 2026, isDynasty: false })
    rivalryRecordFindMany.mockResolvedValue([])
    draftGradeFindMany.mockResolvedValue([])
    const { assembleCommissionerOsContext } = await import('@/lib/shared-services/league-hub/commissionerOsContext')
    const result = await assembleCommissionerOsContext({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result?.unavailableDomains).toContain('rivalries_history')
    expect(result?.unavailableDomains).toContain('draft_grades')
  })

  it('marks storylines unavailable for a non-NFL sport (multi-sport seam)', async () => {
    leagueFindUnique
      .mockResolvedValueOnce(baseLeague({ sport: 'NBA', teams: [{ id: 'team-1', isCommissioner: true, isCoCommissioner: false }] }))
      .mockResolvedValueOnce({ platform: 'espn', sport: 'NBA', season: 2026, isDynasty: false })
    const { assembleCommissionerOsContext } = await import('@/lib/shared-services/league-hub/commissionerOsContext')
    const result = await assembleCommissionerOsContext({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result?.unavailableDomains).toContain('storylines_weekly_cadence')
  })

  it('real eventCount reflects the TRUE total event count, not capped by the latest-event query limit', async () => {
    leagueFindUnique
      .mockResolvedValueOnce(baseLeague({ teams: [{ id: 'team-1', isCommissioner: true, isCoCommissioner: false }] }))
      .mockResolvedValueOnce({ platform: 'espn', sport: 'NFL', season: 2026, isDynasty: false })
    rivalryRecordFindMany.mockResolvedValue([
      {
        id: 'rivalry-1',
        managerAId: 'a',
        managerBId: 'b',
        rivalryScore: 80,
        rivalryTier: 'heated',
        events: [{ eventType: 'playoff_meeting', season: 2025 }],
        _count: { events: 7 },
      },
    ])
    const { assembleCommissionerOsContext } = await import('@/lib/shared-services/league-hub/commissionerOsContext')
    const result = await assembleCommissionerOsContext({ appUserId: 'commissioner-1', canonicalLeagueId: 'league-1' })
    expect(result?.rivalries[0]?.eventCount).toBe(7)
  })
})
