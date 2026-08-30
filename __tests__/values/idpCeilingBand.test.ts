import { describe, expect, it, vi } from 'vitest'

/**
 * Does this verdict rest on the one number in the IDP stack nobody can measure?
 *
 * 🛑 WHY THIS EXISTS. `IDP_CEILING_DYNASTY` sets what the best defender in a league is worth
 * against the offensive board. It is explicitly unmeasured — three routes to measuring it are
 * closed and documented on the constant — and it went load-bearing the moment defenders
 * started reaching real trade grades. Replaying every production trade containing a priced
 * defender through the real grading path at six ceilings (probe-idp-ceiling-sensitivity.ts,
 * 2026-08-30) moved one of them FIVE grades:
 *
 *   Devin Lloyd + Dallas Turner  <->  Keaton Mitchell + Keon Coleman + Ollie Gordon
 *   D  D  C  B-  B  A-     across ceilings 1,000 -> 11,000
 *
 * ⚠ AND ONE OF THEM DID NOT MOVE AT ALL, WHICH IS THE MORE IMPORTANT HALF. Nolan Smith for
 * Jack Campbell — defender for defender — held at D across the entire range. That is not a
 * coincidence to be verified once and forgotten: `percentDiff` is (r-g)/(r+g), so a factor
 * common to BOTH sides cancels exactly. Any future change that makes a defender-for-defender
 * trade ceiling-sensitive has broken the arithmetic, and the third test here is what says so.
 */

vi.mock('@/lib/historical-values', () => ({
  getHistoricalPlayerValue: vi.fn(),
  getHistoricalPickValueWeighted: vi.fn(() => ({ value: null })),
}))
vi.mock('@/lib/fantasycalc', () => ({ findPlayerByName: vi.fn() }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: vi.fn(async () => []) }))
vi.mock('@/lib/player-analytics', () => ({ getPlayerAnalytics: vi.fn() }))

const { idpCeilingCompositeBand, idpCeilingGradeBand, compositeScore } = await import(
  '@/lib/hybrid-valuation'
)
const { IDP_CEILING_UNCERTAINTY_BAND } = await import('@/lib/idp-kicker-values')

type Asset = Parameters<typeof idpCeilingGradeBand>[0][number]

/** Mirrors what pricePlayer's league branch builds: impact and vorp as fixed shares of value. */
const asset = (name: string, value: number, source: Asset['source']): Asset => ({
  name,
  type: 'player',
  value,
  assetValue: {
    marketValue: value,
    impactValue: Math.round(value * 0.6),
    vorpValue: Math.round(value * 0.3),
    volatility: 0.1,
  },
  source,
})

const defender = (name: string, value: number) => asset(name, value, 'idp-vorp')
const offence = (name: string, value: number) => asset(name, value, 'fantasycalc')

describe('idpCeilingCompositeBand', () => {
  it('returns null when no asset was priced off the IDP board', () => {
    expect(idpCeilingCompositeBand([offence('Ja Marr Chase', 9000)], [offence('CeeDee Lamb', 8000)]))
      .toBeNull()
  })

  it('leaves an offensive asset untouched at both ends of the band', () => {
    const band = idpCeilingCompositeBand([defender('Devin Lloyd', 946)], [offence('Keon Coleman', 942)])
    expect(band).not.toBeNull()
    expect(band!.low.gave).toBe(compositeScore(offence('Keon Coleman', 942).assetValue))
    expect(band!.high.gave).toBe(band!.low.gave)
  })

  it('scales the defender in proportion to the ceiling', () => {
    const band = idpCeilingCompositeBand([defender('Devin Lloyd', 946)], [offence('Keon Coleman', 942)])!
    // 0.5x to 1.5x is a threefold move on the defensive side.
    expect(band.high.received / band.low.received).toBeCloseTo(3, 1)
  })

  /**
   * ⚠ FAAB IS PART OF A SIDE BUT IS NOT A PRICED ASSET. Omitting it would overstate how much
   * of a side the ceiling moves, which would over-report the caveat on exactly the trades
   * where cash is doing the balancing.
   */
  it('includes a constant offset in each side', () => {
    const plain = idpCeilingCompositeBand([defender('Devin Lloyd', 946)], [offence('Keon Coleman', 942)])!
    const withFaab = idpCeilingCompositeBand(
      [defender('Devin Lloyd', 946)],
      [offence('Keon Coleman', 942)],
      { received: 100, gave: 250 },
    )!
    expect(withFaab.low.received).toBe(plain.low.received + 100)
    expect(withFaab.low.gave).toBe(plain.low.gave + 250)
    expect(withFaab.high.gave).toBe(plain.high.gave + 250)
  })
})

describe('idpCeilingGradeBand', () => {
  /** 🛑 THE CANCELLATION PROPERTY. Nolan Smith <-> Jack Campbell held at D across an 11x range. */
  it('is not sensitive when both sides are defenders', () => {
    const band = idpCeilingGradeBand([defender('Nolan Smith', 88)], [defender('Jack Campbell', 3104)])!
    expect(band.sensitive).toBe(false)
    expect(band.low).toBe(band.high)
  })

  it('is not sensitive when neither side has a defender', () => {
    expect(idpCeilingGradeBand([offence('A', 5000)], [offence('B', 5000)])).toBeNull()
  })

  /** The measured five-grade case, in the shape that produced it: defence for offence. */
  it('is sensitive when defenders sit on one side only', () => {
    const band = idpCeilingGradeBand(
      [defender('Devin Lloyd', 946), defender('Dallas Turner', 234)],
      [offence('Keaton Mitchell', 1401), offence('Keon Coleman', 942), offence('Ollie Gordon', 721)],
    )!
    expect(band.sensitive).toBe(true)
    expect(band.low).not.toBe(band.high)
  })

  /**
   * ⚠ THE DIRECTION MUST NOT INVERT. A higher ceiling makes the defence-heavy side worth
   * more, so the grade for the manager RECEIVING defenders can only improve. If this ever
   * reverses, the band is being applied to the wrong side and every caveat reads backwards.
   */
  it('moves the receiving side in the right direction', () => {
    const band = idpCeilingCompositeBand(
      [defender('Devin Lloyd', 946), defender('Dallas Turner', 234)],
      [offence('Keaton Mitchell', 1401), offence('Keon Coleman', 942), offence('Ollie Gordon', 721)],
    )!
    expect(band.high.received).toBeGreaterThan(band.low.received)
    expect(band.high.gave).toBe(band.low.gave)
  })
})

describe('the band itself', () => {
  /**
   * 🛑 IT MUST SPAN BOTH DERIVATIONS THE CEILING'S OWN COMMENT RECORDS. Matching the #1
   * offensive asset's SHARE gives ~5,300; matching its PERCENTILE gives ~8,000. A band that
   * excluded either would be asserting a precision the source explicitly disclaims.
   */
  it('spans the two principled readings of the ceiling', () => {
    const shipped = 5500
    const lo = shipped * IDP_CEILING_UNCERTAINTY_BAND.low
    const hi = shipped * IDP_CEILING_UNCERTAINTY_BAND.high
    expect(lo).toBeLessThanOrEqual(5300)
    expect(hi).toBeGreaterThanOrEqual(8000)
  })

  it('is a band, not a point', () => {
    expect(IDP_CEILING_UNCERTAINTY_BAND.low).toBeLessThan(1)
    expect(IDP_CEILING_UNCERTAINTY_BAND.high).toBeGreaterThan(1)
  })
})
