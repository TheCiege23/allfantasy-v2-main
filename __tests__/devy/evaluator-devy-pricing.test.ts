// @vitest-environment node
/**
 * The trade evaluator prices college players this league holds (2026-09-28) instead of refusing every
 * one with DEVY_SCALE — with the SAME rule the one grade uses, so the page and the letter agree.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { applyDevyPricing, priceHeldDevyAssets, type HeldDevyPlayer } from '@/lib/decision-os/trade/leagueAssetRules'
import { priceEvaluatorDevy } from '@/lib/decision-os/trade/leagueAssetPolicy'
import type { PricedAsset } from '@/lib/hybrid-valuation'

const code = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const HELD: HeldDevyPlayer[] = [
  { devyPlayerId: 'd1', name: 'Jeremiah Smith', position: 'WR', ppaSeasonTotal: 60, recruitingComposite: 0.9999, recruitingStars: 5, draftEligibleYear: 2027 },
  { devyPlayerId: 'd2', name: 'Unmeasured Prospect', position: 'RB', ppaSeasonTotal: null, recruitingComposite: null, recruitingStars: 4, draftEligibleYear: null },
]
const unpriced = (name: string): PricedAsset => ({
  name,
  type: 'player',
  value: 0,
  assetValue: { marketValue: 0, impactValue: 0, vorpValue: 0, volatility: 0.5 },
  source: 'unknown',
  unpriced: true,
})
const priced = (name: string, value: number): PricedAsset => ({
  name,
  type: 'player',
  value,
  assetValue: { marketValue: value, impactValue: value, vorpValue: 0, volatility: 0.3 },
  source: 'fantasycalc',
})

describe('priceHeldDevyAssets', () => {
  it('prices an unpriced prospect this league holds, as a devy option; touches nothing else', () => {
    const out = priceHeldDevyAssets({
      prices: [priced('Ja’Marr Chase', 9000), unpriced('Jeremiah Smith'), unpriced('Somebody Nobody Holds')],
      held: HELD,
      currentSeason: 2026,
    })
    expect(out.devyPriced).toEqual(['Jeremiah Smith'])
    expect(out.prices[0]).toEqual(priced('Ja’Marr Chase', 9000))
    expect(out.prices[1]).toMatchObject({ name: 'Jeremiah Smith', source: 'devy-option', position: 'WR' })
    expect(out.prices[1]!.unpriced).toBeFalsy()
    expect(out.prices[1]!.value).toBeGreaterThan(0)
    expect(out.prices[2]).toMatchObject({ name: 'Somebody Nobody Holds', unpriced: true })
  })

  it('a held prospect devyOptionValue cannot measure stays unpriced — null is never zero', () => {
    const out = priceHeldDevyAssets({ prices: [unpriced('Unmeasured Prospect')], held: HELD, currentSeason: 2026 })
    expect(out.prices[0]!.unpriced).toBe(true)
    expect(out.devyPriced).toEqual([])
    expect(out.unmeasured[0]).toMatch(/cannot be priced: draftEligibleYear/)
  })

  it('🛑 gives the SAME value the one grade gives the same prospect (applyDevyPricing)', () => {
    const evaluator = priceHeldDevyAssets({ prices: [unpriced('Jeremiah Smith')], held: HELD, currentSeason: 2026 })
    const grade = applyDevyPricing({
      inputs: [{ kind: 'player', name: 'Jeremiah Smith' }],
      lines: [{ name: 'Jeremiah Smith', unpriced: true, marketValue: 0 } as never],
      priced: [unpriced('Jeremiah Smith')],
      held: HELD,
      currentSeason: 2026,
    })
    expect(grade.devyPriced).toBe(1)
    expect(evaluator.prices[0]!.value).toBe(grade.priced[0]!.value)
  })
})

describe('priceEvaluatorDevy', () => {
  const deps = (league: { sport: string | null; season: number | null } | null, held = HELD) => ({
    loadLeague: vi.fn(async () => league),
    loadHeld: vi.fn(async () => held),
  })

  it('prices held prospects in an NFL league with a season', async () => {
    const d = deps({ sport: 'NFL', season: 2026 })
    const out = await priceEvaluatorDevy({ leagueId: 'L1', prices: [unpriced('Jeremiah Smith')] }, d)
    expect(out.devyPriced).toEqual(['Jeremiah Smith'])
    expect(d.loadHeld).toHaveBeenCalledWith('L1')
  })

  it('reads nothing when every asset is already priced', async () => {
    const d = deps({ sport: 'NFL', season: 2026 })
    const out = await priceEvaluatorDevy({ leagueId: 'L1', prices: [priced('X', 100)] }, d)
    expect(out.devyPriced).toEqual([])
    expect(d.loadLeague).not.toHaveBeenCalled()
  })

  it('leaves everything unpriced outside NFL, without a league, or with no held rights — and never throws', async () => {
    for (const d of [deps({ sport: 'NCAAF', season: 2026 }), deps(null), deps({ sport: 'NFL', season: 2026 }, [])]) {
      const out = await priceEvaluatorDevy({ leagueId: 'L1', prices: [unpriced('Jeremiah Smith')] }, d)
      expect(out.prices[0]!.unpriced).toBe(true)
    }
    const failing = { loadLeague: vi.fn(async () => { throw new Error('db down') }), loadHeld: vi.fn() }
    const out = await priceEvaluatorDevy({ leagueId: 'L1', prices: [unpriced('Jeremiah Smith')] }, failing as never)
    expect(out.prices[0]!.unpriced).toBe(true)
  })
})

describe('the trade-evaluator route', () => {
  const route = code('app/api/trade-evaluator/route.ts')

  it('prices held prospects BEFORE the refusal, in the league the grade uses', () => {
    const devyPass = route.indexOf('priceEvaluatorDevy({ leagueId: devyLeagueId, prices: rawSenderPlayerPrices })')
    const refusal = route.indexOf("error: 'DEVY_SCALE'")
    expect(devyPass).toBeGreaterThan(0)
    expect(refusal).toBeGreaterThan(devyPass)
    expect(route).toMatch(/const senderPlayerPrices = senderDevyPass\?\.prices \?\? rawSenderPlayerPrices/)
    // One membership-checked resolution, shared by the devy pass and the grade.
    expect(route.match(/resolveEvaluationLeagueId\(/g)).toHaveLength(1)
    expect(route).toMatch(/const evaluationLeagueId = await evaluationLeagueIdPromise/)
  })
})
