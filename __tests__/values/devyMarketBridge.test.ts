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
  DEVY_BRIDGE_CONFIG_KEY,
  DEVY_BRIDGE_MIN,
  DEVY_BRIDGE_MAX,
  DEVY_BRIDGE_CAVEAT,
} = await import('@/lib/devy/devyMarketBridge')

const { identifyDevyAssets } = await import('@/lib/devy/devyTradeVerdict')

/*
 * ⚠ NESTED, MATCHING WHERE THE COMMISSIONER UI ACTUALLY WRITES. `DevyLeagueSettingsHub` PATCHes
 * `devyLeagueConfig`, which the settings route stores under `devy_league_config`. A test that
 * put the rate at the top level of `settings` would pass against a module nothing in the
 * product could ever configure.
 */
const rate = (v: unknown) => ({ [DEVY_BRIDGE_CONFIG_KEY]: { version: 1, [DEVY_BRIDGE_SETTING_KEY]: v } })

describe('resolveDevyBridge', () => {
  it('is UNSET when the league has a devy config but no rate in it', () => {
    const r = resolveDevyBridge({ [DEVY_BRIDGE_CONFIG_KEY]: { version: 1 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unset')
  })

  it('is UNSET when there is no devy config at all', () => {
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

/*
 * 🛑 SINCE 2026-11-28 THE DEFAULT IS THE MEASURED OPTION VALUE, NOT A REFUSAL. A mixed deal is graded on
 * `devyOptionValue` with no conversion (`lib/devy/devyTradeVerdict.ts`); the bridge is the explicit
 * override a caller opts into by passing settings. What must still hold: nothing changes for a league
 * that set no rate, a converted number never travels without its caveat, and a bad rate is named.
 */
const BLUE_CHIP = {
  devyPlayerId: 'd1',
  name: 'Blue Chip',
  position: 'WR',
  ppaSeasonTotal: null,
  recruitingComposite: 0.96,
  recruitingStars: 4,
  draftEligibleYear: 2027,
}

const deps = {
  loadCandidates: async () => [BLUE_CHIP],
  loadHeld: async () => [],
  loadLeague: async () => null,
  loadBridgePoints: async () => new Map([['d1', 900]]),
}

const MIXED = {
  give: [{ name: 'Blue Chip', marketValue: null }],
  get: [{ name: 'An NFL Player', marketValue: 4000 }],
  season: 2026,
}

beforeEach(() => findMany.mockReset())

describe('the measured default, and the one override allowed to replace it', () => {
  it('🛑 GRADES A MIXED DEAL ON THE OPTION VALUE WHEN NO RATE IS SET — no conversion, no caveat', async () => {
    const res = await identifyDevyAssets({ ...MIXED, leagueSettings: rate('') }, deps)
    expect(res!.refusal).toBeNull()
    expect(res!.verdict).toMatch(/measured option value/i)
    expect(res!.verdict).not.toContain(DEVY_BRIDGE_CAVEAT)
  })

  it('is identical when the caller supplies no league settings at all', async () => {
    const a = await identifyDevyAssets({ ...MIXED, leagueSettings: undefined }, deps)
    const b = await identifyDevyAssets({ ...MIXED, leagueSettings: rate('') }, deps)
    expect(a!.verdict).toBe(b!.verdict)
  })

  it('uses the commissioner’s rate once one is set', async () => {
    const res = await identifyDevyAssets({ ...MIXED, leagueSettings: rate(3) }, deps)
    expect(res!.refusal).toBeNull()
    expect(res!.verdict).toMatch(/you give 2,700/i)
    expect(res!.verdict).toMatch(/you get 4,000/i)
  })

  /*
   * 🛑 A CONVERTED NUMBER NEVER TRAVELS WITHOUT ITS CAVEAT. A grade that reads like the
   * market-backed ones, with no note attached, is the invention the refusal exists to prevent.
   */
  it('carries the caveat inside the verdict itself, not only in a side field', async () => {
    const res = await identifyDevyAssets({ ...MIXED, leagueSettings: rate(3) }, deps)
    expect(res!.verdict).toContain(DEVY_BRIDGE_CAVEAT)
    expect(res!.bridge?.ok).toBe(true)
  })

  it('names the rate it used, so the number can be checked', async () => {
    const res = await identifyDevyAssets({ ...MIXED, leagueSettings: rate(3) }, deps)
    expect(res!.verdict).toMatch(/rate of 3 market units per devy point/i)
  })

  /*
   * A commissioner who typed 350 instead of 3.5 must not conclude the feature is broken.
   */
  it('says the rate was IGNORED when it is out of range, and keeps the measured value', async () => {
    const res = await identifyDevyAssets({ ...MIXED, leagueSettings: rate(350) }, deps)
    expect(res!.standings.join(' ')).toMatch(/outside the accepted range/i)
    expect(res!.verdict).toMatch(/measured option value/i)
  })

  it('does not issue a letter grade — the conversion has not earned one', async () => {
    const res = await identifyDevyAssets({ ...MIXED, leagueSettings: rate(3) }, deps)
    expect(res!.verdict).not.toMatch(/\b(A\+|A-|B\+|C\+|D)\b/)
  })

  it('never converts a devy-for-devy deal, even with a rate set', async () => {
    const res = await identifyDevyAssets(
      { give: [{ name: 'Blue Chip', marketValue: null }], get: [{ name: 'Blue Chip', marketValue: null }], season: 2026, leagueSettings: rate(3) },
      deps,
    )
    expect(res!.verdict).not.toContain(DEVY_BRIDGE_CAVEAT)
  })
})
