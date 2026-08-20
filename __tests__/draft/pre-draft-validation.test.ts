import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DraftValidationOrchestrator } from '@/lib/draft/validation/DraftValidationOrchestrator'
import { prisma } from '@/lib/prisma'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'

/*
 * Check 3 (roster slots) no longer reads `League.starters` directly — it delegates to the shared
 * `getEffectiveLeagueRosterTemplate`, which resolves LeagueRosterConfig / starters /
 * settings.rosterPositions / sport-specific configs. Unmocked, that helper hits delegates this
 * suite does not stub, so the check fell into its catch and reported "Could not resolve roster
 * template" — which is why the all-checks-pass case failed while every failure case still passed.
 * A stale mock against the old contract, not a validation bug.
 */
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({
  getEffectiveLeagueRosterTemplate: vi.fn(async () => ({
    hasPersistedRosterSchema: true,
    template: {
      slots: [
        { starterCount: 9, benchCount: 6, reserveCount: 1, taxiCount: 0, devyCount: 0 },
      ],
    },
  })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(),
    },
    draftSession: {
      findUnique: vi.fn(),
    },
    roster: {
      findMany: vi.fn(),
    },
  },
}))

describe('Pre-Draft Validation', () => {
  const leagueId = 'test-league-123'
  const draftId = 'test-draft-456'

  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks wipes the factory implementation too, so the passing default is re-set here
    // and individual tests override it to describe an unconfigured roster.
    vi.mocked(getEffectiveLeagueRosterTemplate).mockResolvedValue({
      hasPersistedRosterSchema: true,
      template: {
        slots: [{ starterCount: 9, benchCount: 6, reserveCount: 1, taxiCount: 0, devyCount: 0 }],
      },
    } as never)
  })

  /**
   * Default-pass mock setup. Each test starts from this baseline and
   * overrides only the call(s) it needs to fail. The orchestrator queries
   * Prisma several times (rosters twice, league twice, draftSession twice),
   * so we set the mocks to return the canonical happy-path shape.
   *
   * Note: Roster ownership is keyed on `platformUserId` (not `userId`) per
   * the committed Prisma schema. League roster/scoring shape lives on the
   * `League` row (`rosterSize`, `starters`, `scoring`), NOT `LeagueSettings`.
   * Draft type lives on `DraftSession.draftType` — there is no top-level
   * `prisma.draft` model.
   */
  const setHappyPathMocks = () => {
    ;(prisma.roster.findMany as any).mockResolvedValue([
      { id: 'r1', platformUserId: 'u1' },
      { id: 'r2', platformUserId: 'u2' },
    ])
    ;(prisma.draftSession.findUnique as any).mockResolvedValue({
      id: draftId,
      slotOrder: [
        { rosterId: 'r1', position: 1 },
        { rosterId: 'r2', position: 2 },
      ],
      status: 'pre_draft',
      draftType: 'snake',
    })
    ;(prisma.league.findUnique as any).mockResolvedValue({
      id: leagueId,
      rosterSize: 16,
      starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
      scoring: 'half_ppr',
    })
  }

  describe('DraftValidationOrchestrator', () => {
    it('returns canStartDraft=true when all checks pass', async () => {
      setHappyPathMocks()

      const report = await DraftValidationOrchestrator.validateDraft(leagueId, draftId)

      expect(report.canStartDraft).toBe(true)
      expect(report.results).toHaveLength(6)
      expect(report.results.every((r) => r.status !== 'fail')).toBe(true)
    })

    it('returns canStartDraft=false when teams are not filled (empty platformUserId)', async () => {
      setHappyPathMocks()
      ;(prisma.roster.findMany as any).mockResolvedValue([
        { id: 'r1', platformUserId: 'u1' },
        { id: 'r2', platformUserId: '' }, // unclaimed slot
      ])

      const report = await DraftValidationOrchestrator.validateDraft(leagueId, draftId)

      expect(report.canStartDraft).toBe(false)
      const teamsFilled = report.results.find((r) => r.key === 'teams_filled')
      expect(teamsFilled?.status).toBe('fail')
      expect(teamsFilled?.message).toContain('1 slot')
    })

    it('returns canStartDraft=false when draft order is not set', async () => {
      setHappyPathMocks()
      ;(prisma.draftSession.findUnique as any).mockResolvedValue({
        id: draftId,
        slotOrder: [], // empty order blocks start
        status: 'pre_draft',
        draftType: 'snake',
      })

      const report = await DraftValidationOrchestrator.validateDraft(leagueId, draftId)

      expect(report.canStartDraft).toBe(false)
      const draftOrder = report.results.find((r) => r.key === 'draft_order')
      expect(draftOrder?.status).toBe('fail')
    })

    it('returns canStartDraft=false when scoring is not configured', async () => {
      setHappyPathMocks()
      ;(prisma.league.findUnique as any).mockResolvedValue({
        id: leagueId,
        rosterSize: 16,
        starters: { QB: 1 },
        scoring: null, // missing scoring
      })

      const report = await DraftValidationOrchestrator.validateDraft(leagueId, draftId)

      expect(report.canStartDraft).toBe(false)
      const scoring = report.results.find((r) => r.key === 'scoring_settings')
      expect(scoring?.status).toBe('fail')
    })

    it('returns canStartDraft=false when roster shape is empty', async () => {
      setHappyPathMocks()
      /*
       * "Empty roster shape" is now expressed through the shared template resolver, not through
       * `League.starters`. Setting starters: {} no longer means anything to this check — the
       * orchestrator asks getEffectiveLeagueRosterTemplate and fails when nothing is persisted.
       */
      vi.mocked(getEffectiveLeagueRosterTemplate).mockResolvedValue({
        hasPersistedRosterSchema: false,
        template: { slots: [] },
      } as never)

      const report = await DraftValidationOrchestrator.validateDraft(leagueId, draftId)

      expect(report.canStartDraft).toBe(false)
      const roster = report.results.find((r) => r.key === 'roster_slots')
      expect(roster?.status).toBe('fail')
    })

    it('reports duplicate users in rosters', async () => {
      setHappyPathMocks()
      ;(prisma.roster.findMany as any).mockResolvedValue([
        { id: 'r1', platformUserId: 'u1' },
        { id: 'r2', platformUserId: 'u1' }, // same user twice
      ])

      const report = await DraftValidationOrchestrator.validateDraft(leagueId, draftId)

      expect(report.canStartDraft).toBe(false)
      const duplicateUsers = report.results.find((r) => r.key === 'no_duplicate_users')
      expect(duplicateUsers?.status).toBe('fail')
    })

    it('returns canStartDraft=false when draft type is missing', async () => {
      setHappyPathMocks()
      ;(prisma.draftSession.findUnique as any).mockResolvedValue({
        id: draftId,
        slotOrder: [{ rosterId: 'r1', position: 1 }],
        status: 'pre_draft',
        draftType: '', // unset draft type
      })

      const report = await DraftValidationOrchestrator.validateDraft(leagueId, draftId)

      expect(report.canStartDraft).toBe(false)
      const draftType = report.results.find((r) => r.key === 'draft_type')
      expect(draftType?.status).toBe('fail')
    })

    it('handles errors gracefully — one bad check does not block other checks', async () => {
      setHappyPathMocks()
      ;(prisma.roster.findMany as any).mockRejectedValueOnce(new Error('DB error'))

      const report = await DraftValidationOrchestrator.validateDraft(leagueId, draftId)

      // The DB-error check fails, but the orchestrator still returns a
      // structured report covering the remaining checks.
      expect(report.canStartDraft).toBe(false)
      expect(report.results.some((r) => r.status === 'fail')).toBe(true)
      expect(report.results.length).toBeGreaterThanOrEqual(1)
      expect(report).toMatchObject({
        leagueId,
        draftId,
        timestamp: expect.any(String),
      })
    })

    it('returns the canonical report shape', async () => {
      setHappyPathMocks()

      const report = await DraftValidationOrchestrator.validateDraft(leagueId, draftId)

      expect(report).toMatchObject({
        leagueId,
        draftId,
        canStartDraft: expect.any(Boolean),
        results: expect.any(Array),
        timestamp: expect.any(String),
      })
      for (const r of report.results) {
        expect(r).toMatchObject({
          key: expect.any(String),
          label: expect.any(String),
          status: expect.stringMatching(/^(pass|fail|warning)$/),
        })
      }
    })
  })
})
