import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 🛑 THE GROUNDING PACKET IS THE WORST PLACE TO PUT A PLACEHOLDER LETTER — OR A SECOND ENGINE'S.
 *
 * `letterFor` bands C as -40..40 and an ungraded trade nets exactly 0, so a trade with nothing
 * credited produced `Manager: C (net +0 pts) — currently a tie` in this brief. The packet's own
 * closing line tells the model these are "the ONLY league-specific truths" and instructs it to
 * cite them, so a fabricated verdict here is handed over as something to reason from and repeat.
 *
 * 2026-11-26: the latest trade's letter is THE one grader's (`oneGradeForCompletedTrade` on one
 * `createLeagueTradeGrader`), and the trade-value basis is that grader's chart — never the ledger's
 * points-while-held letter nor `marketValueService`'s board. A withheld grade publishes its reason
 * and no letter. Both directions are pinned: no letter when there is no grade, and THE letter when
 * there is one.
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
    season: '2026',
    teams: 12,
    scoring: { format: 'half_ppr', idp: { emphasis: null } },
    variant: { idp: false, superflex: false, dynasty: true, keeper: false, bestBall: false },
    houseRules: { pirate: null },
  })),
}))

vi.mock('@/lib/trade-intel/marketValueService', () => ({
  getMarketValues: vi.fn(() => {
    throw new Error('the grounding must not read the old market service')
  }),
}))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({ getLeagueH2H: vi.fn(async () => null) }))

const gradesMock = vi.fn()
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ getTradeGrades: (...a: unknown[]) => gradesMock(...a) }))

const GRADER = {
  leagueId: 'L1',
  chart: { chartIsDynasty: true, isSuperFlex: true, leagueSize: 12, pprNfl: 0.5 },
}
const createLeagueTradeGrader = vi.fn(async (): Promise<unknown> => GRADER)
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({
  createLeagueTradeGrader: (...a: unknown[]) => createLeagueTradeGrader(...(a as [])),
}))
const oneGrade = vi.fn()
vi.mock('@/lib/decision-os/trade/completedTradeGrade', () => ({
  oneGradeForCompletedTrade: (...a: unknown[]) => oneGrade(...a),
}))
vi.mock('@/lib/decision-os/trade/frozenCompletedGrade', () => ({ loadFrozenCompletedGrades: vi.fn(async () => new Map()) }))

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
    // The ledger's OWN letter — a second scale, which must never reach the packet.
    currentGrade: 'A' as const,
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
    trades: [{ id: 't1', season: '2026', week: 1, createdIso: new Date().toISOString(), multiTeam: false, tie, hasPendingPicks: false, sides }],
    missing: [],
  }
}

const packetFor = async () => {
  const { resolveLeagueIntelligenceGrounding } = await import('@/lib/intelligence/chimmy/leagueIntelligenceGrounding')
  return resolveLeagueIntelligenceGrounding({ userId: 'u1', leagueId: 'L1' })
}

beforeEach(() => {
  oneGrade.mockReset()
  createLeagueTradeGrader.mockClear()
  createLeagueTradeGrader.mockResolvedValue(GRADER)
})

describe('Chimmy league grounding — the latest trade carries THE grade', () => {
  it('grades the latest trade with the league’s ONE grader and grounds its letters, not the ledger’s', async () => {
    gradesMock.mockResolvedValue(payload([side(1, 180), side(2, 0)], false))
    oneGrade.mockResolvedValue({ graded: true, letter: 'B', partnerLetter: 'D', label: 'Slightly favors Manager 1', percentDiff: 12 })
    const packet = await packetFor()

    expect(createLeagueTradeGrader).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1' })
    expect(oneGrade).toHaveBeenCalledTimes(1)
    const [leagueId, trade, season, deps] = oneGrade.mock.calls[0]!
    expect([leagueId, (trade as { id: string }).id, season]).toEqual(['L1', 't1', 2026])
    expect(await (deps as { graderFor: () => Promise<unknown> }).graderFor()).toBe(GRADER)

    expect(packet).toMatch(/Manager 1: B; Manager 2: D — Slightly favors Manager 1 \(league trade grade/)
    expect(packet).not.toMatch(/Manager 1: A/) // the ledger's own letter
    expect(packet).not.toMatch(/net \+180 pts/)
    expect(packet).toMatch(/Trade values: this league's AllFantasy trade grade — the league chart \(dynasty, superflex, 12-team, 0.5 PPR\)/)
  })

  it('a withheld grade grounds its reason and NO letter, a net, or a tie', async () => {
    gradesMock.mockResolvedValue(payload([side(1, null), side(2, null)], true))
    oneGrade.mockResolvedValue({ graded: false, reason: '1 asset has no value on this league’s chart.', basis: null })
    const packet = await packetFor()

    expect(packet).not.toMatch(/Manager 1: [A-F]/)
    expect(packet).not.toMatch(/net \+0 pts/)
    expect(packet).not.toMatch(/currently a tie/)
    expect(packet).toMatch(/not graded: 1 asset has no value on this league’s chart\. Do not call it even/)
    /* The trade is still mentioned — the ledger count and the managers are real facts. */
    expect(packet).toMatch(/Manager 1 \/ Manager 2/)
  })

  it('no grader: no letter and no value basis, said plainly', async () => {
    createLeagueTradeGrader.mockResolvedValue(null)
    gradesMock.mockResolvedValue(payload([side(1, 180), side(2, 0)], false))
    const packet = await packetFor()
    expect(oneGrade).not.toHaveBeenCalled()
    expect(packet).not.toMatch(/Trade values:/)
    expect(packet).not.toMatch(/Manager 1: [A-F]/)
    expect(packet).toMatch(/not graded: the league trade grade could not be read just now/)
  })
})
