import { describe, expect, it, vi } from 'vitest'

/**
 * ONE DEVY NUMBER (2026-11-28): every devy verdict, note and Chimmy line reads the value the grade
 * uses — `heldDevyOptionValue` / `devyOptionValue`, rescaled by `optionChartFactor` where the grade
 * rescales — and the devy-points verdict is retired.
 *
 * Pure: the verdict core takes candidates and the grade's pricing rule as arguments, and the loader
 * takes stubs, so no database is involved.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { buildDevyTradeVerdict, identifyDevyAssets, applyDevyVerdictPrices } = await import('@/lib/devy/devyTradeVerdict')
const { heldDevyOptionValue, priceHeldDevyAssets } = await import('@/lib/decision-os/trade/leagueAssetRules')
const { priceOpenMarketDevySide } = await import('@/lib/devy/openMarketDevy')

type Held = import('@/lib/decision-os/trade/leagueAssetRules').HeldDevyPlayer

const SEASON = 2026
const prospect = (id: string, name: string, over: Partial<Held> = {}): Held => ({
  devyPlayerId: id,
  name,
  position: 'WR',
  ppaSeasonTotal: null,
  recruitingComposite: 0.96,
  recruitingStars: 4,
  draftEligibleYear: 2027,
  ...over,
})

const BLUE = prospect('d1', 'Blue Chip')
const RB = prospect('d2', 'Feature Back', { position: 'RB', recruitingComposite: 0.93, draftEligibleYear: 2028 })
/* No composite, no stars, no production: devyOptionValue cannot measure him. */
const UNMEASURED = prospect('d3', 'Mystery Man', { recruitingComposite: null, recruitingStars: null })

const unpricedAsset = (name: string) => ({
  name,
  type: 'player' as const,
  value: 0,
  assetValue: { marketValue: 0, impactValue: 0, vorpValue: 0, volatility: 0 },
  source: 'unknown' as const,
  unpriced: true as const,
})

describe('the fixtures are measured, so the tests below exercise real option values', () => {
  it('prices the two prospects and refuses the third', () => {
    expect(heldDevyOptionValue(BLUE, SEASON).value).toBeGreaterThan(0)
    expect(heldDevyOptionValue(RB, SEASON).value).toBeGreaterThan(0)
    expect(heldDevyOptionValue(UNMEASURED, SEASON).value).toBeNull()
  })
})

describe('the evaluator grade and Chimmy’s devy note agree on the same deal', () => {
  it('in a league: the note states exactly the value the grade priced the held prospect at', () => {
    // The evaluator's first pass — the grade's own rule (`priceEvaluatorDevy` → `priceHeldDevyAssets`).
    const graded = priceHeldDevyAssets({ prices: [unpricedAsset('Blue Chip')], held: [BLUE], currentSeason: SEASON })
    const gradeValue = graded.prices[0]!.value
    expect(graded.prices[0]!.unpriced).toBeUndefined()

    // Chimmy's note, fed the console's priced line (dataSource devy-option) beside an NFL player.
    const note = buildDevyTradeVerdict({
      give: [{ name: 'Blue Chip', marketValue: gradeValue, devy: true }],
      get: [{ name: 'Some Veteran', marketValue: 2000 }],
      season: SEASON,
      candidates: [BLUE],
      pricing: { kind: 'league', held: [BLUE] },
    })!
    expect(note.refusal).toBeNull()
    expect(note.prospects[0]!.value).toBe(gradeValue)
    expect(note.verdict).toContain(`you give ${gradeValue.toLocaleString('en-US')}`)
    expect(note.verdict).toContain('you get 2,000')
    // And it is the devyOptionValue number, not devy points.
    expect(note.verdict).not.toMatch(/devy points/i)
    expect(gradeValue).toBe(heldDevyOptionValue(BLUE, SEASON).value)
  })

  it('an UNPRICED held prospect is priced by the note on the same call the grade makes', () => {
    const note = buildDevyTradeVerdict({
      give: [{ name: 'Blue Chip', marketValue: null }],
      get: [{ name: 'Some Veteran', marketValue: 2000 }],
      season: SEASON,
      candidates: [BLUE],
      pricing: { kind: 'league', held: [BLUE] },
    })!
    const graded = priceHeldDevyAssets({ prices: [unpricedAsset('Blue Chip')], held: [BLUE], currentSeason: SEASON })
    expect(note.prospects[0]!.value).toBe(graded.prices[0]!.value)
  })

  it('with no league: the note rescales by the same chart factor the open analyzer grade uses', () => {
    const factor = 0.8
    const line = { name: 'Blue Chip', marketValue: 0, unpriced: true, dataSource: 'unknown', pricedSource: 'unknown' } as never
    const side = priceOpenMarketDevySide({ inputs: [{ kind: 'player', name: 'Blue Chip' }], lines: [line], priced: [unpricedAsset('Blue Chip')] }, [BLUE], SEASON, factor)
    const note = buildDevyTradeVerdict({
      give: [{ name: 'Blue Chip', marketValue: null }],
      get: [{ name: 'Some Veteran', marketValue: 2000 }],
      season: SEASON,
      candidates: [BLUE],
      pricing: { kind: 'open', chartFactor: factor },
    })!
    expect(note.prospects[0]!.value).toBe(side.priced[0]!.value)
    expect(note.prospects[0]!.value).toBe(Math.round(heldDevyOptionValue(BLUE, SEASON).value! * factor))
  })

  it('the evaluator substitutes the note’s values into its own pricing pass, so it grades that number', () => {
    const verdict = buildDevyTradeVerdict({
      give: [{ name: 'Blue Chip', marketValue: null }],
      get: [{ name: 'Some Veteran', marketValue: 2000 }],
      season: SEASON,
      candidates: [BLUE],
      pricing: { kind: 'open', chartFactor: 1 },
    })
    const [priced] = applyDevyVerdictPrices([unpricedAsset('Blue Chip')], verdict)
    expect(priced!.unpriced).toBeUndefined()
    expect(priced!.value).toBe(verdict!.prospects[0]!.value)
    expect(priced!.source).toBe('devy-option')
    expect(priced!.name).toBe('Blue Chip')
  })
})

describe('a devy-only deal gets a grade', () => {
  it('is compared on the option-value scale, with no refusal', () => {
    const v = buildDevyTradeVerdict({
      give: [{ name: 'Blue Chip', marketValue: null }],
      get: [{ name: 'Feature Back', marketValue: null }],
      season: SEASON,
      candidates: [BLUE, RB],
      pricing: { kind: 'open', chartFactor: 1 },
    })!
    expect(v.refusal).toBeNull()
    const give = heldDevyOptionValue(BLUE, SEASON).value!
    const get = heldDevyOptionValue(RB, SEASON).value!
    expect(v.verdict).toContain(`you give ${give.toLocaleString('en-US')}, you get ${get.toLocaleString('en-US')}`)
    expect(v.verdict).not.toMatch(/devy points/i)
  })

  it('leaves the evaluator nothing unpriced, so its ordinary grade runs', () => {
    const v = buildDevyTradeVerdict({
      give: [{ name: 'Blue Chip', marketValue: null }],
      get: [{ name: 'Feature Back', marketValue: null }],
      season: SEASON,
      candidates: [BLUE, RB],
      pricing: { kind: 'open', chartFactor: 1 },
    })
    const sender = applyDevyVerdictPrices([unpricedAsset('Blue Chip')], v)
    const receiver = applyDevyVerdictPrices([unpricedAsset('Feature Back')], v)
    expect([...sender, ...receiver].some((p) => p.unpriced)).toBe(false)
  })

  it('the loader reaches the same verdict through its stubs', async () => {
    const v = await identifyDevyAssets(
      { give: [{ name: 'Blue Chip', marketValue: null }], get: [{ name: 'Feature Back', marketValue: null }], season: SEASON },
      {
        loadCandidates: async () => [BLUE, RB],
        loadHeld: async () => [],
        loadLeague: async () => null,
        loadBridgePoints: async () => new Map(),
      },
    )
    expect(v!.refusal).toBeNull()
    expect(v!.verdict).toMatch(/you give/)
  })
})

describe('the honest refusals survive', () => {
  it('an unmeasured prospect is still withheld, never zero', () => {
    const v = buildDevyTradeVerdict({
      give: [{ name: 'Mystery Man', marketValue: null }],
      get: [{ name: 'Blue Chip', marketValue: null }],
      season: SEASON,
      candidates: [UNMEASURED, BLUE],
      pricing: { kind: 'open', chartFactor: 1 },
    })!
    expect(v.refusal).toMatch(/Mystery Man cannot be priced/)
    expect(v.refusal).toMatch(/not a low value/)
    expect(v.verdict).toBeNull()
    expect(v.prospects.find((p) => p.name === 'Mystery Man')!.value).toBeNull()
    // And the evaluator leaves every price alone, so DEVY_SCALE refuses.
    expect(applyDevyVerdictPrices([unpricedAsset('Blue Chip')], v)[0]!.unpriced).toBe(true)
  })

  it('a redraft chart prices no prospect', () => {
    const v = buildDevyTradeVerdict({
      give: [{ name: 'Blue Chip', marketValue: null }],
      get: [{ name: 'Some Veteran', marketValue: 2000 }],
      season: SEASON,
      candidates: [BLUE],
      pricing: { kind: 'open', chartFactor: null },
    })!
    expect(v.refusal).toMatch(/valued only on a dynasty chart/)
    expect(v.verdict).toBeNull()
  })

  it('in a league, a prospect the league holds no rights on is withheld — as the grade withholds him', () => {
    const v = buildDevyTradeVerdict({
      give: [{ name: 'Blue Chip', marketValue: null }],
      get: [{ name: 'Some Veteran', marketValue: 2000 }],
      season: SEASON,
      candidates: [BLUE],
      pricing: { kind: 'league', held: [] },
    })!
    expect(v.refusal).toMatch(/holds no devy rights on/)
  })

  it('a name that priced as an NFL player is never reinterpreted as a prospect', () => {
    const v = buildDevyTradeVerdict({
      give: [{ name: 'Blue Chip', marketValue: 3000 }],
      get: [{ name: 'Some Veteran', marketValue: 2000 }],
      season: SEASON,
      candidates: [BLUE],
      pricing: { kind: 'open', chartFactor: 1 },
    })
    expect(v).toBeNull()
  })
})
