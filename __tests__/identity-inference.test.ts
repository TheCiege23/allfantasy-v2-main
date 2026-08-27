import { describe, expect, it } from 'vitest'

import {
  DEFAULT_WINDOW_HOURS,
  bestIdentityMatches,
  inferIdentitiesFromTrades,
  type PlatformTrade,
} from '@/lib/franchise/identityInference'

/**
 * ⚠ WHY TRADES AND NOT ROSTERS. Measured 2026-08-26 against Fantrax's own maps,
 * NO player id survives the college-to-pro transition — sportRadarId, rotowireId,
 * statsIncId and even fantraxId all share ZERO values between the CFB and NFL
 * maps. So "he held this player in college and holds him in the pros" cannot be
 * keyed. A trade needs no cross-boundary key: it is a timestamped event inside
 * one platform's own id space, and matching one to its mirror pins TWO pairings
 * at once.
 */

const t = (id: string, day: string, participants: string[], hour = 12): PlatformTrade => ({
  id,
  at: new Date(`2026-07-${day}T${String(hour).padStart(2, '0')}:00:00Z`),
  participants,
})

describe('a matched trade pins two pairings at once', () => {
  it('proposes both orientations, because platforms do not agree on order', () => {
    const res = inferIdentitiesFromTrades({
      collegeTrades: [t('c1', '14', ['fx_alice', 'fx_bob'])],
      proTrades: [t('p1', '14', ['sl_1', 'sl_5'])],
    })

    expect(res.matchedTrades).toBe(1)
    const keys = res.candidates.map((c) => `${c.college}->${c.pro}`).sort()
    expect(keys).toEqual(['fx_alice->sl_1', 'fx_alice->sl_5', 'fx_bob->sl_1', 'fx_bob->sl_5'])
  })

  /**
   * ⚠ SUPPORT ALONE IS NOT CONFIDENCE. One match proposes the real pairing AND
   * its mirror, so a single trade can never be high confidence.
   */
  it('a single match is never high confidence, and says so', () => {
    const res = inferIdentitiesFromTrades({
      collegeTrades: [t('c1', '14', ['fx_alice', 'fx_bob'])],
      proTrades: [t('p1', '14', ['sl_1', 'sl_5'])],
    })
    expect(res.candidates.every((c) => c.confidence !== 'high')).toBe(true)
    expect(res.gaps.join(' ')).toMatch(/single trade on a single day is a coincidence/)
  })

  /**
   * The real signal: the true pairing recurs across independent deals while the
   * mirrored one does not.
   */
  it('the correct orientation separates from its mirror as matches accumulate', () => {
    const res = inferIdentitiesFromTrades({
      collegeTrades: [
        t('c1', '14', ['fx_alice', 'fx_bob']),
        t('c2', '18', ['fx_alice', 'fx_carol']),
        t('c3', '22', ['fx_alice', 'fx_dave']),
      ],
      proTrades: [
        t('p1', '14', ['sl_1', 'sl_5']),
        t('p2', '18', ['sl_1', 'sl_7']),
        t('p3', '22', ['sl_1', 'sl_9']),
      ],
    })

    const alice = res.candidates.filter((c) => c.college === 'fx_alice')
    const top = alice[0]
    // fx_alice appears in all three deals, and so does sl_1.
    expect(top.pro).toBe('sl_1')
    expect(top.support).toBe(3)
    expect(top.support).toBeGreaterThan(alice[1].support)
  })
})

describe('what it refuses to conclude', () => {
  it('will not match trades outside the window', () => {
    const res = inferIdentitiesFromTrades({
      collegeTrades: [t('c1', '14', ['fx_alice', 'fx_bob'])],
      proTrades: [t('p1', '20', ['sl_1', 'sl_5'])],
    })
    expect(res.matchedTrades).toBe(0)
    expect(res.candidates).toEqual([])
  })

  it('will not match deals with different participant counts', () => {
    const res = inferIdentitiesFromTrades({
      collegeTrades: [t('c1', '14', ['fx_alice', 'fx_bob'])],
      proTrades: [t('p1', '14', ['sl_1', 'sl_5', 'sl_9'])],
    })
    expect(res.matchedTrades).toBe(0)
  })

  /**
   * ⚠ With three or more sides, several pairings fit the same pair of trades.
   * Picking one would be a guess dressed as evidence.
   */
  it('will not pair three-team deals at all, even when they mirror', () => {
    const res = inferIdentitiesFromTrades({
      collegeTrades: [t('c1', '14', ['fx_a', 'fx_b', 'fx_c'])],
      proTrades: [t('p1', '14', ['sl_1', 'sl_2', 'sl_3'])],
    })
    expect(res.matchedTrades).toBe(0)
  })

  /**
   * ⚠ UNMATCHED IS NORMAL. The two leagues trade independently — a college-only
   * deal has no pro mirror and never will.
   */
  it('reports unmatched trades as a count, not as a failure', () => {
    const res = inferIdentitiesFromTrades({
      collegeTrades: [t('c1', '14', ['fx_alice', 'fx_bob']), t('c2', '02', ['fx_x', 'fx_y'])],
      proTrades: [t('p1', '14', ['sl_1', 'sl_5'])],
    })
    expect(res.matchedTrades).toBe(1)
    expect(res.unmatchedCollege).toBe(1)
    expect(res.unmatchedPro).toBe(0)
  })

  it('always says it proposes rather than merges', () => {
    const res = inferIdentitiesFromTrades({ collegeTrades: [], proTrades: [] })
    expect(res.gaps.join(' ')).toMatch(/never an automatic merge/)
  })

  it('names the missing Fantrax trade API, so an empty run is explicable', () => {
    const res = inferIdentitiesFromTrades({ collegeTrades: [], proTrades: [] })
    expect(res.gaps.join(' ')).toMatch(/no transactions endpoint/)
  })

  it('the default window is tight enough not to manufacture pairings', () => {
    // Two days: the halves are executed by hand on separate sites, but widening
    // this starts matching unrelated deals in an active league.
    expect(DEFAULT_WINDOW_HOURS).toBe(48)
  })
})

describe('bestIdentityMatches', () => {
  it('returns one proposal per college manager when the evidence separates', () => {
    const res = inferIdentitiesFromTrades({
      collegeTrades: [
        t('c1', '14', ['fx_alice', 'fx_bob']),
        t('c2', '18', ['fx_alice', 'fx_carol']),
      ],
      proTrades: [t('p1', '14', ['sl_1', 'sl_5']), t('p2', '18', ['sl_1', 'sl_7'])],
    })
    const best = bestIdentityMatches(res)
    expect(best.find((b) => b.college === 'fx_alice')?.pro).toBe('sl_1')
  })

  /**
   * ⚠ A TIE MEANS THE EVIDENCE IS SILENT. Presenting the first candidate as the
   * answer would be arbitrary.
   */
  it('says nothing for a manager whose top candidates are tied', () => {
    const res = inferIdentitiesFromTrades({
      collegeTrades: [t('c1', '14', ['fx_alice', 'fx_bob'])],
      proTrades: [t('p1', '14', ['sl_1', 'sl_5'])],
    })
    // One match: alice->sl_1 and alice->sl_5 both have support 1.
    const best = bestIdentityMatches(res)
    expect(best.find((b) => b.college === 'fx_alice')).toBeUndefined()
  })

  it('an empty run proposes nothing rather than erroring', () => {
    expect(bestIdentityMatches(inferIdentitiesFromTrades({ collegeTrades: [], proTrades: [] }))).toEqual([])
  })
})
