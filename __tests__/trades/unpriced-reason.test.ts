import { describe, expect, it } from 'vitest'
import {
  analysisUnpricedReason,
  pickUnpricedReason,
  playerUnpricedReason,
  pricedOnAnalysisReason,
} from '@/lib/trade-value/unpricedReason'

/**
 * Item #5 — say WHY an asset has no value. The trade page showed an em dash and "Unpriced" and
 * nothing else, for three very different situations: a defender the feed will never cover, a feed
 * that failed to load, and a player we could not identify.
 */

const nfl = (position: string | null, marketLoaded = true) =>
  playerUnpricedReason({ identified: true, position, sport: 'NFL', marketLoaded }).code

describe('playerUnpricedReason', () => {
  it('names each position the value feed never covers', () => {
    expect(nfl('LB')).toBe('defender')
    expect(nfl('DB')).toBe('defender')
    expect(nfl('DL')).toBe('defender')
    // Long-form spellings exist in SportsPlayer and must not fall through to "not on the feed".
    expect(nfl('Linebacker')).toBe('defender')
    expect(nfl('K')).toBe('kicker')
    expect(nfl('PK')).toBe('kicker')
    expect(nfl('DEF')).toBe('team_defense')
    expect(nfl('DST')).toBe('team_defense')
  })

  it('says "not on the feed" only for a skill player when the feed loaded', () => {
    expect(nfl('WR')).toBe('not_on_feed')
    expect(nfl('QB')).toBe('not_on_feed')
    expect(nfl(null)).toBe('not_on_feed')
  })

  it('🛑 an outage is an outage, not "he is not on the list"', () => {
    /*
     * The two need opposite responses: one is permanent, the other is gone in a minute. Saying
     * "not on the feed" during an outage tells a manager a star has no market.
     */
    expect(nfl('WR', false)).toBe('feed_unavailable')
  })

  it('⚠ a defender is unpriced whether or not the feed loaded — position outranks an outage', () => {
    expect(nfl('LB', false)).toBe('defender')
    expect(nfl('DEF', false)).toBe('team_defense')
  })

  it('🛑 an unidentified player comes first — there is no position to reason about', () => {
    const r = playerUnpricedReason({ identified: false, position: 'K', sport: 'NFL', marketLoaded: false })
    expect(r.code).toBe('unidentified')
  })

  it('a sport the feed does not cover outranks the position', () => {
    const r = playerUnpricedReason({ identified: true, position: 'WR', sport: 'NCAAF', marketLoaded: true })
    expect(r.code).toBe('no_feed_for_sport')
    expect(r.label).toContain('college football')
    expect(playerUnpricedReason({ identified: true, position: 'G', sport: 'NBA', marketLoaded: true }).label).toContain('NBA')
  })

  it('⚠ an unknown sport is not evidence of a feed gap', () => {
    expect(playerUnpricedReason({ identified: true, position: 'WR', sport: null, marketLoaded: true }).code).toBe(
      'not_on_feed',
    )
  })
})

describe('analysisUnpricedReason', () => {
  it('keeps a position the feed never covers', () => {
    expect(analysisUnpricedReason({ position: 'DEF', sport: 'NFL' }).code).toBe('team_defense')
  })

  it('otherwise says the engine found nothing anywhere, not "not on the feed"', () => {
    // The engine also tried the league board, historical values and draft value.
    expect(analysisUnpricedReason({ position: 'UNKNOWN', sport: 'NFL' }).code).toBe('no_value_on_file')
    expect(analysisUnpricedReason({ position: null, sport: undefined }).code).toBe('no_value_on_file')
  })
})

describe('the words themselves', () => {
  const all = [
    ...(['LB', 'K', 'DEF', 'WR'] as const).map((p) => playerUnpricedReason({ identified: true, position: p, sport: 'NFL', marketLoaded: true })),
    playerUnpricedReason({ identified: true, position: 'WR', sport: 'NFL', marketLoaded: false }),
    playerUnpricedReason({ identified: false, position: null, sport: 'NFL', marketLoaded: true }),
    playerUnpricedReason({ identified: true, position: 'WR', sport: 'NCAAF', marketLoaded: true }),
    analysisUnpricedReason({ position: null, sport: 'NFL' }),
    pickUnpricedReason(),
    pricedOnAnalysisReason(),
  ]

  it('every reason has a distinct code and a sentence', () => {
    expect(new Set(all.map((r) => r.code)).size).toBe(all.length)
    for (const r of all) expect(r.label.length).toBeGreaterThan(10)
  })

  it('⚠ no reason reads as a value', () => {
    // The whole rule for an unpriced asset: never imply zero.
    for (const r of all) expect(r.label).not.toMatch(/\b0\b|zero|worthless/i)
  })
})
