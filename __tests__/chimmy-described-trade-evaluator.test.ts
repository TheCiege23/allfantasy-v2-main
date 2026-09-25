import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  adpFindMany: vi.fn(),
  projFindMany: vi.fn(),
  projFindFirst: vi.fn(),
  marketFindMany: vi.fn(),
}))

/*
 * ⚠ THE TWO NEW TABLES ARE MOCKED BECAUSE THE MODULE NOW READS THEM. Leaving them out is not a
 * neutral omission — `prisma.aFProjectionSnapshot` would be `undefined` and every test in this
 * file dies with `Cannot read properties of undefined`, which is exactly what happened when the
 * projection basis landed. A mock that lags the module under test is a suite that stops testing.
 */
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    adpDataRecord: { findMany: mocks.adpFindMany },
    aFProjectionSnapshot: { findMany: mocks.projFindMany, findFirst: mocks.projFindFirst },
    allFantasyMarketPlayerValue: { findMany: mocks.marketFindMany },
  },
}))

import {
  buildDescribedTradeContext,
  extractPlayerNameCandidates,
} from '@/lib/chimmy-trade/describedTradeEvaluator'
import { gradeTrade } from '@/lib/trade-value/tradeGrade'

/* THE grade for 4000 out, 6000 in, by the real scale — an A for side 1, an F for side 2. */
const oneGrade = vi.fn(async () =>
  gradeTrade({
    giveValue: 4000,
    getValue: 6000,
    giveMarket: 4000,
    getMarket: 6000,
    unpriced: 0,
    giveCount: 1,
    getCount: 1,
    basis: 'Redraft · 1QB · 12 teams · Standard',
    scoringApplied: false,
    needApplied: false,
    needGap: null,
    lines: [
      { side: 'give', name: 'Jamarr Chase', marketValue: 4000, leagueValue: 4000 },
      { side: 'get', name: 'Jahmyr Gibbs', marketValue: 6000, leagueValue: 6000 },
    ],
    moves: [],
  }),
)

function adp(playerName: string, adpValue: number, position = 'WR', format = 'redraft', scoring = 'standard') {
  return { playerName, position, team: 'JAX', adp: adpValue, format, scoring }
}

describe('extractPlayerNameCandidates', () => {
  it('picks capitalised name-shaped runs out of prose', () => {
    expect(extractPlayerNameCandidates('Is Ja Marr for Jahmyr Gibbs fair?')).toEqual(
      expect.arrayContaining(['Jahmyr Gibbs']),
    )
  })

  it('keeps the punctuation real names carry', () => {
    const out = extractPlayerNameCandidates('Should I trade Amon-Ra St. Brown?')
    expect(out.some((n) => n.includes('Amon-Ra'))).toBe(true)
  })

  it('ignores a lone capitalised word', () => {
    expect(extractPlayerNameCandidates('Should I trade him?')).toEqual([])
  })
})

describe('buildDescribedTradeContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.leagueFindUnique.mockResolvedValue({ scoring: 'ppr', leagueVariant: null })
    mocks.adpFindMany.mockResolvedValue([])
    // Default: no projections and no published values, so the ADP-only cases below are unchanged.
    mocks.projFindFirst.mockResolvedValue({ season: 2025 })
    mocks.projFindMany.mockResolvedValue([])
    mocks.marketFindMany.mockResolvedValue([])
  })

  it('returns null when the message names nobody', async () => {
    expect(
      await buildDescribedTradeContext({ message: 'how are you?', leagueId: 'lg1', sport: 'nfl' }),
    ).toBeNull()
  })

  /*
   * 🛑 THE LETTER IS THE ONE GRADE (2026-09-24). This path used to grade the deal itself off ADP
   * into the canonical fairness grader — one letter for both sides — so the same trade typed into
   * Chimmy and built in the Trade Center read differently. It now takes the one grader's letter.
   */
  it('grades a two-sided trade with the one grade, from side 1', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])
    oneGrade.mockClear()

    const out = await buildDescribedTradeContext({
      message: 'Is Jamarr Chase for Jahmyr Gibbs fair?',
      leagueId: 'lg1',
      sport: 'nfl',
      userId: 'u1',
      gradeDeal: oneGrade,
    })

    expect(out).toContain('DESCRIBED TRADE')
    expect(out).toContain('the same the Trade Center gives this trade')
    expect(out).toContain('Side 1 (Jamarr Chase) gets A — Major win (you) for side 1. Side 2 (Jahmyr Gibbs) gets F.')
    expect(out).toContain('League value: side 1 sends 4,000 (Jamarr Chase 4,000); side 2 sends 6,000 (Jahmyr Gibbs 6,000).')
    expect(oneGrade).toHaveBeenCalledWith({
      leagueId: 'lg1',
      userId: 'u1',
      give: { assets: [{ kind: 'player', name: 'Jamarr Chase' }], unpriceable: [] },
      get: { assets: [{ kind: 'player', name: 'Jahmyr Gibbs' }], unpriceable: [] },
    })
    // The canonical grader's own line is gone — no second letter on a second basis.
    expect(out).not.toMatch(/fairness \d+\/100/)
  })

  it('a withheld grade is passed through as NOT GRADED, never as a letter', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])
    const out = await buildDescribedTradeContext({
      message: 'Is Jamarr Chase for Jahmyr Gibbs fair?',
      leagueId: 'lg1',
      sport: 'nfl',
      userId: 'u1',
      gradeDeal: async () => ({ graded: false, reason: 'Jahmyr Gibbs has no value on this league’s chart.', basis: null }),
    })
    expect(out).toContain('NOT GRADED: Jahmyr Gibbs has no value on this league’s chart. Do NOT assign a letter yourself.')
    expect(out).not.toMatch(/gets [A-F]\b/)
  })

  /*
   * The basis matters: "priced off draft position" and "priced off projected
   * points" are different claims and the answer must not conflate them.
   */
  it('states that the basis is draft position when that is all there is', async () => {
    /*
     * ⚠ THE WORDING CHANGED WITH THE BASIS, AND THAT IS THE POINT. This used to assert the fixed
     * string "priced from current draft position (ADP), not from projected points", which was the
     * only true sentence when ADP was the only source. Now the headline REPORTS what was used, so
     * the assertion checks the claim rather than the sentence.
     */
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])

    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs?',
      leagueId: 'lg1',
      sport: 'nfl',
    })

    expect(out).toContain('draft position only')
    expect(out).not.toMatch(/projected points/)
  })

  /* Guessing the sides invents a grade for a trade nobody proposed. */
  it('refuses to grade when the sides cannot be separated', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])

    const out = await buildDescribedTradeContext({
      message: 'What do you think of Jamarr Chase and Jahmyr Gibbs?',
      leagueId: 'lg1',
      sport: 'nfl',
    })

    expect(out).toContain('NOT GRADED')
    expect(out).toMatch(/do NOT compute a fairness verdict yourself/i)
    expect(out).not.toMatch(/Grade [A-F]/)
  })

  it('names the players it could not price and forbids inventing a value', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2)])

    const out = await buildDescribedTradeContext({
      message: 'Is Jamarr Chase for Nobody Here fair?',
      leagueId: 'lg1',
      sport: 'nfl',
    })

    expect(out).toContain('Nobody Here')
    expect(out).toMatch(/never invent/i)
  })

  it('works with no league selected, since a described trade needs no roster', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])

    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs',
      leagueId: null,
      sport: 'nfl',
    })

    expect(out).toContain('DESCRIBED TRADE')
    expect(mocks.leagueFindUnique).not.toHaveBeenCalled()
  })

  it('always scopes the ADP lookup to the sport', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2)])
    await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs',
      leagueId: 'lg1',
      sport: 'nfl',
    })
    expect(mocks.adpFindMany.mock.calls[0][0].where.sport).toMatchObject({ equals: 'nfl' })
  })

  /*
   * Retired 2026-09-24: "warns that confidence is low because nothing is projection-backed". That
   * caveat qualified the canonical grader's letter, which this path no longer produces — the letter
   * is the one grade, on league value. What replaces it: with no league there is no letter at all.
   */
  it('gives no letter with no league — a grade is taken on a league’s own values', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])

    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs',
      leagueId: null,
      sport: 'nfl',
      gradeDeal: oneGrade,
    })

    expect(out).toContain('NOT GRADED: no league is in context.')
    expect(out).not.toMatch(/gets [A-F]\b|Grade [A-F]/)
  })

  it('prefers one pricing slice rather than mixing bases across the two sides', async () => {
    mocks.adpFindMany.mockResolvedValue([
      adp('Jamarr Chase', 2, 'WR', 'dynasty', 'superflex'),
      adp('Jamarr Chase', 3, 'WR', 'redraft', 'ppr'),
      adp('Jahmyr Gibbs', 6, 'RB', 'redraft', 'ppr'),
    ])

    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs',
      leagueId: 'lg1',
      sport: 'nfl',
    })

    // The ppr/redraft slice matches the league, so Chase is priced at ADP 3.
    expect(out).toContain('ADP 3.0')
    expect(out).not.toContain('ADP 2.0')
  })
})

/**
 * Phase 7.4 — the basis is no longer ADP-only.
 *
 * The module's header used to explain why it had to be: `fantasy_projections` is keyed on player
 * id, so a prose question could not reach it. `AFProjectionSnapshot` carries `playerName`, so it
 * can. These pin what that changed and — more importantly — that the block still SAYS which basis
 * it used, per player.
 */
describe('7.4 — projections and market, with the basis reported', () => {
  const proj = (playerName: string, ros: number, position = 'WR') => ({
    playerName, position, rosProjection: ros, week: null,
    computedAt: new Date('2026-09-02T00:00:00Z'),
  })
  const market = (playerName: string, marketValue: number, position = 'WR') => ({
    playerName, position, marketValue,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.leagueFindUnique.mockResolvedValue({ scoring: 'ppr', leagueVariant: null })
    mocks.adpFindMany.mockResolvedValue([])
    mocks.projFindFirst.mockResolvedValue({ season: 2025 })
    mocks.projFindMany.mockResolvedValue([])
    mocks.marketFindMany.mockResolvedValue([])
  })

  it('prefers a projection over ADP and says so', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])
    mocks.projFindMany.mockResolvedValue([proj('Jamarr Chase', 240), proj('Jahmyr Gibbs', 210, 'RB')])

    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs?', leagueId: 'lg1', sport: 'nfl',
    })
    /*
     * ⚠ ASSERT THE BASIS, NOT JUST THE DETAIL LINE. The first version of this test checked only
     * for "240.0 projected points (rest of season)" — and a mutation that stopped passing the
     * projection to the engine left that line intact, because the detail renders from the fetched
     * row while the BASIS comes from the engine. The test stayed green while the thing it exists
     * to prove was broken.
     */
    expect(out).toMatch(/from projected points/)
    expect(out).toMatch(/240\.0 projected points \(rest of season\)/)
    expect(out).not.toMatch(/draft position only/)
  })

  it('🛑 warns when the two sides rest on DIFFERENT bases', async () => {
    /*
     * A trade where one player is priced off projections and the other off draft position is
     * weaker than either, and a block presenting both alike is how a bad grade gets believed.
     */
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])
    mocks.projFindMany.mockResolvedValue([proj('Jamarr Chase', 240)])

    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs?', leagueId: 'lg1', sport: 'nfl',
    })
    expect(out).toContain('MIXED BASES')
    expect(out).toMatch(/not equally well-founded/)
  })

  it('falls back to the published market value when there is no projection', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])
    mocks.marketFindMany.mockResolvedValue([
      market('Jamarr Chase', 9000), market('Jahmyr Gibbs', 7000, 'RB'),
    ])

    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs?', leagueId: 'lg1', sport: 'nfl',
    })
    expect(out).toContain('published market value')
    expect(out).toMatch(/market 9,000/)
  })

  it('🛑 prices a player who has a projection but NO ADP row', async () => {
    /*
     * Previously "no value on file for X" — true of `adp_data` and false of us. The candidate set
     * is now the UNION of every source, not the ADP result.
     */
    mocks.adpFindMany.mockResolvedValue([adp('Jahmyr Gibbs', 6, 'RB')])
    mocks.projFindMany.mockResolvedValue([proj('Jamarr Chase', 240)])

    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs?', leagueId: 'lg1', sport: 'nfl',
    })
    expect(out).toContain('Jamarr Chase')
    expect(out).not.toMatch(/No value on file for: Jamarr Chase/)
  })

  it('🛑 says outright that it cannot price defenders', async () => {
    /*
     * An IDP value needs the league's own defensive slots AND a sleeperId. Without this line a
     * linebacker priced off his ADP looks exactly like a receiver priced off his projection.
     */
    mocks.adpFindMany.mockResolvedValue([
      adp('Micah Parsons', 40, 'LB'), adp('Jahmyr Gibbs', 6, 'RB'),
    ])

    const out = await buildDescribedTradeContext({
      message: 'Micah Parsons for Jahmyr Gibbs?', leagueId: 'lg1', sport: 'nfl',
    })
    expect(out).toMatch(/Micah Parsons/)
    expect(out).toMatch(/cannot price defenders properly/)
    expect(out).toMatch(/borrowed from a different basis/)
  })

  it('stays silent about defenders when there are none', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])
    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs?', leagueId: 'lg1', sport: 'nfl',
    })
    expect(out).not.toMatch(/cannot price defenders/)
  })

  it('degrades to ADP when the new lookups fail, rather than losing the answer', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])
    mocks.projFindFirst.mockRejectedValue(new Error('db down'))
    mocks.marketFindMany.mockRejectedValue(new Error('db down'))

    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs?', leagueId: 'lg1', sport: 'nfl',
    })
    expect(out).toContain('draft position only')
    // No user to read the league as, so the values stand and no letter is invented.
    expect(out).toContain('NOT GRADED: no signed-in manager to read this league as.')
  })

  /*
   * 🛑 THE MARKET READ TOOK THE HIGHEST PRICE ACROSS EVERY `leagueConcept`. One player holds a
   * dynasty row and a redraft row at genuinely different numbers; ordering by value and keeping
   * the first per name priced a redraft trade off a rookie's dynasty value whenever that was the
   * larger of the two. These pin the concept onto the query itself — asserting the rendered text
   * would pass with the filter deleted, because the fixture only ever returns one row.
   */
  const conceptOf = () => mocks.marketFindMany.mock.calls[0]?.[0]?.where?.leagueConcept

  it('reads only the DYNASTY rows in a dynasty league', async () => {
    mocks.leagueFindUnique.mockResolvedValue({ scoring: 'ppr', leagueVariant: 'dynasty_superflex' })
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])

    await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs?', leagueId: 'lg1', sport: 'nfl',
    })
    expect(conceptOf()).toBe('dynasty')
  })

  it('reads only the REDRAFT rows anywhere else', async () => {
    mocks.leagueFindUnique.mockResolvedValue({ scoring: 'ppr', leagueVariant: 'redraft' })
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])

    await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs?', leagueId: 'lg1', sport: 'nfl',
    })
    expect(conceptOf()).toBe('redraft')
  })

  it('reads no market row at all with no league, rather than guessing a concept', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])
    mocks.marketFindMany.mockResolvedValue([
      market('Jamarr Chase', 9000), market('Jahmyr Gibbs', 7000, 'RB'),
    ])

    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs?', leagueId: null, sport: 'nfl',
    })
    expect(mocks.marketFindMany).not.toHaveBeenCalled()
    expect(out).not.toMatch(/published market value/)
  })
})
