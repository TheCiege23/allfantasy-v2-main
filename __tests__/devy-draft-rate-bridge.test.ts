import { describe, expect, it, vi } from 'vitest'

/**
 * ⚠ THIS IS THE TEST THAT MAKES THE PLACEHOLDER SAFE. `draftRates.generated.ts`
 * is empty until scripts/devy-draft-rate-backfill.ts runs, which is blocked on
 * the CFBD monthly quota. Without this, the entire measured-P path would ship
 * unexercised and we would find out whether it worked on the day the rates
 * landed — which is exactly the "built, merged, never called" failure this repo
 * keeps repeating.
 *
 * So: mock the generated table as though the backfill HAS run, and assert the
 * bridge lights up on its own.
 */
vi.mock('@/lib/devy/draftRates.generated', () => {
  /* Mirrors the real cells the backfill emits, including one deliberately
     under-sampled cell (RB/5) to prove the minimum-sample floor holds. */
  const DRAFT_RATES = [
    { position: 'WR', stars: 5, recruits: 400, drafted: 96, rate: 0.24 },
    { position: 'WR', stars: 3, recruits: 3000, drafted: 60, rate: 0.02 },
    { position: 'RB', stars: 5, recruits: 20, drafted: 6, rate: 0.3 },
  ]
  return {
    DRAFT_RATES,
    DRAFT_RATE_PROVENANCE: {
      recruitClasses: [2013, 2014],
      draftYears: [2016, 2017],
      outcomeWindowYears: [3, 4, 5],
      totalRecruits: 3420,
      totalDrafted: 162,
      overallRate: 0.047,
      measured: true,
    },
    /* Same contract as the generated file: null below minSample. */
    draftRateFor(position: string, stars: number | null, minSample = 50) {
      if (stars == null) return null
      const hit = DRAFT_RATES.find((c) => c.position === position && c.stars === stars)
      if (!hit || hit.recruits < minSample) return null
      return hit
    },
  }
})

const SEASON = 2026
const PLAYER = { recruitingComposite: 0.98, projectedDraftRound: 1 }

describe('the draft-rate bridge activates on its own once rates exist', () => {
  it('reports a measured probability with its sample size', async () => {
    const { projectDevyOutlook } = await import('@/lib/trade-intel/devyOutlook')
    const out = projectDevyOutlook({
      player: PLAYER,
      draftEligibleYear: 2027,
      currentSeason: SEASON,
      position: 'WR',
      recruitingStars: 5,
    })

    expect(out.pReachesRelevance).toBeCloseTo(0.24, 5)
    expect(out.pSampleSize).toBe(400)
    expect(out.calibration).toBe('measured-drafted-rate')
  })

  it('stops claiming the probability is unmeasured once it is', async () => {
    const { projectDevyOutlook } = await import('@/lib/trade-intel/devyOutlook')
    const out = projectDevyOutlook({
      player: PLAYER,
      draftEligibleYear: 2027,
      currentSeason: SEASON,
      position: 'WR',
      recruitingStars: 5,
    })
    expect(out.gaps.join(' ')).not.toMatch(/no historical cohort has been measured/)
  })

  /**
   * ⚠ The missing market is NOT fixed by having a draft rate. Knowing how often
   * a 5-star receiver gets drafted says nothing about what he trades for, so the
   * scale separation stands regardless.
   */
  it('still refuses to claim a market price', async () => {
    const { projectDevyOutlook } = await import('@/lib/trade-intel/devyOutlook')
    const out = projectDevyOutlook({
      player: PLAYER,
      draftEligibleYear: 2027,
      currentSeason: SEASON,
      position: 'WR',
      recruitingStars: 5,
    })
    expect(out.gaps.join(' ')).toMatch(/no market prices college players/)
    expect(out.scale).toBe('devy-ordinal-0-100')
  })

  it('a player with no stars gets no probability rather than the pool average', async () => {
    const { projectDevyOutlook } = await import('@/lib/trade-intel/devyOutlook')
    const out = projectDevyOutlook({
      player: PLAYER,
      draftEligibleYear: 2027,
      currentSeason: SEASON,
      position: 'WR',
      recruitingStars: null,
    })
    expect(out.pReachesRelevance).toBeNull()
    expect(out.calibration).toBe('never-observed')
  })

  /**
   * ⚠ A cell with 20 recruits is not a rate. Reporting 30% off six drafted
   * players would be the most confident number in the model.
   */
  it('a cell below the minimum sample yields null, not a rate', async () => {
    const { projectDevyOutlook } = await import('@/lib/trade-intel/devyOutlook')
    const out = projectDevyOutlook({
      player: PLAYER,
      draftEligibleYear: 2027,
      currentSeason: SEASON,
      position: 'RB',
      recruitingStars: 5,
    })
    expect(out.pReachesRelevance).toBeNull()
    expect(out.calibration).toBe('never-observed')
  })
})
