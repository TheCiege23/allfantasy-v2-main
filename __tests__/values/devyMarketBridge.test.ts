import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The commissioner-set devy exchange rate, and the refusal it is allowed to lift.
 *
 * 🛑 THE MOST IMPORTANT TEST IN THIS FILE IS THAT NOTHING CHANGES WHEN NO RATE IS SET. The
 * mixed-scale refusal is the correct default — nothing prices college players, and the
 * observation set for measuring a rate is EMPTY (zero of 1,721 DevyPlayer rows have ever
 * graduated). A bridge that quietly starts grading deals for leagues that never opted in would
 * be the exact invention the refusal exists to prevent.
 *
 * The second most important is that a converted number never travels without its caveat.
 */

const findMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { devyPlayer: { findMany: (...a: unknown[]) => findMany(...a) } } }))

const {
  resolveDevyBridge,
  devyPointsToMarketUnits,
  topDevyAssetAtRate,
  DEVY_BRIDGE_SETTING_KEY,
  DEVY_BRIDGE_MIN,
  DEVY_BRIDGE_MAX,
  DEVY_BRIDGE_CAVEAT,
} = await import('@/lib/devy/devyMarketBridge')

const { identifyDevyAssets } = await import('@/lib/devy/devyTradeVerdict')

const rate = (v: unknown) => ({ [DEVY_BRIDGE_SETTING_KEY]: v })

describe('resolveDevyBridge', () => {
  it('is UNSET by default, which is not an error', () => {
    const r = resolveDevyBridge({})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unset')
  })

  it('treats an empty string as unset rather than as zero', () => {
    const r = resolveDevyBridge(rate(''))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unset')
  })

  it('accepts a number in range and carries the caveat with it', () => {
    const r = resolveDevyBridge(rate(3.5))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.marketUnitsPerDevyPoint).toBe(3.5)
      expect(r.source).toBe('league-setting')
      expect(r.caveat).toBe(DEVY_BRIDGE_CAVEAT)
    }
  })

  /* Settings arrive from text inputs and imported payloads; "3.5" is what a form produces. */
  it('accepts a numeric string, because that is what a form submits', () => {
    const r = resolveDevyBridge(rate(' 4 '))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.marketUnitsPerDevyPoint).toBe(4)
  })

  it('refuses a non-number instead of coercing it', () => {
    const r = resolveDevyBridge(rate('lots'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not_a_number')
  })

  /*
   * ⚠ THE BOUND IS A TYPO GUARD, NOT A CLAIM OF CORRECTNESS. Every value inside it is equally
   * unmeasured; the ends are what a misplaced decimal produces.
   */
  it.each([
    [DEVY_BRIDGE_MAX + 0.01],
    [DEVY_BRIDGE_MIN - 0.01],
    [350],
    [0],
    [-3],
  ])('refuses %s as out of range', (v) => {
    const r = resolveDevyBridge(rate(v))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('out_of_range')
  })

  it('accepts both ends of the accepted range', () => {
    expect(resolveDevyBridge(rate(DEVY_BRIDGE_MIN)).ok).toBe(true)
    expect(resolveDevyBridge(rate(DEVY_BRIDGE_MAX)).ok).toBe(true)
  })

  it('explains WHY an out-of-range rate was ignored, so a typo is discoverable', () => {
    const r = resolveDevyBridge(rate(350))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toMatch(/outside the accepted range/i)
  })
})

describe('conversion', () => {
  it('converts devy points at the league rate', () => {
    const b = resolveDevyBridge(rate(3))
    expect(b.ok).toBe(true)
    if (b.ok) expect(devyPointsToMarketUnits(1000, b)).toBe(3000)
  })

  /*
   * 🛑 NULL IN, NULL OUT. An unranked prospect has no devy value; converting that absence into
   * a zero prices him as the worst asset in the trade — the failure devyAssetValue refuses at
   * the other end of the pipe.
   */
  it('converts an unranked asset to null, never 0', () => {
    const b = resolveDevyBridge(rate(3))
    if (b.ok) {
      expect(devyPointsToMarketUnits(null, b)).toBeNull()
      expect(devyPointsToMarketUnits(Number.NaN, b)).toBeNull()
    }
  })

  it('shows a commissioner what the rate does to the top of his board', () => {
    const b = resolveDevyBridge(rate(3.5))
    if (b.ok) expect(topDevyAssetAtRate(b)).toBe(3500)
  })
})

/* ------------------------------------------------------------------ wiring */

const DEVY_ROW = {
  name: 'Blue Chip',
  position: 'WR',
  school: 'Ohio State',
  draftEligibleYear: 2028,
  recruitingComposite: 0.98,
  breakoutAge: 19,
  projectedDraftRound: 4,
  devyAdp: null,
  draftProjectionScore: 90,
}

const seedPrisma = () => {
  findMany.mockReset()
  /* first call = candidates, second = the ranking board */
  findMany
    .mockResolvedValueOnce([DEVY_ROW])
    .mockResolvedValueOnce([{ draftProjectionScore: 90 }, { draftProjectionScore: 50 }])
}

const MIXED = {
  give: [{ name: 'Blue Chip', marketValue: null }],
  get: [{ name: 'An NFL Player', marketValue: 4000 }],
  season: 2026,
}

beforeEach(() => seedPrisma())

describe('the refusal, and the one thing allowed to lift it', () => {
  it('🛑 REFUSES A MIXED DEAL WHEN NO RATE IS SET — the default, unchanged', async () => {
    const res = await identifyDevyAssets(MIXED)
    expect(res).not.toBeNull()
    expect(res!.refusal).toMatch(/cannot be graded as one number/i)
    expect(res!.verdict).toBeNull()
  })

  it('refuses identically when the caller supplies no league settings at all', async () => {
    const res = await identifyDevyAssets({ ...MIXED, leagueSettings: undefined })
    expect(res!.refusal).toMatch(/cannot be graded as one number/i)
    expect(res!.verdict).toBeNull()
  })

  it('grades the mixed deal once a rate is set, and withdraws the refusal', async () => {
    const res = await identifyDevyAssets({ ...MIXED, leagueSettings: rate(3) })
    expect(res!.refusal).toBeNull()
    expect(res!.verdict).toMatch(/you give/i)
    expect(res!.verdict).toMatch(/you get/i)
  })

  /*
   * 🛑 A CONVERTED NUMBER NEVER TRAVELS WITHOUT ITS CAVEAT. A grade that reads like the
   * market-backed ones, with no note attached, is the invention the refusal exists to prevent.
   */
  it('carries the caveat inside the verdict itself, not only in a side field', async () => {
    const res = await identifyDevyAssets({ ...MIXED, leagueSettings: rate(3) })
    expect(res!.verdict).toContain(DEVY_BRIDGE_CAVEAT)
    expect(res!.bridge?.ok).toBe(true)
  })

  it('names the rate it used, so the number can be checked', async () => {
    const res = await identifyDevyAssets({ ...MIXED, leagueSettings: rate(3) })
    expect(res!.verdict).toMatch(/rate of 3 market units per devy point/i)
  })

  /*
   * A commissioner who typed 350 instead of 3.5 must not see the ordinary refusal and conclude
   * the feature is broken.
   */
  it('says the rate was IGNORED when it is out of range, rather than staying silent', async () => {
    const res = await identifyDevyAssets({ ...MIXED, leagueSettings: rate(350) })
    expect(res!.verdict).toBeNull()
    expect(res!.refusal).toMatch(/outside the accepted range/i)
  })

  it('does not issue a letter grade — the conversion has not earned one', async () => {
    const res = await identifyDevyAssets({ ...MIXED, leagueSettings: rate(3) })
    expect(res!.verdict).not.toMatch(/\b(A\+|A-|B\+|C\+|D)\b/)
  })
})
