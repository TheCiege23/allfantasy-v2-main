// @vitest-environment node
/**
 * The league trade finder (`/api/league/trade-finder` → `getTradeFinder`) takes its VERDICT from the
 * one grader (2026-11-26).
 *
 * Generation (complementary needs, a cheap ADP band) stays the service's. The fairness band, the
 * values shown, the "% apart" and the order are THE grade's: `gradeDeal` on ONE
 * `createLeagueTradeGrader`, injected by the route. Before this they were `marketValueService`'s
 * FantasyCalc numbers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const CONTEXT = {
  season: '2026',
  adpKey: 'ppr',
  adpKeyLabel: 'PPR ADP',
  roster: { starters: { QB: 1, RB: 1, WR: 1 } },
  houseRules: {},
}
vi.mock('@/lib/league-context/leagueContextService', () => ({ getLeagueContext: vi.fn(async () => CONTEXT) }))

const P = (playerId: string, name: string, position: string, adp: number) => ({ playerId, name, position, team: 'FA', yearsExp: 3, adp: { ppr: adp } })
const BOARD = {
  version: 1,
  season: '2026',
  players: Object.fromEntries(
    [
      // Me: weak RB starter (ADP 150), spare WR on the bench.
      P('q1', 'My QB', 'QB', 10), P('r1', 'My RB', 'RB', 150), P('w1', 'My WR', 'WR', 20), P('w2', 'Spare WR', 'WR', 50),
      // Partner 1 (an active trader): weak WR starter, spare RB.
      P('q2', 'T1 QB', 'QB', 12), P('r2', 'T1 RB', 'RB', 30), P('w3', 'T1 WR', 'WR', 160), P('r3', 'Spare RB One', 'RB', 60),
      // Partner 2 (never traded): the same shape.
      P('q3', 'T2 QB', 'QB', 14), P('r4', 'T2 RB', 'RB', 32), P('w4', 'T2 WR', 'WR', 170), P('r5', 'Spare RB Two', 'RB', 55),
    ].map((p) => [p.playerId, p]),
  ),
}
vi.mock('@/lib/sports-data/sleeperMarketService', () => ({ getSeasonBoard: vi.fn(async () => BOARD) }))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({
  getTradeGrades: vi.fn(async () => ({ trades: [1, 2, 3].map(() => ({ sides: [{ ownerId: 't1' }, { ownerId: 'x' }] })) })),
}))

const ROSTERS = [
  { roster_id: 1, owner_id: 'me', players: ['q1', 'r1', 'w1', 'w2'] },
  { roster_id: 2, owner_id: 't1', players: ['q2', 'r2', 'w3', 'r3'] },
  { roster_id: 3, owner_id: 't2', players: ['q3', 'r4', 'w4', 'r5'] },
]
const USERS = [
  { user_id: 'me', display_name: 'Me', avatar: null },
  { user_id: 't1', display_name: 'Active', avatar: null },
  { user_id: 't2', display_name: 'Quiet', avatar: null },
]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).endsWith('/rosters') ? ROSTERS : USERS),
  })))
})

const graded = (letter: string, percentDiff: number, giveValue: number, getValue: number) => ({
  graded: true, letter, partnerLetter: 'C', percentDiff, label: `label ${letter}`, giveValue, getValue, lines: [],
})
const getName = (get: { assets: Array<{ name?: string }> }) => get.assets[0]!.name

describe('getTradeFinder — the verdict is THE grade', () => {
  it('grades each generated 1-for-1 from the viewer’s side with Sleeper ids qualified as Sleeper’s', async () => {
    const { getTradeFinder } = await import('@/lib/trade-intel/tradeFinderService')
    const grade = vi.fn(async () => graded('B', 2, 5000, 5100))
    await getTradeFinder('SL1', 'me', { grade })
    expect(grade).toHaveBeenCalledTimes(2)
    expect(grade).toHaveBeenCalledWith(
      { assets: [{ kind: 'player', name: 'Spare WR', providerIdentity: { provider: 'sleeper', id: 'w2' } }], unpriceable: [] },
      { assets: [{ kind: 'player', name: 'Spare RB One', providerIdentity: { provider: 'sleeper', id: 'r3' } }], unpriceable: [] },
    )
  })

  it('filters on the grade’s band and shows the grade’s values, not a market chart’s', async () => {
    const { getTradeFinder } = await import('@/lib/trade-intel/tradeFinderService')
    // Partner 1's deal is outside ±20% on THE grade; partner 2's is close.
    const grade = vi.fn(async (_give: unknown, get: { assets: Array<{ name?: string }> }) =>
      getName(get) === 'Spare RB One' ? graded('A', 35, 4000, 5400) : graded('B', -4, 5000, 4800),
    )
    const finder = (await getTradeFinder('SL1', 'me', { grade }))!
    expect(finder.proposals.map((p) => p.partner.name)).toEqual(['Quiet'])
    const [p] = finder.proposals
    expect(p!.leagueGrade).toMatchObject({ graded: true, letter: 'B', percentDiff: -4 })
    expect(p!.valueGapPct).toBe(4)
    expect(p!.give.marketValue).toBe(5000)
    expect(p!.get.marketValue).toBe(4800)
    expect(p!.rationale.at(-1)).toMatch(/^League grade B for you/)
    expect(finder.contextNotes[0]).toMatch(/AllFantasy trade grade/)
  })

  it('a withheld grade is SHOWN with its reason, after every graded proposal — even a more active partner’s', async () => {
    const { getTradeFinder } = await import('@/lib/trade-intel/tradeFinderService')
    const grade = vi.fn(async (_give: unknown, get: { assets: Array<{ name?: string }> }) =>
      getName(get) === 'Spare RB One'
        ? { graded: false as const, reason: '1 asset has no value on this league’s chart', basis: null }
        : graded('C', 10, 5000, 5500),
    )
    const finder = (await getTradeFinder('SL1', 'me', { grade: grade as never }))!
    expect(finder.proposals.map((p) => p.partner.name)).toEqual(['Quiet', 'Active'])
    const withheld = finder.proposals[1]!
    expect(withheld.leagueGrade).toEqual({ graded: false, reason: '1 asset has no value on this league’s chart' })
    expect(withheld.valueGapPct).toBeNull()
    expect(withheld.give.marketValue).toBeNull()
    expect(withheld.rationale.at(-1)).toBe('Not graded: 1 asset has no value on this league’s chart')
  })

  it('no grade at all: nothing graded, nothing invented, and it says so', async () => {
    const { getTradeFinder } = await import('@/lib/trade-intel/tradeFinderService')
    const finder = (await getTradeFinder('SL1', 'me'))!
    expect(finder.missing).toContain('league trade grade')
    expect(finder.proposals.every((p) => !p.leagueGrade.graded && p.valueGapPct == null && p.get.marketValue == null)).toBe(true)
  })
})

describe('/api/league/trade-finder — ONE grader for the league, injected into the finder', () => {
  it('creates the grader for the AF league and grades through gradeDeal from the viewer’s side', async () => {
    vi.resetModules()
    const getTradeFinder = vi.fn(async (_l: string, _u: string, opts: { grade: (g: unknown, h: unknown) => Promise<unknown> }) => {
      await opts.grade({ assets: [], unpriceable: [] }, { assets: [], unpriceable: [] })
      await opts.grade({ assets: [], unpriceable: [] }, { assets: [], unpriceable: [] })
      return { proposals: [] }
    })
    const grader = { leagueId: 'L1' }
    const createLeagueTradeGrader = vi.fn(async () => grader)
    const gradeDeal = vi.fn(async () => ({ graded: false, reason: 'x', basis: null }))
    vi.doMock('@/lib/trade-intel/tradeFinderService', () => ({ getTradeFinder }))
    vi.doMock('@/lib/decision-os/trade/leagueTradeGrader', () => ({ createLeagueTradeGrader, gradeDeal }))
    vi.doMock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    vi.doMock('@/lib/core-app/corePaywall', () => ({ resolveCoreDepth: vi.fn(async () => ({ unlocked: true })) }))
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        league: { findFirst: vi.fn(async () => ({ id: 'L1', platform: 'sleeper', platformLeagueId: 'SL1' })) },
        userProfile: { findUnique: vi.fn(async () => ({ sleeperUserId: 'me' })) },
      },
    }))
    const { GET } = await import('@/app/api/league/trade-finder/route')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/api/league/trade-finder?leagueId=L1'))
    expect(res.status).toBe(200)
    expect(createLeagueTradeGrader).toHaveBeenCalledTimes(1)
    expect(createLeagueTradeGrader).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1' })
    expect(gradeDeal).toHaveBeenCalledTimes(2)
    for (const call of gradeDeal.mock.calls as unknown as Array<[unknown, { viewerSide: boolean }]>) {
      expect(call[0]).toBe(grader)
      expect(call[1].viewerSide).toBe(true)
    }
  })
})
