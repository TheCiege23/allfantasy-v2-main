import { describe, expect, it } from 'vitest'

import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import {
  CONVERTING_IDOLS,
  idolHorizon,
  mergeInversionNote,
  stealIdolValue,
  tribeRelationNote,
} from '@/lib/trade-intel/survivor'

/**
 * Four tribes of five. The lowest-scoring TRIBE attends Tribal Council;
 * post-merge it is individual and the weekly TOP scorer takes Immunity. Nine to
 * twelve idols are seeded after the draft, one-time use, tradeable, and almost
 * all expire at the merge.
 */

describe('tribeRelationNote: who you trade with decides whether it helps', () => {
  it('⚠ a losing trade with a TRIBEMATE can still be correct', () => {
    /*
     * The largest factor in a pre-merge Survivor trade and no chart has it. You
     * attend Tribal only if your TRIBE scores lowest, so points handed to a
     * tribemate still keep you out of it.
     */
    const n = tribeRelationNote({ relation: 'tribemate', valueOutFlow: true })!
    expect(n).toContain('can be correct here')
  })

  it('⚠ and names the catch rather than selling the idea', () => {
    // The tribemate you just strengthened is also the person who votes at your
    // Tribal. The model cannot resolve that, so it says so.
    expect(tribeRelationNote({ relation: 'tribemate', valueOutFlow: true })).toContain(
      'also votes at your Tribal',
    )
  })

  it('the same deal across tribes has to win on value alone', () => {
    const n = tribeRelationNote({ relation: 'rival', valueOutFlow: true })!
    expect(n).toContain('no cooperative upside')
  })

  it('value arriving from a rival tribe helps twice', () => {
    expect(tribeRelationNote({ relation: 'rival', valueOutFlow: false })).toContain('helps you twice')
  })

  it('post-merge there is no cooperative case at all', () => {
    expect(tribeRelationNote({ relation: 'post-merge', valueOutFlow: true })).toContain(
      'stop making sense',
    )
  })

  it('says nothing when the relation is unknown', () => {
    expect(tribeRelationNote({ relation: 'unknown', valueOutFlow: true })).toBeNull()
  })
})

describe('idolHorizon: a cliff, not a slope to zero', () => {
  it('⚠ a pre-merge idol saved too long becomes worth nothing', () => {
    /*
     * Almost every power in the pool expires AT the merge. Saving one for the
     * perfect moment is exactly how it ends up unused and worthless.
     */
    const early = idolHorizon({ weeksToMerge: 6, preMergeWeeks: 6 })!
    const late = idolHorizon({ weeksToMerge: 1, preMergeWeeks: 6 })!
    expect(early.usabilityMultiplier).toBe(1)
    expect(late.usabilityMultiplier).toBeCloseTo(1 / 6, 5)
    expect(late.basis).toContain('worth nothing')
  })

  it('reports an expired idol as worth nothing, not as a small number', () => {
    const gone = idolHorizon({ weeksToMerge: 0, preMergeWeeks: 6 })!
    expect(gone.basis).toContain('already worth nothing')
  })

  it('⚠ the two converting idols keep a floor and are the ones to sit on', () => {
    /*
     * "Convert Idol → FAAB" and "Convert Idol → Points" convert instead of
     * expiring. They are the only two in a twenty-power pool with a floor, and
     * treating every idol the same would price them identically to one that
     * evaporates.
     */
    expect(CONVERTING_IDOLS).toHaveLength(2)
    const f = idolHorizon({ weeksToMerge: 1, preMergeWeeks: 6, power: 'Convert Idol → FAAB' })!
    expect(f.hasFloor).toBe(true)
    expect(f.basis).toContain('safely sit on')
  })

  it('withholds on impossible inputs rather than returning a multiplier', () => {
    expect(idolHorizon({ weeksToMerge: 9, preMergeWeeks: 6 })).toBeNull()
    expect(idolHorizon({ weeksToMerge: 2, preMergeWeeks: 0 })).toBeNull()
  })
})

describe('stealIdolValue: worth what it can take, not what tier it is', () => {
  const rosters = [
    { label: 'Tribe A #1', playerValues: [8000, 6000, 5000, 1000] },
    { label: 'Tribe B #2', playerValues: [3000, 2500, 2000, 500] },
  ]

  it('⚠ prices a Triple Steal against real rosters', () => {
    /*
     * The same idol is a completely different asset in a league where the best
     * roster's top three are worth 19,000 versus one where they are worth 7,500.
     * Every other model would call both "a steal idol".
     */
    const v = stealIdolValue({ eligibleRosters: rosters, takes: 3 })!
    expect(v.bestTarget).toBe('Tribe A #1')
    expect(v.value).toBe(19000)
  })

  it('⚠ respects the legal target set, which is narrower for a Single Steal', () => {
    /*
     * A Single Steal may only take from an opponent you DEFEATED last week.
     * Passing the whole league would overstate it substantially.
     */
    const v = stealIdolValue({ eligibleRosters: [rosters[1]!], takes: 1 })!
    expect(v.bestTarget).toBe('Tribe B #2')
    expect(v.value).toBe(3000)
  })

  it('skips unpriced players rather than counting them as zero', () => {
    const v = stealIdolValue({
      eligibleRosters: [{ label: 'X', playerValues: [Number.NaN, 0, 4000, 3000] }],
      takes: 3,
    })!
    expect(v.value).toBe(7000)
  })

  it('withholds when nothing targetable is priced', () => {
    expect(stealIdolValue({ eligibleRosters: [{ label: 'X', playerValues: [] }], takes: 3 })).toBeNull()
    expect(stealIdolValue({ eligibleRosters: [], takes: 3 })).toBeNull()
  })
})

describe('mergeInversionNote: the one inversion with a date on it', () => {
  it('⚠ warns BEFORE the merge, while there is still time to trade for it', () => {
    /*
     * Pre-merge your tribe needs a floor; post-merge Immunity goes to the top
     * scorer and you need a ceiling. A manager who builds for one and arrives at
     * the other has built the wrong team on a known schedule.
     */
    const n = mergeInversionNote({ weeksToMerge: 2 })!
    expect(n).toContain('inverts what a good roster is')
    expect(n).toContain('about to be playing')
  })

  it('stays quiet while the merge is far off', () => {
    expect(mergeInversionNote({ weeksToMerge: 8 })).toBeNull()
  })

  it('says the floor-built roster is now the wrong one', () => {
    expect(mergeInversionNote({ weeksToMerge: 0 })).toContain('game that just ended')
  })
})

describe('survivor is its own concept now', () => {
  it('⚠ no longer falls through to "other"', () => {
    expect(readFormatRules({ leagueType: 'survivor' }).concept).toBe('survivor')
  })

  it('keeps idols and picks tradeable, because the rules say they are', () => {
    const r = readFormatRules({ leagueType: 'survivor' })
    expect(r.notes.join(' ')).toContain('tradeable')
  })
})
