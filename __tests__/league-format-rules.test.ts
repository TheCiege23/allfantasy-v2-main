import { describe, expect, it } from 'vitest'

import {
  impossiblePickWarning,
  keeperDriftNote,
  keeperSurplus,
  readFormatRules,
} from '@/lib/trade-intel/leagueFormatRules'

/**
 * Format is not a flavour. It decides what a trade can even contain, and in a
 * keeper league it decides what a player is worth — because what you acquire is
 * not the player, it is the player minus what he costs to keep.
 */

describe('readFormatRules', () => {
  it('reads dynasty and allows future picks', () => {
    const r = readFormatRules({ leagueType: 'dynasty' })
    expect(r.concept).toBe('dynasty')
    expect(r.futurePicksTradeable).toBe(true)
  })

  it('⚠ redraft has NO future picks, and says so', () => {
    const r = readFormatRules({ leagueType: 'redraft' })
    expect(r.concept).toBe('redraft')
    expect(r.futurePicksTradeable).toBe(false)
    expect(r.notes.join(' ')).toContain('decided entirely on players')
  })

  it('⚠ a keeper league imported as redraft is still a keeper league', () => {
    /*
     * Keeper leagues frequently arrive with isDynasty false and leagueType
     * "redraft" with a keeper count above zero. Treating that as redraft would
     * switch off the surplus maths that matters most there.
     */
    const r = readFormatRules({ leagueType: 'redraft', keeperCount: 3 })
    expect(r.concept).toBe('keeper')
    expect(r.maxKeepers).toBe(3)
  })

  it('⚠ leaves keeper pick-trading UNKNOWN rather than assuming yes', () => {
    /*
     * Keeper leagues split on this and no platform setting we read records it.
     * Assuming yes prices assets the commissioner may have frozen.
     */
    const r = readFormatRules({ leagueType: 'keeper', keeperCount: 2 })
    expect(r.futurePicksTradeable).toBeNull()
    expect(r.notes.join(' ')).toContain('do not read')
  })

  it('describes which way the keeper price moves each year', () => {
    const climbs = readFormatRules({ leagueType: 'keeper', keeperCount: 2, keeperRoundPenalty: 1 })
    expect(climbs.notes.join(' ')).toContain('more expensive the longer')

    const falls = readFormatRules({ leagueType: 'keeper', keeperCount: 2, keeperRoundPenalty: -1 })
    expect(falls.notes.join(' ')).toContain('gets cheaper')

    const flat = readFormatRules({ leagueType: 'keeper', keeperCount: 2, keeperRoundPenalty: 0 })
    expect(flat.notes.join(' ')).toContain('same round every year')
  })

  it('⚠ guillotine is its own concept, with no next season to trade into', () => {
    const r = readFormatRules({ leagueType: 'guillotine' })
    expect(r.concept).toBe('guillotine')
    expect(r.futurePicksTradeable).toBe(false)
    expect(r.notes.join(' ')).toContain('worth less every week')
    expect(r.notes.join(' ')).toContain('FAAB')
  })

  it('⚠ does not quietly treat an unknown format as redraft', () => {
    // A caller that does not know how to price a format should be able to tell
    // that it is looking at one, rather than getting redraft rules by default.
    expect(readFormatRules({ leagueType: 'survivor' }).concept).toBe('other')
    expect(readFormatRules({ leagueType: 'zombie' }).concept).toBe('other')
  })

  it('falls back to isDynasty only when leagueType says nothing', () => {
    expect(readFormatRules({ leagueType: null, isDynasty: true }).concept).toBe('dynasty')
  })
})

describe('impossiblePickWarning: arithmetic on an asset that does not exist', () => {
  it('⚠ flags future picks in a redraft deal as a correctness problem', () => {
    /*
     * Not a note. If a redraft trade is graded with a future first on one side,
     * the verdict is confidently wrong in whichever direction the phantom pick
     * points.
     */
    const w = impossiblePickWarning({
      rules: readFormatRules({ leagueType: 'redraft' }),
      pickCount: 2,
    })!
    expect(w).toContain('does not exist here')
  })

  it('warns more softly in a keeper league, where it might be allowed', () => {
    const w = impossiblePickWarning({
      rules: readFormatRules({ leagueType: 'keeper', keeperCount: 3 }),
      pickCount: 1,
    })!
    expect(w).toContain('confirm yours does')
  })

  it('says nothing in dynasty, or when there are no picks', () => {
    expect(
      impossiblePickWarning({ rules: readFormatRules({ leagueType: 'dynasty' }), pickCount: 3 }),
    ).toBeNull()
    expect(
      impossiblePickWarning({ rules: readFormatRules({ leagueType: 'redraft' }), pickCount: 0 }),
    ).toBeNull()
  })
})

describe('keeperSurplus: the player minus the pick he eats', () => {
  /** A crude round chart: a 1st is 4000, falling by 500 a round. */
  const price = (round: number) => Math.max(200, 4500 - round * 500)

  it('⚠ the same player at two keeper prices is two different assets', () => {
    /*
     * On every chart in the world these are one player. Here the gap between
     * them routinely exceeds the difference between the players managers
     * actually argue about.
     */
    const cheap = keeperSurplus({ marketValue: 3000, costRound: 7, pickPrice: price })!
    const dear = keeperSurplus({ marketValue: 3000, costRound: 2, pickPrice: price })!
    expect(cheap.surplus).toBeGreaterThan(dear.surplus)
  })

  it('⚠ a negative surplus is a real answer, not a failure', () => {
    // He costs more to keep than he is worth — exactly the case a manager is
    // about to trade for without noticing.
    const s = keeperSurplus({ marketValue: 1200, costRound: 1, pickPrice: price })!
    expect(s.surplus).toBeLessThan(0)
    expect(s.basis).toContain('above his value')
  })

  it('withholds when either half is unknown, rather than assuming a round', () => {
    expect(keeperSurplus({ marketValue: 3000, costRound: null, pickPrice: price })).toBeNull()
    expect(keeperSurplus({ marketValue: null, costRound: 3, pickPrice: price })).toBeNull()
    expect(keeperSurplus({ marketValue: 3000, costRound: 3, pickPrice: () => null })).toBeNull()
  })
})

describe('keeperDriftNote: the contract moved, not just the player', () => {
  it('⚠ a player who gained value against his keeper price is the best thing on the board', () => {
    /*
     * Cost a 4th, worth a 2nd. No chart says so, because a chart prices the
     * player and not the contract.
     */
    const n = keeperDriftNote({ playerName: 'A Receiver', previousRound: 4, impliedRoundNow: 2 })!
    expect(n).toContain('gained 2 rounds')
    expect(n).toContain('keeper price has not caught up')
  })

  it('⚠ and the reverse is a liability dressed as an asset', () => {
    const n = keeperDriftNote({ playerName: 'A Back', previousRound: 2, impliedRoundNow: 4 })!
    expect(n).toContain('lost 2 rounds')
    expect(n).toContain("paying last year's price")
  })

  it('stays quiet when nothing moved', () => {
    expect(
      keeperDriftNote({ playerName: 'A Tight End', previousRound: 3, impliedRoundNow: 3 }),
    ).toBeNull()
  })
})
