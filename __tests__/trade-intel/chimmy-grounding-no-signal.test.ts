import { describe, expect, it, vi } from 'vitest'

/*
 * 🛑 THE GROUNDING PACKET IS THE WORST PLACE TO PUT A PLACEHOLDER LETTER.
 *
 * `letterFor` bands C as -40..40 and an ungraded trade nets exactly 0, so a trade with nothing
 * credited produced `Manager: C (net +0 pts) — currently a tie` in this brief. The packet's own
 * closing line tells the model these are "the ONLY league-specific truths" and instructs it to
 * cite them and never invent beyond them — so unlike a screen, which a reader can discount, this
 * hands a fabricated verdict over as something to reason from and repeat.
 *
 * Separate file from the other no-signal surfaces because the prisma mock this module needs is a
 * different shape, and one `vi.mock('@/lib/prisma')` is hoisted per file.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: vi.fn(async () => ({
        name: 'Test League',
        platform: 'sleeper',
        platformLeagueId: '123',
        leagueType: null,
        settings: {},
      })),
    },
  },
}))

vi.mock('@/lib/league-context/leagueContextService', () => ({
  getLeagueContext: vi.fn(async () => ({
    name: 'Test League',
    teams: 12,
    scoring: { format: 'half_ppr', idp: { emphasis: null } },
    variant: { idp: false, superflex: false, dynasty: true, keeper: false, bestBall: false },
    houseRules: { pirate: null },
  })),
}))

vi.mock('@/lib/trade-intel/marketValueService', () => ({ getMarketValues: vi.fn(async () => null) }))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({ getLeagueH2H: vi.fn(async () => null) }))

const gradesMock = vi.fn()
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ getTradeGrades: gradesMock }))

function side(rosterId: number, credited: number | null) {
  return {
    rosterId,
    ownerId: `owner-${rosterId}`,
    managerName: `Manager ${rosterId}`,
    teamName: null,
    avatar: null,
    playersIn: [{ name: 'Player', creditedBySeason: credited == null ? {} : { '2026': credited } }],
    playersOut: [],
    picksIn: [],
    picksOut: [],
    seasonNets: [{ season: '2026', net: credited ?? 0, partial: false }],
    cumulativeNet: credited ?? 0,
    initialGrade: 'C' as const,
    currentGrade: 'C' as const,
    trend: 'steady' as const,
  }
}

function payload(sides: unknown[], tie: boolean) {
  return {
    version: 2,
    fetchedAt: new Date().toISOString(),
    staleAsOf: null,
    sleeperLeagueId: '123',
    seasonsScanned: ['2026'],
    currentSeasonPartial: true,
    gradeScale: { description: '', thresholds: [], tieBand: 60 },
    contextNotes: [],
    trades: [
      {
        id: 't1',
        season: '2026',
        week: 1,
        createdIso: new Date().toISOString(),
        multiTeam: false,
        tie,
        hasPendingPicks: false,
        sides,
      },
    ],
    missing: [],
  }
}

describe('Chimmy league grounding — trade grades', () => {
  it('does not ground a letter, a net, or a tie when nothing has been credited', async () => {
    gradesMock.mockResolvedValue(payload([side(1, null), side(2, null)], true))

    const { resolveLeagueIntelligenceGrounding } = await import(
      '@/lib/intelligence/chimmy/leagueIntelligenceGrounding'
    )
    const packet = await resolveLeagueIntelligenceGrounding({ userId: 'u1', leagueId: 'L1' })

    expect(packet).not.toBeNull()
    /* The behavioural claim: no letter is asserted for either manager. */
    expect(packet).not.toMatch(/Manager 1: C/)
    expect(packet).not.toMatch(/net \+0 pts/)
    expect(packet).not.toMatch(/currently a tie/)
    expect(packet).toMatch(/too early to grade/i)
    /* The trade is still mentioned — the ledger count and the managers are real facts. */
    expect(packet).toMatch(/Manager 1/)
  })

  /*
   * ⚠ THE CONTROL IN THE OTHER DIRECTION. Suppressing the summary altogether would pass the
   * assertions above while removing a real, useful ground truth from every chat turn.
   */
  it('still grounds the grades of a trade that has produced points', async () => {
    gradesMock.mockResolvedValue(payload([side(1, 180), side(2, 0)], false))

    const { resolveLeagueIntelligenceGrounding } = await import(
      '@/lib/intelligence/chimmy/leagueIntelligenceGrounding'
    )
    const packet = await resolveLeagueIntelligenceGrounding({ userId: 'u1', leagueId: 'L1' })

    expect(packet).toMatch(/Manager 1: C \(net \+180 pts\)/)
    expect(packet).not.toMatch(/too early to grade/i)
  })
})
