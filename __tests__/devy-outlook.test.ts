import { describe, expect, it } from 'vitest'

import {
  DEVY_SCALE,
  projectDevyOutlook,
  refuseMixedScaleGrade,
  type TradeAsset,
} from '@/lib/trade-intel/devyOutlook'

/**
 * The scenario these exist for: a manager runs one franchise across two
 * platforms — his NFL league on Sleeper, his college league on Fantrax — and
 * proposes a deal that moves a player on each side. Every number this repo holds
 * for the NFL half comes from a real trade market. Nothing prices the college
 * half: verified 2026-08-25, `DevyAdp` is empty and `DevyPlayer.devyAdp` is null
 * for all 1,718 rows. A grader that quietly reconciles the two halves hands him
 * a letter that rests entirely on an exchange rate nobody has ever tested.
 */

/** A well-scouted player: three of the four signals present. */
const BLUE_CHIP = {
  recruitingComposite: 0.98,
  breakoutAge: 19.2,
  projectedDraftRound: 1,
}

/** Nothing on file at all. */
const UNKNOWN = {}

const SEASON = 2026

describe('projectDevyOutlook', () => {
  it('tags every result with the devy scale, never a market scale', () => {
    const out = projectDevyOutlook({
      player: BLUE_CHIP,
      draftEligibleYear: 2027,
      currentSeason: SEASON,
    })
    expect(out.scale).toBe(DEVY_SCALE)
    expect(out.scale).not.toBe('fantasycalc')
  })

  it('never estimates the chance he reaches the NFL, because it has never been observed', () => {
    const out = projectDevyOutlook({
      player: BLUE_CHIP,
      draftEligibleYear: 2027,
      currentSeason: SEASON,
    })
    expect(out.pReachesRelevance).toBeNull()
    expect(out.calibration).toBe('never-observed')
    expect(out.gaps.join(' ')).toMatch(/has ever been recorded reaching the NFL/)
  })

  it('always names the missing market, so a score is never mistaken for a price', () => {
    const out = projectDevyOutlook({
      player: BLUE_CHIP,
      draftEligibleYear: 2027,
      currentSeason: SEASON,
    })
    expect(out.gaps.join(' ')).toMatch(/no market prices college players/)
    expect(out.basis).toMatch(/not a value/)
  })

  it('names the empty devy ADP rather than defaulting it', () => {
    const out = projectDevyOutlook({
      player: BLUE_CHIP,
      draftEligibleYear: 2027,
      currentSeason: SEASON,
    })
    expect(out.missing).toContain('devyAdp')
    expect(out.gaps.join(' ')).toMatch(/devy ADP is empty/)
  })

  it('scores null — not zero — when no scouting signal exists at all', () => {
    const out = projectDevyOutlook({
      player: UNKNOWN,
      draftEligibleYear: 2027,
      currentSeason: SEASON,
      name: 'Nobody Onfile',
    })
    expect(out.score).toBeNull()
    expect(out.confidence).toBeNull()
    expect(out.basis).toMatch(/This is not a low score/)
  })

  it('discounts the wait: the same player is worth less the further out he is', () => {
    const near = projectDevyOutlook({
      player: BLUE_CHIP,
      draftEligibleYear: 2026,
      currentSeason: SEASON,
    })
    const mid = projectDevyOutlook({
      player: BLUE_CHIP,
      draftEligibleYear: 2028,
      currentSeason: SEASON,
    })
    const far = projectDevyOutlook({
      player: BLUE_CHIP,
      draftEligibleYear: 2031,
      currentSeason: SEASON,
    })

    expect(near.horizonYears).toBe(0)
    expect(near.timeDiscount).toBe(1)
    expect(mid.horizonYears).toBe(2)
    expect(far.horizonYears).toBe(5)

    expect(near.score).toBeGreaterThan(mid.score!)
    expect(mid.score).toBeGreaterThan(far.score!)
  })

  it('ranks on scouting alone when the eligibility year is unknown, and says so', () => {
    const out = projectDevyOutlook({
      player: BLUE_CHIP,
      draftEligibleYear: null,
      currentSeason: SEASON,
    })
    expect(out.score).not.toBeNull()
    expect(out.horizonYears).toBeNull()
    expect(out.timeDiscount).toBeNull()
    expect(out.gaps.join(' ')).toMatch(/do not know which year he becomes draft-eligible/)
  })

  it('a player already past eligibility is not discounted twice', () => {
    const out = projectDevyOutlook({
      player: BLUE_CHIP,
      draftEligibleYear: 2024,
      currentSeason: SEASON,
    })
    expect(out.horizonYears).toBe(0)
    expect(out.timeDiscount).toBe(1)
  })
})

describe('refuseMixedScaleGrade', () => {
  const nflBack: TradeAsset = { label: 'Bijan Robinson', kind: 'nfl_player' }
  const nflPick: TradeAsset = { label: '2027 1st', kind: 'nfl_rookie_pick' }
  const devyWr: TradeAsset = { label: 'Jeremiah Smith', kind: 'devy_player' }
  const collegePick: TradeAsset = { label: '2027 college 1st', kind: 'college_pick' }

  it('lets an all-NFL trade through untouched', () => {
    expect(refuseMixedScaleGrade([nflBack, nflPick])).toBeNull()
  })

  it('lets an all-devy trade through untouched', () => {
    expect(refuseMixedScaleGrade([devyWr, collegePick])).toBeNull()
  })

  it('refuses to grade an NFL player against a devy player', () => {
    const verdict = refuseMixedScaleGrade([nflBack, devyWr])
    expect(verdict).not.toBeNull()
    expect(verdict!.gradeable).toBe(false)
    expect(verdict!.pricedAssets).toEqual(['Bijan Robinson'])
    expect(verdict!.devyAssets).toEqual(['Jeremiah Smith'])
    expect(verdict!.reason).toMatch(/inventing an exchange rate/)
  })

  /**
   * The label trap: "2027 1st" and "2027 college 1st" read almost the same and
   * are wildly different assets. Treating the college pick as an NFL rookie pick
   * prices it off the NFL rookie curve, which is the same error as pricing the
   * player off it.
   */
  it('treats a college pick as unpriced even when an NFL pick is the only other asset', () => {
    const verdict = refuseMixedScaleGrade([nflPick, collegePick])
    expect(verdict).not.toBeNull()
    expect(verdict!.pricedAssets).toEqual(['2027 1st'])
    expect(verdict!.devyAssets).toEqual(['2027 college 1st'])
  })

  it('names every asset on both sides so the manager can see what was and was not priced', () => {
    const verdict = refuseMixedScaleGrade([nflBack, nflPick, devyWr, collegePick])
    expect(verdict!.pricedAssets).toEqual(['Bijan Robinson', '2027 1st'])
    expect(verdict!.devyAssets).toEqual(['Jeremiah Smith', '2027 college 1st'])
    expect(verdict!.reason).toContain('Bijan Robinson')
    expect(verdict!.reason).toContain('2027 college 1st')
  })
})
