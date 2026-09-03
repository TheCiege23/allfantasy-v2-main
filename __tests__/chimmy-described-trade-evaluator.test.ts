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

  it('grades a two-sided trade off ADP', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])

    const out = await buildDescribedTradeContext({
      message: 'Is Jamarr Chase for Jahmyr Gibbs fair?',
      leagueId: 'lg1',
      sport: 'nfl',
    })

    expect(out).toContain('DESCRIBED TRADE')
    expect(out).toContain('Jamarr Chase')
    expect(out).toContain('Jahmyr Gibbs')
    expect(out).toMatch(/Grade [A-F]/)
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
   * ADP is not a projection, so confidence stays low by construction and the
   * caveat has to outrank the letter.
   */
  it('warns that confidence is low because nothing is projection-backed', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])

    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs',
      leagueId: 'lg1',
      sport: 'nfl',
    })

    expect(out).toMatch(/CONFIDENCE IS LOW/i)
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
    expect(out).toMatch(/Grade [A-F]/)
  })
})
