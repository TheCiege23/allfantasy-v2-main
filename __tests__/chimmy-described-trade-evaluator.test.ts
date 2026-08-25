import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  adpFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    adpDataRecord: { findMany: mocks.adpFindMany },
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
  it('states that the basis is ADP, not projections', async () => {
    mocks.adpFindMany.mockResolvedValue([adp('Jamarr Chase', 2), adp('Jahmyr Gibbs', 6, 'RB')])

    const out = await buildDescribedTradeContext({
      message: 'Jamarr Chase for Jahmyr Gibbs?',
      leagueId: 'lg1',
      sport: 'nfl',
    })

    expect(out).toContain('priced from current draft position (ADP), not from projected points')
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
