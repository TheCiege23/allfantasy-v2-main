// @vitest-environment node
/**
 * The redraft package finder (`/api/redraft/trades/package-finder`) takes its VERDICT from the one
 * grader (2026-11-26).
 *
 * `findPackages` still generates the packages on the discovery roster values. The band, totals,
 * `VALUE_GAP_HIGH`, `canStartProposal` and the order are re-taken on `gradeDeal` over ONE
 * `createLeagueTradeGrader` for the league. Pinned by making the two disagree: on the finder's values
 * the RB1 deal is dead even and ranks first; on THE grade it is lopsided.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.fn(async () => ({ user: { id: 'u-me' } }))
vi.mock('next-auth', () => ({ getServerSession: () => session() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
const commish = vi.fn(async () => false)
vi.mock('@/lib/league/permissions', () => ({ hasLeagueCommissionerRights: () => commish() }))
vi.mock('@/lib/trade-block/redraftTradeBlockService', () => ({
  discoverySignals: vi.fn(async () => ({ blockPlayerIdsByRoster: {}, hasNativeBlock: true })),
}))

const pl = (playerId: string, position: string, value: number) => ({ playerId, playerName: `Name ${playerId}`, position, value, isLocked: false })
const roster = (rosterId: string, players: ReturnType<typeof pl>[]) => ({
  rosterId, teamName: `Team ${rosterId}`, stance: 'middle', weakPositions: [], strongPositions: [], players, faabBalance: 0,
})
const LEAGUE = () => ({
  sport: 'NFL',
  draftPickTrading: true,
  ownerByRoster: new Map([['R1', 'u-me'], ['R2', 'u-them']]),
  rosters: [
    // Me: one RB (a need), four WRs (surplus).
    roster('R1', [pl('q1', 'QB', 6000), pl('rb0', 'RB', 4000), pl('w1', 'WR', 5000), pl('w2', 'WR', 4800), pl('w3', 'WR', 3000), pl('w4', 'WR', 2000), pl('t1', 'TE', 3000)]),
    // Partner: two RBs I can get.
    roster('R2', [pl('q2', 'QB', 6000), pl('r1', 'RB', 5000), pl('r2', 'RB', 2600), pl('w5', 'WR', 4000), pl('w6', 'WR', 3500), pl('t2', 'TE', 2500)]),
  ],
})
vi.mock('@/lib/trade-discovery/assembleRosters', () => ({ assembleDiscoveryLeague: vi.fn(async () => LEAGUE()) }))

const grader = { leagueId: 'L1' }
const createLeagueTradeGrader = vi.fn(async () => grader)
const gradeDeal = vi.fn()
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({
  createLeagueTradeGrader: (...a: unknown[]) => createLeagueTradeGrader(...(a as [])),
  gradeDeal: (...a: unknown[]) => gradeDeal(...a),
}))

const graded = (letter: string, giveValue: number, getValue: number) => ({
  graded: true, letter, partnerLetter: 'C', percentDiff: 0, label: `label ${letter}`, giveValue, getValue, lines: [],
})
const getsId = (args: { get: { assets: Array<{ playerId?: string }> } }) => args.get.assets[0]?.playerId

async function post(body: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/redraft/trades/package-finder/route')
  const res = await POST(new NextRequest('http://localhost/api/redraft/trades/package-finder', {
    method: 'POST',
    body: JSON.stringify({ leagueId: 'L1', myRosterId: 'R1', partnerRosterId: 'R2', ...body }),
  }))
  return { status: res.status, body: (await res.json()) as any }
}

beforeEach(() => {
  gradeDeal.mockReset()
  createLeagueTradeGrader.mockClear()
  commish.mockResolvedValue(false)
})

describe('/api/redraft/trades/package-finder — the verdict is THE grade', () => {
  it('grades every package with ONE grader for the league, from the caller’s own side', async () => {
    gradeDeal.mockImplementation(async () => graded('B', 3000, 3000))
    const { status, body } = await post()
    expect(status).toBe(200)
    expect(createLeagueTradeGrader).toHaveBeenCalledTimes(1)
    expect(createLeagueTradeGrader).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u-me' })
    expect(gradeDeal.mock.calls.length).toBe(body.suggestedPackages.length)
    for (const [g, args] of gradeDeal.mock.calls) {
      expect(g).toBe(grader)
      expect(args.viewerSide).toBe(true)
    }
    expect(gradeDeal.mock.calls[0]![1].give.assets[0]).toEqual({ kind: 'player', playerId: 'w1', name: 'Name w1' })
  })

  it('band, totals, flags, startability and ORDER come from the grade, not the finder’s values', async () => {
    gradeDeal.mockImplementation(async (_g: unknown, args: { get: { assets: Array<{ playerId?: string }> } }) =>
      getsId(args) === 'r1' ? graded('A', 5000, 9000) : graded('C', 3000, 3000),
    )
    const { body } = await post()
    const order = body.suggestedPackages.map((p: any) => p.receiveAssets[0].playerId)
    // The finder ranks r1 first (5000 for 5000 on its values); the grade calls it lopsided.
    expect(order).toEqual(['r2', 'r1'])
    const [even, lopsided] = body.suggestedPackages
    expect(even).toMatchObject({ fairnessBand: 'balanced', myTotalValue: 3000, partnerTotalValue: 3000, valueDelta: 0, canStartProposal: true })
    expect(even.leagueGrade).toMatchObject({ graded: true, letter: 'C' })
    expect(lopsided).toMatchObject({ fairnessBand: 'lopsided', myTotalValue: 5000, partnerTotalValue: 9000, valueDelta: 4000, canStartProposal: false })
    expect(lopsided.warningFlags).toContain('VALUE_GAP_HIGH')
    expect(lopsided.reasons).not.toContain('Values are close — fair starting point')
    expect(lopsided.reasons).toContain('League grade A for you — label A')
    expect(body.canStartProposal).toBe(true)
  })

  it('a withheld grade is SHOWN: low confidence, no totals, cannot start, the reason kept', async () => {
    gradeDeal.mockResolvedValue({ graded: false, reason: '1 asset has no value on this league’s chart', basis: null })
    const { body } = await post()
    expect(body.suggestedPackages.length).toBeGreaterThan(0)
    for (const p of body.suggestedPackages) {
      expect(p).toMatchObject({ fairnessBand: 'low confidence', myTotalValue: null, partnerTotalValue: null, valueDelta: null, canStartProposal: false })
      expect(p.warningFlags).toContain('LOW_DATA_CONFIDENCE')
      expect(p.leagueGrade).toEqual({ graded: false, reason: '1 asset has no value on this league’s chart' })
    }
    expect(body.canStartProposal).toBe(false)
  })

  it('a commissioner building from ANOTHER team is graded on league value, never their own roster need', async () => {
    session.mockResolvedValueOnce({ user: { id: 'u-commish' } })
    commish.mockResolvedValue(true)
    gradeDeal.mockImplementation(async () => graded('B', 3000, 3000))
    const { status } = await post()
    expect(status).toBe(200)
    expect(gradeDeal.mock.calls.every(([, args]) => args.viewerSide === false)).toBe(true)
  })
})
