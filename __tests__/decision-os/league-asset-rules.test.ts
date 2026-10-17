import { describe, expect, it } from 'vitest'
import {
  applyDevyPricing,
  matchHeldDevy,
  pickPolicyRefusal,
  REDRAFT_PICKS_REASON,
  type HeldDevyPlayer,
} from '@/lib/decision-os/trade/leagueAssetRules'
import { devyOptionValue } from '@/lib/devy/devyOptionValue'
import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { TradeAssetInput, TradeConsolePlayerLine } from '@/lib/trade-value-console/types'

const pick = (year: number, round = 1): TradeAssetInput => ({ kind: 'pick', year, round })
const player = (name: string, extra: Partial<Extract<TradeAssetInput, { kind: 'player' }>> = {}): TradeAssetInput => ({ kind: 'player', name, ...extra })

describe('pickPolicyRefusal — picks are refused only where nothing prices them honestly', () => {
  const nflDynasty = { sport: 'NFL', leagueType: 'dynasty', leagueSeason: 2026 }

  it('a deal with no picks is never refused here', () => {
    expect(pickPolicyRefusal({ ...nflDynasty, leagueType: 'redraft', assets: [player('Josh Allen')] })).toBeNull()
  })

  it('a redraft league refuses any pick (the design’s rule)', () => {
    expect(pickPolicyRefusal({ sport: 'NFL', leagueType: 'redraft', leagueSeason: 2026, assets: [pick(2027)] })).toBe(REDRAFT_PICKS_REASON)
  })

  it('a sport with no pick data of its own refuses, naming the sport', () => {
    expect(pickPolicyRefusal({ sport: 'NBA', leagueType: 'dynasty', leagueSeason: 2026, assets: [pick(2027)] })).toMatch(/no NBA price yet/)
  })

  it('college leagues are left to their own refusal', () => {
    expect(pickPolicyRefusal({ sport: 'NCAAF', leagueType: 'dynasty', leagueSeason: 2026, assets: [pick(2027)] })).toBeNull()
  })

  it('a pick for a season before the league’s has been used', () => {
    expect(pickPolicyRefusal({ ...nflDynasty, assets: [pick(2025)] })).toMatch(/2025 draft has already been held/)
  })

  it('a current-season pick is used once the host says the season is under way — and priced while it does not say', () => {
    expect(pickPolicyRefusal({ ...nflDynasty, leagueStatus: 'in_season', assets: [pick(2026)] })).toMatch(/2026 draft has already been held/)
    expect(pickPolicyRefusal({ ...nflDynasty, leagueStatus: 'complete', assets: [pick(2026)] })).toMatch(/already been held/)
    expect(pickPolicyRefusal({ ...nflDynasty, leagueStatus: 'pre_draft', assets: [pick(2026)] })).toBeNull()
    expect(pickPolicyRefusal({ ...nflDynasty, leagueStatus: null, assets: [pick(2026)] })).toBeNull()
  })

  it('future picks in an NFL dynasty league are priced as before', () => {
    expect(pickPolicyRefusal({ ...nflDynasty, leagueStatus: 'in_season', assets: [pick(2027), pick(2028, 2)] })).toBeNull()
  })

  it('no league season: no evidence a draft was held', () => {
    expect(pickPolicyRefusal({ sport: 'NFL', leagueType: 'dynasty', leagueSeason: null, assets: [pick(2020)] })).toBeNull()
  })
})

const held: HeldDevyPlayer[] = [
  { devyPlayerId: 'd1', name: 'Jeremiah Smith', position: 'WR', ppaSeasonTotal: 60, recruitingComposite: 0.9999, recruitingStars: 5, draftEligibleYear: 2027 },
  { devyPlayerId: 'd2', name: 'Ryan Williams', position: 'WR', ppaSeasonTotal: 45, recruitingComposite: 0.98, recruitingStars: 5, draftEligibleYear: 2027 },
  { devyPlayerId: 'd3', name: 'Ryan Williams', position: 'RB', ppaSeasonTotal: null, recruitingComposite: 0.9, recruitingStars: 4, draftEligibleYear: 2028 },
  { devyPlayerId: 'd4', name: 'Nobody Measured', position: 'K', ppaSeasonTotal: null, recruitingComposite: null, recruitingStars: null, draftEligibleYear: null },
]

describe('matchHeldDevy — a prospect this league holds, or none', () => {
  it('an id wins, even when the name is shared', () => {
    expect(matchHeldDevy({ rosterPlayerId: 'd3', name: 'Ryan Williams' }, 'Ryan Williams', held)?.position).toBe('RB')
    expect(matchHeldDevy({ playerId: 'd2' }, 'Ryan Williams', held)?.position).toBe('WR')
  })

  it('a name only one held prospect carries matches; a shared one does not', () => {
    expect(matchHeldDevy({ name: 'Jeremiah Smith Jr.' }, 'Jeremiah Smith Jr.', held)?.devyPlayerId).toBe('d1')
    expect(matchHeldDevy({ name: 'Ryan Williams' }, 'Ryan Williams', held)).toBeNull()
    expect(matchHeldDevy({ name: 'Arch Manning' }, 'Arch Manning', held)).toBeNull()
  })
})

const unpricedLine = (name: string): TradeConsolePlayerLine =>
  ({ name, playerId: null, sport: 'NFL', position: '—', team: '—', marketValue: 0, pricedSource: 'unknown', dataSource: 'fantasycalc+rolling', unpriced: true, unpricedReason: { code: 'no_value' } }) as unknown as TradeConsolePlayerLine
const pricedLine = (name: string, v: number): TradeConsolePlayerLine =>
  ({ name, playerId: null, sport: 'NFL', position: 'WR', team: 'CIN', marketValue: v, pricedSource: 'fantasycalc', dataSource: 'fantasycalc' }) as unknown as TradeConsolePlayerLine
const unpricedAsset = (name: string): PricedAsset => ({ name, type: 'player', value: 0, assetValue: { marketValue: 0, impactValue: 0, vorpValue: 0, volatility: 0 }, source: 'unknown', unpriced: true })
const fcAsset = (name: string, v: number): PricedAsset => ({ name, type: 'player', value: v, assetValue: { marketValue: v, impactValue: 0, vorpValue: 0, volatility: 0 }, source: 'fantasycalc' })

describe('applyDevyPricing — the chart’s misses, priced as prospects when this league holds them', () => {
  it('prices a held prospect with the measured option value, on the market scale', () => {
    const expected = devyOptionValue({ name: 'Jeremiah Smith', position: 'WR', ppaSeasonTotal: 60, recruitingComposite: 0.9999, recruitingStars: 5, draftEligibleYear: 2027, currentSeason: 2026 }).value
    expect(expected).toBeGreaterThan(0)
    const out = applyDevyPricing({
      inputs: [player('Ja’Marr Chase'), player('Jeremiah Smith')],
      lines: [pricedLine('Ja’Marr Chase', 9000), unpricedLine('Jeremiah Smith')],
      priced: [fcAsset('Ja’Marr Chase', 9000), unpricedAsset('Jeremiah Smith')],
      held,
      currentSeason: 2026,
    })
    expect(out.devyPriced).toBe(1)
    expect(out.priced[1]).toMatchObject({ source: 'devy-option', value: expected, assetValue: { marketValue: expected } })
    expect(out.priced[1]!.unpriced).toBeUndefined()
    expect(out.lines[1]).toMatchObject({ name: 'Jeremiah Smith', position: 'WR', marketValue: expected, dataSource: 'devy-option' })
    expect(out.lines[1]!.unpriced).toBeUndefined()
    // The chart-priced player is untouched.
    expect(out.priced[0]).toMatchObject({ source: 'fantasycalc', value: 9000 })
  })

  it('a prospect nothing measures stays unpriced, and says why — never zero', () => {
    const out = applyDevyPricing({ inputs: [player('Nobody Measured')], lines: [unpricedLine('Nobody Measured')], priced: [unpricedAsset('Nobody Measured')], held, currentSeason: 2026 })
    expect(out.devyPriced).toBe(0)
    expect(out.lines[0]!.unpriced).toBe(true)
    expect(out.unmeasured[0]).toMatch(/cannot be priced/)
  })

  it('an unpriced player this league does not hold is left alone', () => {
    const out = applyDevyPricing({ inputs: [player('Arch Manning')], lines: [unpricedLine('Arch Manning')], priced: [unpricedAsset('Arch Manning')], held, currentSeason: 2026 })
    expect(out.devyPriced).toBe(0)
    expect(out.lines[0]!.unpriced).toBe(true)
  })

  it('uses the stored id when the inputs line up, so a shared name still resolves', () => {
    const out = applyDevyPricing({ inputs: [player('Ryan Williams', { rosterPlayerId: 'd2' })], lines: [unpricedLine('Ryan Williams')], priced: [unpricedAsset('Ryan Williams')], held, currentSeason: 2026 })
    expect(out.lines[0]).toMatchObject({ position: 'WR', dataSource: 'devy-option' })
  })

  it('when a line was skipped the inputs do not line up — a row’s id is never applied to another row’s line', () => {
    // The first input was skipped by the pricer, so line 0 is Jeremiah Smith, not the input carrying id d3.
    const out = applyDevyPricing({
      inputs: [player('', { rosterPlayerId: 'd3' }), player('Jeremiah Smith')],
      lines: [unpricedLine('Jeremiah Smith')],
      priced: [unpricedAsset('Jeremiah Smith')],
      held,
      currentSeason: 2026,
    })
    expect(out.lines[0]).toMatchObject({ name: 'Jeremiah Smith', position: 'WR' })
  })
})
