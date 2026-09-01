/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 3/4 tests:
 * the authorization boundary (native/imported/attested commissioner access,
 * normal-manager rejection, cross-user rejection, revoked authority, deleted
 * league, stale attestation metadata) and the context assembler's real reads
 * (rivalries/drama/draft-grade unavailable-domain computation, snapshot-only
 * detection).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  leagueFindUnique,
  rosterFindFirst,
  leagueSeasonFindMany,
  rivalryRecordFindMany,
  dramaEventFindMany,
  draftGradeFindMany,
  redraftLeagueMemberFindUnique,
  rosterCount,
  leagueTeamFindFirst,
} = vi.hoisted(() => ({
    leagueFindUnique: vi.fn(),
    rosterFindFirst: vi.fn(),
    leagueSeasonFindMany: vi.fn(),
    rivalryRecordFindMany: vi.fn(),
    dramaEventFindMany: vi.fn(),
    draftGradeFindMany: vi.fn(),
    /*
     * ── 🛑 THREE MOCKS THE SUITE NEVER HAD, AND WHY IT WENT RED WITHOUT THEM ────────────────
     *
     * `resolveLeagueMembership` resolves access as a four-rung ladder: owner -> redraft member
     * -> roster -> claimed team. This mock stubbed `league` and `roster.findFirst` and nothing
     * else, so the moment `lib/league-access.ts` grew the other three queries, seven tests died
     * on `Cannot read properties of undefined (reading 'findUnique')` — the mock rotting because
     * the module under test changed, which the root CLAUDE.md records for the FantasyCalc
     * migration in exactly these words.
     */
    redraftLeagueMemberFindUnique: vi.fn(),
    rosterCount: vi.fn(),
    leagueTeamFindFirst: vi.fn(),
  }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUnique },
    roster: { findFirst: rosterFindFirst, count: rosterCount },
    leagueSeason: { findMany: leagueSeasonFindMany },
    rivalryRecord: { findMany: rivalryRecordFindMany },
    dramaEvent: { findMany: dramaEventFindMany },
    draftGrade: { findMany: draftGradeFindMany },
    redraftLeagueMember: { findUnique: redraftLeagueMemberFindUnique },
    leagueTeam: { findFirst: leagueTeamFindFirst },
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
    redraftLeagueMemberFindUnique.mockReset()
    rosterCount.mockReset()
    leagueTeamFindFirst.mockReset()

    /*
     * ── ⚠ THE DEFAULTS READ THE FIXTURE EACH TEST ALREADY SUPPLIED ────────────────────────
     *
     * `baseLeague()` carries `redraftMembers: []` and `teams: []`, and a test opts into
     * membership by overriding one of them. That shape predates `lib/league-access.ts` splitting
     * those reads into their own queries — it used to get them through an `include` on the league.
     *
     * So rather than hardcoding a default (which would silently GRANT access in the rejection
     * tests, turning a red suite green by breaking what it actually checks), these derive from
     * the league the test itself mocked. `mock.results[0]` is the first `league.findUnique` call
     * — the membership lookup — and its `.value` is the promise that call returned.
     *
     * Net effect: every test keeps the exact intent it was written with, and none of the seven
     * needed editing.
     */
    async function fixtureLeague(): Promise<Record<string, unknown> | null> {
      const first = leagueFindUnique.mock.results[0]
      if (!first || first.type !== 'return') return null
      try {
        return (await first.value) as Record<string, unknown> | null
      } catch {
        return null
      }
    }

    redraftLeagueMemberFindUnique.mockImplementation(async () => {
      const league = await fixtureLeague()
      const m = (league?.redraftMembers as Array<{ role?: string }> | undefined)?.[0]
      return m ? { role: m.role } : null
    })

    // No fixture field describes roster membership, and no test exercises that rung.
    rosterCount.mockImplementation(async () => 0)

    /*
     * ── ⚠ AND THE LADDER ADDED A THIRD `league.findUnique`, WHICH STARVED THE QUEUE ────────
     *
     * These tests queue exactly two values, because there used to be exactly two calls:
     * `resolveActiveLeagueContext`'s own lookup, then `assembleCommissionerOsContext`'s. The
     * canonical membership predicate now makes its own, in between — so the second queued value
     * (the platform/sport/season row) was being consumed by the membership check and the real
     * consumer got `undefined`, which reads downstream as "no access" rather than as a starved
     * mock.
     *
     * A base implementation runs only once the `mockResolvedValueOnce` queue is EXHAUSTED, so
     * this changes nothing about the values the tests deliberately queued — it only stops an
     * extra call returning undefined. Falling back to the first fixture is right because that is
     * the full league row; the queued second value is a projection of the same league.
     */
    leagueFindUnique.mockImplementation(async () => {
      const first = leagueFindUnique.mock.results[0]
      if (!first || first.type !== 'return') return null
      try {
        return await first.value
      } catch {
        return null
      }
    })

    leagueTeamFindFirst.mockImplementation(async () => {
      const league = await fixtureLeague()
      const t = (league?.teams as Array<{ isCommissioner?: boolean; isCoCommissioner?: boolean }> | undefined)?.[0]
      return t
        ? { isCommissioner: Boolean(t.isCommissioner), isCoCommissioner: Boolean(t.isCoCommissioner) }
        : null
    })
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
      // ⚠ QUEUED TWICE. The canonical membership predicate makes its own `league.findUnique`
      // between the resolver's and the assembler's, and the OWNER rung it grants on reads
      // `userId` — which the projection below does not carry. Without this the owner check
      // silently misses and the league reads as "not a member".
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
      // ⚠ QUEUED TWICE — same reason as the attestation test above: the membership predicate's
      // own lookup sits between the other two, and the owner rung needs `userId`.
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
