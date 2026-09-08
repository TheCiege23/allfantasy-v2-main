// @vitest-environment node
/**
 * lib/odds/normalizeApiSportsOdds.ts — the parsing half of the API-Sports odds feed.
 *
 * WHY THIS SUITE IS THE LOAD-BEARING ONE. The vendor's market names are NOT verified
 * against documentation: api-sports.io's docs sit behind a Cloudflare bot check and
 * there is no committed `contracts/api-sports/` directory, so the alias sets in the
 * normalizer are informed guesses. Everything downstream — implied team totals,
 * win probability, the whole reason the feed was ingested — is derived from this
 * parse. If it is wrong it will be wrong PLAUSIBLY: a number in the right column,
 * the right order of magnitude, and no error anywhere.
 *
 * So these tests pin the two properties that make a wrong guess survivable:
 *   1. unparseable input yields NULL, never 0 (a pick-em and a missing line differ)
 *   2. an unrecognised bet name is REPORTED, not dropped
 *
 * ⚠ Root CLAUDE.md: an assertion that has never failed is not yet evidence. The
 * final block is a positive control that deliberately feeds the parser the failure
 * each guard exists to catch, and asserts it is caught.
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeBookmakerOdds,
  pickPrimaryBookmaker,
  parseOddToDecimal,
  parsePoints,
  retainPrimaryMarkets,
  type RawBookmaker,
} from '@/lib/odds/normalizeApiSportsOdds'

/** A realistic single-book payload: home favoured by 3.5, total 45.5. */
function book(overrides: Partial<RawBookmaker> = {}): RawBookmaker {
  return {
    id: 8,
    name: 'Bet365',
    bets: [
      { id: 1, name: 'Home/Away', values: [
        { value: 'Home', odd: '1.65' },
        { value: 'Away', odd: '2.35' },
      ] },
      { id: 2, name: 'Asian Handicap', values: [
        { value: 'Home -3.5', odd: '1.91' },
        { value: 'Away +3.5', odd: '1.91' },
      ] },
      { id: 3, name: 'Over/Under', values: [
        { value: 'Over 45.5', odd: '1.90' },
        { value: 'Under 45.5', odd: '1.90' },
      ] },
    ],
    ...overrides,
  }
}

describe('parseOddToDecimal', () => {
  it('passes decimal odds through', () => {
    expect(parseOddToDecimal('1.91')).toBeCloseTo(1.91, 5)
  })

  it('converts American prices, both signs', () => {
    // +150 pays 1.5x the stake plus the stake back = 2.50 decimal.
    expect(parseOddToDecimal('+150')).toBeCloseTo(2.5, 5)
    // -110 needs 110 to win 100 = 1.909... decimal.
    expect(parseOddToDecimal('-110')).toBeCloseTo(1.9091, 3)
  })

  it('returns null rather than 0 for junk, empty and zero', () => {
    for (const input of ['', '   ', 'n/a', null, undefined, '0']) {
      expect(parseOddToDecimal(input as string)).toBeNull()
    }
  })
})

describe('parsePoints', () => {
  it('extracts a signed number from a decorated value', () => {
    expect(parsePoints('Home -3.5')).toBe(-3.5)
    expect(parsePoints('Away +3.5')).toBe(3.5)
    expect(parsePoints('Over 45.5')).toBe(45.5)
  })

  it('returns null — NOT 0 — when the value carries no number', () => {
    // This is the distinction the whole schema is nullable for: "Home" with no
    // number is an absent line, and 0 would be a pick-em, which is a real market.
    expect(parsePoints('Home')).toBeNull()
    expect(parsePoints('')).toBeNull()
  })
})

describe('normalizeBookmakerOdds', () => {
  it('parses spread, total and moneyline from a realistic payload', () => {
    const out = normalizeBookmakerOdds(book())
    expect(out.spreadHome).toBe(-3.5)
    expect(out.totalPoints).toBe(45.5)
    expect(out.moneylineHome).toBeCloseTo(1.65, 5)
    expect(out.moneylineAway).toBeCloseTo(2.35, 5)
    expect(out.unrecognizedBets).toEqual([])
  })

  it('derives implied team totals that sum back to the game total', () => {
    const out = normalizeBookmakerOdds(book())
    // home favoured by 3.5 on a 45.5 total → 24.5 / 21.0
    expect(out.impliedHomeTotal).toBeCloseTo(24.5, 5)
    expect(out.impliedAwayTotal).toBeCloseTo(21.0, 5)
    expect(out.impliedHomeTotal! + out.impliedAwayTotal!).toBeCloseTo(45.5, 5)
    // and the favourite is implied for MORE, which is the direction that matters
    expect(out.impliedHomeTotal!).toBeGreaterThan(out.impliedAwayTotal!)
  })

  it('removes the vig so the two win probabilities sum to exactly 1', () => {
    const out = normalizeBookmakerOdds(book())
    expect(out.homeWinProbability).not.toBeNull()
    // 1/1.65 = .606, 1/2.35 = .426 — raw sum 1.032, i.e. a 3.2% hold.
    expect(1 / 1.65 + 1 / 2.35).toBeGreaterThan(1)
    // After normalization the pair is a probability distribution.
    const away = 1 - out.homeWinProbability!
    expect(out.homeWinProbability! + away).toBeCloseTo(1, 10)
    expect(out.homeWinProbability!).toBeCloseTo(0.5876, 3)
  })

  it('leaves derived fields null when only half the inputs are present', () => {
    const spreadOnly = normalizeBookmakerOdds(
      book({ bets: [{ id: 2, name: 'Asian Handicap', values: [{ value: 'Home -3.5', odd: '1.91' }] }] }),
    )
    expect(spreadOnly.spreadHome).toBe(-3.5)
    expect(spreadOnly.totalPoints).toBeNull()
    // Half the inputs must give NO answer, not half an answer.
    expect(spreadOnly.impliedHomeTotal).toBeNull()
    expect(spreadOnly.impliedAwayTotal).toBeNull()
    expect(spreadOnly.homeWinProbability).toBeNull()
  })

  it('resolves sides named by team rather than Home/Away', () => {
    const out = normalizeBookmakerOdds(
      book({ bets: [{ id: 1, name: 'Moneyline', values: [
        { value: 'Kansas City Chiefs', odd: '1.50' },
        { value: 'Denver Broncos', odd: '2.60' },
      ] }] }),
      { homeTeamName: 'Kansas City Chiefs', awayTeamName: 'Denver Broncos' },
    )
    expect(out.moneylineHome).toBeCloseTo(1.5, 5)
    expect(out.moneylineAway).toBeCloseTo(2.6, 5)
  })

  it('REGRESSION: "Moneyline" is not classified as a spread', () => {
    /*
     * The first version of this parser listed 'line' as a spread alias. Substring
     * matching meant 'Moneyline' contained it, so the moneyline was parsed as a
     * spread, its team-named values yielded no points number, and the market
     * disappeared entirely — null prices, no error, and NOT reported as an
     * unrecognised name either. Found by the team-named-sides test above.
     */
    const out = normalizeBookmakerOdds(
      book({ bets: [{ id: 1, name: 'Moneyline', values: [
        { value: 'Home', odd: '1.50' },
        { value: 'Away', odd: '2.60' },
      ] }] }),
    )
    expect(out.moneylineHome).toBeCloseTo(1.5, 5)
    expect(out.moneylineAway).toBeCloseTo(2.6, 5)
    // and it must not have leaked into the spread columns
    expect(out.spreadHome).toBeNull()
    expect(out.unrecognizedBets).toEqual([])
  })

  it('reports unknown bet names instead of silently dropping them', () => {
    const out = normalizeBookmakerOdds(
      book({ bets: [{ id: 99, name: 'Anytime Touchdown Scorer', values: [{ value: 'Someone', odd: '2.00' }] }] }),
    )
    expect(out.unrecognizedBets).toEqual(['Anytime Touchdown Scorer'])
    // and nothing was invented from a market it did not understand
    expect(out.spreadHome).toBeNull()
    expect(out.totalPoints).toBeNull()
  })
})

describe('period-scoped markets are rejected, not parsed', () => {
  /*
   * The single most dangerous input this parser can see. A 1st-half total is ~23 on
   * a game that totals 45.5 — a number that is plausible, lands in the right column,
   * and is wrong. Substring matching alone would accept it, because "Over/Under 1st
   * Half" contains "over/under".
   */
  it('does not let a 1st-half total become the game total', () => {
    const out = normalizeBookmakerOdds(
      book({ bets: [
        { id: 3, name: 'Over/Under', values: [{ value: 'Over 45.5', odd: '1.90' }] },
        { id: 4, name: 'Over/Under 1st Half', values: [{ value: 'Over 23.5', odd: '1.90' }] },
      ] }),
    )
    expect(out.totalPoints).toBe(45.5)
  })

  it('rejects a period market even when it arrives FIRST', () => {
    // Ordering must not decide correctness — the half-market is skipped outright,
    // so it cannot win by being seen before the full-game line.
    const out = normalizeBookmakerOdds(
      book({ bets: [
        { id: 4, name: 'Over/Under 1st Half', values: [{ value: 'Over 23.5', odd: '1.90' }] },
        { id: 3, name: 'Over/Under', values: [{ value: 'Over 45.5', odd: '1.90' }] },
      ] }),
    )
    expect(out.totalPoints).toBe(45.5)
  })

  it('yields null rather than a half-line when ONLY period markets are quoted', () => {
    const out = normalizeBookmakerOdds(
      book({ bets: [
        { id: 4, name: 'Over/Under 1st Half', values: [{ value: 'Over 23.5', odd: '1.90' }] },
        { id: 5, name: 'Asian Handicap 2nd Quarter', values: [{ value: 'Home -1.5', odd: '1.90' }] },
      ] }),
    )
    expect(out.totalPoints).toBeNull()
    expect(out.spreadHome).toBeNull()
    // Nothing was extracted, so the diagnostic reports what WAS on offer — that is
    // the one case where listing names is signal rather than noise.
    expect(out.unrecognizedBets).toEqual(['Over/Under 1st Half', 'Asian Handicap 2nd Quarter'])
  })
})

describe('real market names from the live /odds/bets list', () => {
  /*
   * 🛑 THE MOST IMPORTANT BLOCK IN THIS FILE. Every name below is copied verbatim
   * from `contracts/api-sports/fixtures/odds-bets.json`, captured live on
   * 2026-09-08. Each one was matched by the ORIGINAL substring aliases and would
   * have been written into `total_points` or `spread_home` as a plausible,
   * correctly-typed, completely wrong number — and would NOT have shown up in
   * `unrecognizedBets`, because it was wrongly RECOGNISED.
   *
   * The substring alias `'total'` matched 59 of the 361 live markets. One is the
   * game total. These tests are what stop the other 58.
   */
  const NOT_THE_GAME_TOTAL: Array<[number, string, string]> = [
    [54, 'Total Touchdowns', 'Over 5.5'],
    [75, 'Total Field Goals', 'Over 3.5'],
    [8, 'Total - Home', 'Over 24.5'],
    [9, 'Total - Away', 'Over 21.5'],
    [129, 'Total (3W)', 'Over 45.5'],
    [136, 'Total Touchdowns (3W)', 'Over 5.5'],
    [70, 'Home Total Touchdowns', 'Over 2.5'],
    [155, 'Shortest Total Touchdowns', 'Over 3.5'],
  ]

  it.each(NOT_THE_GAME_TOTAL)('bet %i "%s" must not become the game total', (id, name, value) => {
    const out = normalizeBookmakerOdds(
      book({ bets: [{ id, name, values: [{ value, odd: '1.90' }] }] }),
    )
    expect(out.totalPoints).toBeNull()
    expect(out.impliedHomeTotal).toBeNull()
  })

  it('a yardage prop does not become a 500-point game total', () => {
    // The worst case: `Total Passing Yards` at 520.5 would have produced implied
    // team totals of ~260 each — absurd, but nothing in the pipeline checks ranges.
    const out = normalizeBookmakerOdds(
      book({ bets: [{ id: 200, name: 'Total Passing Yards', values: [{ value: 'Over 520.5', odd: '1.9' }] }] }),
    )
    expect(out.totalPoints).toBeNull()
  })

  it('"Handicap Result" (3-way) must not become the 2-way spread', () => {
    const out = normalizeBookmakerOdds(
      book({ bets: [{ id: 6, name: 'Handicap Result', values: [{ value: 'Home -3.5', odd: '1.9' }] }] }),
    )
    expect(out.spreadHome).toBeNull()
  })

  it('"Team To Make First Score 2-Way" must not become the moneyline', () => {
    const out = normalizeBookmakerOdds(
      book({ bets: [{ id: 83, name: 'Team To Make First Score 2-Way', values: [
        { value: 'Home', odd: '1.90' },
        { value: 'Away', odd: '1.90' },
      ] }] }),
    )
    expect(out.moneylineHome).toBeNull()
    expect(out.moneylineAway).toBeNull()
  })

  it('the three real primaries DO parse, by id', () => {
    // The positive half: ids 1/2/3 with their live names, which is what a real
    // payload carries. Without this the block above would pass with everything
    // rejected — the classic guard that only ever says no.
    const out = normalizeBookmakerOdds({
      id: 8,
      name: 'Bet365',
      bets: [
        { id: 1, name: 'Home/Away', values: [{ value: 'Home', odd: '1.65' }, { value: 'Away', odd: '2.35' }] },
        { id: 2, name: 'Asian Handicap', values: [{ value: 'Home -3.5', odd: '1.91' }] },
        { id: 3, name: 'Over/Under', values: [{ value: 'Over 45.5', odd: '1.90' }] },
      ],
    })
    expect(out.moneylineHome).toBeCloseTo(1.65, 5)
    expect(out.spreadHome).toBe(-3.5)
    expect(out.totalPoints).toBe(45.5)
    expect(out.impliedHomeTotal).toBeCloseTo(24.5, 5)
    expect(out.unrecognizedBets).toEqual([])
  })

  it('tolerates the live list entry whose name is literally null (id 86)', () => {
    const out = normalizeBookmakerOdds(
      book({ bets: [{ id: 86, name: null as unknown as string, values: [] }] }),
    )
    expect(out.totalPoints).toBeNull()
    expect(out.unrecognizedBets).toEqual([])
  })
})

describe('pickPrimaryBookmaker', () => {
  it('prefers the most complete quote over the lowest id', () => {
    const sparse = normalizeBookmakerOdds({ id: 1, name: 'Sparse', bets: [
      { id: 3, name: 'Over/Under', values: [{ value: 'Over 44.5', odd: '1.9' }] },
    ] })
    const complete = normalizeBookmakerOdds(book({ id: 9, name: 'Complete' }))
    expect(pickPrimaryBookmaker([sparse, complete])?.bookmakerName).toBe('Complete')
  })

  it('falls back to the lowest id when completeness ties', () => {
    const a = normalizeBookmakerOdds(book({ id: 12, name: 'Twelve' }))
    const b = normalizeBookmakerOdds(book({ id: 4, name: 'Four' }))
    expect(pickPrimaryBookmaker([a, b])?.bookmakerName).toBe('Four')
  })

  it('returns null on an empty list rather than throwing', () => {
    expect(pickPrimaryBookmaker([])).toBeNull()
  })
})

describe('retainPrimaryMarkets — the prop board is never warehoused', () => {
  /*
   * A product boundary, not an optimisation. AllFantasy reads the betting market as
   * a FORECAST (implied team totals, win probability) and is deliberately not a
   * gambling product, so a book's prop prices are data we never read and should not
   * be holding. `raw` exists to diagnose a PARSE, and a parse can only concern the
   * markets the parser looks at.
   */
  const withProps: RawBookmaker = {
    id: 8,
    name: 'Bet365',
    bets: [
      { id: 1, name: 'Home/Away', values: [{ value: 'Home', odd: '1.65' }] },
      { id: 2, name: 'Asian Handicap', values: [{ value: 'Home -3.5', odd: '1.91' }] },
      { id: 3, name: 'Over/Under', values: [{ value: 'Over 45.5', odd: '1.90' }] },
      { id: 47, name: 'Anytime Goal Scorer', values: [{ value: 'Someone', odd: '2.50' }] },
      { id: 95, name: 'Player Interceptions', values: [{ value: 'Over 0.5', odd: '3.00' }] },
      { id: 51, name: 'Multi Touchdown Scorer (3 or More)', values: [{ value: 'Yes', odd: '9.0' }] },
      { id: 4, name: 'Over/Under 1st Half', values: [{ value: 'Over 23.5', odd: '1.9' }] },
    ],
  }

  it('keeps exactly the three modelled markets', () => {
    const kept = retainPrimaryMarkets(withProps)
    expect(kept.bets.map((b) => b.id).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('drops every player prop', () => {
    const names = retainPrimaryMarkets(withProps).bets.map((b) => b.name)
    for (const prop of ['Anytime Goal Scorer', 'Player Interceptions', 'Multi Touchdown Scorer (3 or More)']) {
      expect(names).not.toContain(prop)
    }
  })

  it('drops period-scoped markets too', () => {
    expect(retainPrimaryMarkets(withProps).bets.map((b) => b.name)).not.toContain('Over/Under 1st Half')
  })

  it('preserves the bookmaker identity and does not mutate the input', () => {
    const before = withProps.bets.length
    const kept = retainPrimaryMarkets(withProps)
    expect(kept.id).toBe(8)
    expect(kept.name).toBe('Bet365')
    // the caller's object is left alone — the writer still normalizes off the full payload
    expect(withProps.bets.length).toBe(before)
  })

  it('CONTROL: the fixture really did contain props, so the filter had work to do', () => {
    // Without this, all four assertions above would pass on an input that never
    // held a prop — a guard that has never actually removed anything.
    expect(withProps.bets.length).toBe(7)
    expect(retainPrimaryMarkets(withProps).bets.length).toBe(3)
  })
})

describe('positive control — these guards can actually fail', () => {
  /*
   * Root CLAUDE.md: "make every check reproduce a known positive before you trust its
   * negative." Each assertion below feeds the parser the exact defect a guard above
   * exists to prevent, and asserts the parser behaves DIFFERENTLY than the happy path.
   * If a guard were deleted, one of these goes red — which is the property the passing
   * tests above cannot demonstrate on their own.
   */

  it('CONTROL: a payload with no markets at all produces an all-null row', () => {
    const out = normalizeBookmakerOdds({ id: 1, name: 'Empty', bets: [] })
    expect(out.spreadHome).toBeNull()
    expect(out.totalPoints).toBeNull()
    expect(out.moneylineHome).toBeNull()
    expect(out.impliedHomeTotal).toBeNull()
    expect(out.homeWinProbability).toBeNull()
  })

  it('CONTROL: it is the ID/exact-name check doing the rejecting, not the number', () => {
    // The rejections above are not because 23.5 or 5.5 "looks wrong" — nothing here
    // range-checks. Give the SAME value a primary identity and it lands. Here via the
    // exact-name fallback (id 4 is not a primary, but the name matches exactly), which
    // also proves that fallback is wired rather than dead code.
    const accepted = normalizeBookmakerOdds(
      book({ bets: [{ id: 4, name: 'Over/Under', values: [{ value: 'Over 23.5', odd: '1.90' }] }] }),
    )
    expect(accepted.totalPoints).toBe(23.5)

    // Same number, same shape, non-primary identity → rejected.
    const rejected = normalizeBookmakerOdds(
      book({ bets: [{ id: 54, name: 'Total Touchdowns', values: [{ value: 'Over 23.5', odd: '1.90' }] }] }),
    )
    expect(rejected.totalPoints).toBeNull()
  })

  it('CONTROL: an unrecognised name is genuinely unmatched by every alias set', () => {
    // If any alias accidentally matched this, unrecognizedBets would come back empty
    // and the "reports unknown names" test above would be vacuous.
    const out = normalizeBookmakerOdds(
      book({ bets: [{ id: 99, name: 'Zzz Nonexistent Market', values: [] }] }),
    )
    expect(out.unrecognizedBets).toHaveLength(1)
  })
})
