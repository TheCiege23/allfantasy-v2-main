import { afterEach, describe, expect, it, vi } from 'vitest'
import { positionalDemand, resolveUserUtility, scoreComponents, sumEstimates, transformLeagueValue, validEstimate } from '@/lib/decision-os/value-v2/value'
import { evaluateMove, evaluateWaiverPair, bestOpenSlotUse } from '@/lib/decision-os/value-v2/moves'
import { confirmStrategy, observeStrategy, type StrategyState } from '@/lib/decision-os/value-v2/strategy'
import { canPromoteModel, scheduleRegrades, type ModelCandidate } from '@/lib/decision-os/value-v2/learning'
import { buildValueV2Shadow, valueV2ShadowEnabled } from '@/lib/decision-os/value-v2/shadow'
import type { Estimate, LeagueValueContext, MarketValueSnapshotV2, UtilityTerms } from '@/lib/decision-os/value-v2/types'
import { tradeConsoleMarketProfile } from '@/lib/trade-value-console/market-profile'
import { waiverPositionEligible } from '@/lib/waiver-engine/position-eligibility'

const asOf = '2026-09-09T00:00:00.000Z'
const est = (value: number): Estimate => ({ value, low: value, high: value, evidence: { source: 'fixture', asOf, sampleSize: 100 } })
const market: MarketValueSnapshotV2 = { version: '2.0', assetId: 'p1', kind: 'player', cohort: 'dynasty', capturedAt: asOf, marketValue: est(1000), liquidity: null, trend30d: null, gaps: [] }
const scoring = [{ stat: 'rec', points: 1 }]
const slots = [{ id: 'TE', count: 1, eligiblePositions: ['TE'] }]
const league: LeagueValueContext = { leagueId: 'L', cohort: 'dynasty', teamCount: 12, referenceTeamCount: 12, scoring, referenceScoring: scoring, slots, referenceSlots: slots }
const transformed = () => transformLeagueValue({ market, league, position: 'TE', components: { rec: 50 } })
const terms = (lineup: number): UtilityTerms => ({ lineup: est(lineup), playoffOrSurvival: est(0), horizon: { 1: est(0), 3: est(30), 5: est(50) }, rosterOption: est(0), riskCost: est(0) })
afterEach(() => vi.unstubAllEnvs())

describe('Value V2 invariants', () => {
  it.each([false, true])('uses authenticated dynasty=%s for market selection', isDynasty => {
    expect(tradeConsoleMarketProfile({ isDynasty }, 14, true, 0.5)).toEqual({ isDynasty, numTeams: 14, numQbs: 2, ppr: 0.5 })
  })
  it('preserves the global default only when no league is selected', () => {
    expect(tradeConsoleMarketProfile(null, 12, false, 0).isDynasty).toBe(true)
  })
  it.each([0.5, 0.75, 1])('applies exact TEP %s once and only to TE', bonus => {
    const rules = [...scoring, { stat: 'rec', points: bonus, positions: ['TE'] }]
    expect(scoreComponents('WR', { rec: 50 }, rules)).toBe(50)
    const value = transformLeagueValue({ market, league: { ...league, scoring: rules }, position: 'TE', components: { rec: 50 } })
    expect(value.leagueValue?.value).toBe(1000 * (1 + bonus))
    expect(value.market.marketValue?.value).toBe(1000)
  })
  it('refuses missing scoring components and unrelated cohort prices', () => {
    expect(scoreComponents('TE', {}, scoring)).toBeNull()
    expect(transformLeagueValue({ market, league: { ...league, cohort: 'redraft' }, position: 'TE', components: { rec: 50 } }).leagueValue).toBeNull()
    expect(transformLeagueValue({ market: { ...market, marketValue: null }, league, position: 'TE', components: { rec: 50 } }).leagueValue).toBeNull()
  })
  it('supports component-based IDP, kicker distance, first down and bonus scoring', () => {
    expect(scoreComponents('LB', { tackles: 5, sacks: 2 }, [{ stat: 'tackles', points: 2, positions: ['LB'] }, { stat: 'sacks', points: 4 }])).toBe(18)
    expect(scoreComponents('K', { fg50: 2, fg30: 1 }, [{ stat: 'fg50', points: 5 }, { stat: 'fg30', points: 3 }])).toBe(13)
    expect(scoreComponents('WR', { firstDown: 4, bonus100: 1 }, [{ stat: 'firstDown', points: 0.5 }, { stat: 'bonus100', points: 3 }])).toBe(5)
  })
  it('more QB slots never decrease QB demand, including flex', () => {
    const qb = [{ id: 'QB', count: 1, eligiblePositions: ['QB'] }]
    const base = positionalDemand('QB', qb, 12)!
    expect(positionalDemand('QB', [...qb, { id: 'SF', count: 1, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] }], 12)).toBeGreaterThan(base)
    expect(positionalDemand('QB', [{ ...qb[0], count: 3 }], 12)).toBe(base * 3)
  })
  it('two managers get distinct utility with identical market value', () => {
    const a = resolveUserUtility(transformed(), 'A', terms(100))
    const b = resolveUserUtility(transformed(), 'B', terms(0))
    expect(a.marketValue).toEqual(b.marketValue)
    expect(a.userUtility[1]!.value - b.userUtility[1]!.value).toBe(100)
    expect(a.userUtility[5]!.value).toBe(1150)
    expect(resolveUserUtility(transformed(), 'A', { ...terms(0), lineup: null }).userUtility[1]).toBeNull()
  })
  it('keeps unknown values and unknown bounds separate from evidence-backed zero', () => {
    expect(validEstimate(est(0))).toBe(true)
    expect(validEstimate(est(NaN))).toBe(false)
    expect(sumEstimates([{ estimate: { ...est(5), low: null }, sign: -1 }], 'test', asOf)?.high).toBeNull()
    expect(sumEstimates([{ estimate: null, sign: 1 }], 'test', asOf)).toBeNull()
  })
  it('never grades a package containing an unpriced specialty asset as complete', () => {
    const result = evaluateMove({ decisionId: 'D', leagueId: 'L', capturedAt: asOf, horizon: 1, costsByUser: {}, movements: [
      { assetId: 'p', from: 'A', to: 'B', marketValue: est(1000), valuesByUser: {} },
      { assetId: 'devy', from: 'B', to: 'A', marketValue: null, valuesByUser: {} },
    ] })
    expect(result.marketComplete).toBe(false)
    expect(result.unpricedAssetIds).toEqual(['devy'])
    expect(result.participants.every(p => p.marketDelta === null && p.recommendation === 'insufficient_data')).toBe(true)
  })
  it('conserves market value across three-team trades', () => {
    const r = evaluateMove({ decisionId: 'D', leagueId: 'L', capturedAt: asOf, horizon: 1, costsByUser: {}, movements: [
      { assetId: 'a', from: 'A', to: 'B', marketValue: est(100), valuesByUser: {} },
      { assetId: 'b', from: 'B', to: 'C', marketValue: est(200), valuesByUser: {} },
      { assetId: 'c', from: 'C', to: 'A', marketValue: est(300), valuesByUser: {} },
    ] })
    expect(r.participants.reduce((s, p) => s + p.marketDelta!.value, 0)).toBe(0)
    expect(r.participants).toHaveLength(3)
  })
  it('subtracts drop and resource opportunity costs, and chooses only feasible slot uses', () => {
    expect(evaluateWaiverPair(est(100), est(80), est(30), asOf)?.value).toBe(-10)
    expect(evaluateWaiverPair(est(100), null, est(30), asOf)).toBeNull()
    expect(bestOpenSlotUse([{ assetId: 'locked', feasible: false, netUtility: est(999) }, { assetId: 'free', feasible: true, netUtility: est(20) }])?.assetId).toBe('free')
  })
  it.each(['K', 'LB', 'DL', 'DB', 'DE', 'DT', 'CB', 'S', 'EDGE', 'DEF', 'DST'])('requires roster eligibility for %s', position => {
    expect(waiverPositionEligible(position, ['QB', 'RB', 'WR', 'TE'])).toBe(false)
    expect(waiverPositionEligible(position, [position])).toBe(true)
  })
  it('recognizes grouped IDP and defense aliases without enabling K in IDP flex', () => {
    expect(waiverPositionEligible('EDGE', ['IDP_FLEX'])).toBe(true)
    expect(waiverPositionEligible('CB', ['DB'])).toBe(true)
    expect(waiverPositionEligible('DST', ['DEF'])).toBe(true)
    expect(waiverPositionEligible('K', ['IDP_FLEX'])).toBe(false)
  })
  it('keeps shadow disabled by default and preserves explicit missing-data gaps', () => {
    vi.stubEnv('DECISION_OS_VALUE_V2_SHADOW_ENABLED', '')
    expect(valueV2ShadowEnabled()).toBe(false)
    vi.stubEnv('DECISION_OS_VALUE_V2_SHADOW_ENABLED', 'true')
    expect(valueV2ShadowEnabled()).toBe(true)
    expect(buildValueV2Shadow([], { sport: 'NFL', leagueType: 'redraft', scoring: 'ppr', rosterFormat: 'standard', capturedAt: asOf }).marketComplete).toBe(false)
  })
})

describe('Strategy confirmation and learning gates', () => {
  it('requires three distinct consecutive weeks and explicit confirmation', () => {
    let s: StrategyState = { active: 'win-now', revision: 0, pending: null }
    s = observeStrategy(s, { strategy: 'rebuild', week: 1, evidenceId: 'a', materialChange: true })
    expect(() => confirmStrategy(s, 0, 'rebuild')).toThrow()
    const duplicate = observeStrategy(s, { strategy: 'rebuild', week: 1, evidenceId: 'b', materialChange: true })
    expect(duplicate.pending?.observations).toBe(1)
    for (const week of [2, 3]) s = observeStrategy(s, { strategy: 'rebuild', week, evidenceId: String(week), materialChange: true })
    expect(s.active).toBe('win-now')
    expect(confirmStrategy(s, 0, 'rebuild')).toEqual({ active: 'rebuild', revision: 1, pending: null })
    expect(() => confirmStrategy(s, 1, 'rebuild')).toThrow('revision')
  })
  it('resets persistence after a gap', () => {
    let s: StrategyState = { active: 'balanced', revision: 0, pending: null }
    for (const week of [1, 4]) s = observeStrategy(s, { strategy: 'rebuild', week, evidenceId: String(week), materialChange: true })
    expect(s.pending?.observations).toBe(1)
  })
  it('schedules all five horizons idempotently with leap-year handling', () => {
    const tasks = scheduleRegrades('D', '2024-02-29T12:00:00Z', '2024-12-31T00:00:00Z')
    expect(tasks).toHaveLength(5)
    expect(tasks.find(t => t.horizon === '1y')?.dueAt).toBe('2025-02-28T12:00:00.000Z')
    expect(new Set(tasks.map(t => t.key)).size).toBe(5)
    expect(scheduleRegrades('D', '2024-02-29T12:00:00Z', '2024-12-31T00:00:00Z')).toEqual(tasks)
  })
  it('requires out-of-time validation, sample coverage, better loss and rollback', () => {
    const m: ModelCandidate = { version: '2', rollbackVersion: '1', cohort: 'NFL/SF', sampleSize: 1000,
      trainingStart: '2024-01-01', trainingEnd: '2024-12-31', validationStart: '2025-01-01', validationEnd: '2025-12-31',
      metric: 'value_mae', validationLoss: 10, baselineLoss: 12, invariantsPassed: true }
    expect(canPromoteModel(m, 100)).toBe(true)
    expect(canPromoteModel({ ...m, validationStart: '2024-06-01' }, 100)).toBe(false)
    expect(canPromoteModel({ ...m, rollbackVersion: '' }, 100)).toBe(false)
    expect(canPromoteModel({ ...m, validationLoss: 13 }, 100)).toBe(false)
  })
})
