import { afterEach, expect, it, vi } from 'vitest'
import { buildTradeValueSnapshot, type EnrichedTradeAsset } from '@/lib/trade-value/snapshot'
import { scoreWaiverCandidates, type WaiverScoringContext } from '@/lib/waiver-engine/waiver-scoring'
import { buildConsoleValueV2Shadow } from '@/lib/decision-os/value-v2/consoleShadow'
import type { MarketObservationV2 } from '@/lib/decision-os/value-v2/market'

afterEach(() => vi.unstubAllEnvs())
const observation = (assetId: string, value: number): MarketObservationV2 => ({ assetId, value, source: 'fixture', observedAt: '2026-09-08T22:00:00Z', timestampResolution: 'instant',
  cohort: { sport: 'NFL', format: 'redraft', numQbs: 2, numTeams: 14, ppr: 0.5 }, liquidity: 0.01, trend30d: 20, standardDeviation: 50, sampleSize: null })
const asset = (from: string, to: string, kind: EnrichedTradeAsset['kind'] = 'player'): EnrichedTradeAsset => ({
  kind, fromRosterId: from, toRosterId: to, playerId: from, position: 'WR',
  sources: { fantasyCalcValue: kind === 'player' ? 5000 : null, projectionValue: null, rankingValue: null, adpValue: null, idpValue: null,
    marketObservation: kind === 'player' ? observation(from, 5000) : null },
})
const context = { sport: 'NFL', leagueType: 'redraft', scoring: 'ppr', rosterFormat: 'standard', capturedAt: '2026-09-09T00:00:00Z' }
it('keeps derived IDP and FAAB prices out of the console market snapshot', () => {
  const value = { marketValue: 1000, impactValue: 1000, vorpValue: 500, volatility: 0.1 }
  const result = buildConsoleValueV2Shadow({
    give: [{ name: 'WR', type: 'player', value: 1000, assetValue: value, source: 'fantasycalc', position: 'WR' }],
    get: [{ name: 'LB', type: 'player', value: 1000, assetValue: value, source: 'idp-vorp', position: 'LB' }],
    sport: 'NFL', isDynasty: false, ppr: 0.5, numTeams: 14, isSuperFlex: true, capturedAt: context.capturedAt,
    givePlayerIds: ['wr1'], getPlayerIds: ['lb1'], observationsByPlayerId: new Map([['wr1', observation('wr1', 1000)]]),
  })
  expect(result.assets[0].marketValue?.value).toBe(1000)
  expect(result.assets[1].marketValue).toBeNull()
  expect(result.marketComplete).toBe(false)
  expect(result.assets[0].cohort).toContain('redraft')
  expect(result.assets[0].marketValue?.evidence.asOf).toBe('2026-09-08T22:00:00Z')
})
it('captures V2 in the shared snapshot only when enabled, without changing supported V1 values', () => {
  const input = { proposerRosterId: 'A', receiverRosterId: 'B', assets: [asset('A', 'B'), asset('B', 'A')], context }
  vi.stubEnv('DECISION_OS_VALUE_V2_SHADOW_ENABLED', '')
  const baseline = buildTradeValueSnapshot(input)
  expect(baseline.valueV2Shadow).toBeUndefined()
  vi.stubEnv('DECISION_OS_VALUE_V2_SHADOW_ENABLED', 'true')
  const shadow = buildTradeValueSnapshot(input)
  expect(shadow.sides).toEqual(baseline.sides)
  expect(shadow.grade).toEqual(baseline.grade)
  expect(shadow.valueV2Shadow?.marketComplete).toBe(true)
})
it('refuses the full grade for future considerations mixed with priced players', () => {
  const snapshot = buildTradeValueSnapshot({ proposerRosterId: 'A', receiverRosterId: 'B', context,
    assets: [asset('A', 'B'), asset('B', 'A'), asset('A', 'B', 'future_consideration')] })
  expect(snapshot.grade.insufficientData).toBe(true)
  expect(snapshot.grade.grade).toBeNull()
  expect(snapshot.grade.fairnessScore).toBeNull()
  expect(snapshot.commissionerReview.reviewRecommended).toBe(true)
})
it('refuses unpriced players rather than counting ADP-only output as evidence', () => {
  const missing = asset('B', 'A')
  missing.sources.fantasyCalcValue = null
  missing.sources.adpValue = 20
  const snapshot = buildTradeValueSnapshot({ proposerRosterId: 'A', receiverRosterId: 'B', context, assets: [asset('A', 'B'), missing] })
  expect(snapshot.grade.grade).toBeNull()
})
it('scores K and grouped IDP candidates only for matching leagues and rejects non-finite values', () => {
  const ctx: WaiverScoringContext = { goal: 'balanced', needs: [], surplus: [], isSF: false, isTEP: false, numTeams: 12,
    isDynasty: false, rosterPlayers: [], currentWeek: 1, rosterPositions: ['K', 'IDP_FLEX'],
    teamNeeds: { weakestSlots: [], biggestNeed: null, byeWeekClusters: [], positionalDepth: [], dropCandidates: [] } }
  const candidates = ['K', 'LB', 'EDGE', 'WR'].map(position => ({ playerId: position, playerName: position, position, team: null, age: 25,
    value: 1000, source: 'league', assetValue: { marketValue: 1000, impactValue: 1000, vorpValue: 500, volatility: 0.1 } }))
  expect(scoreWaiverCandidates(candidates, ctx).map(p => p.position)).toEqual(expect.arrayContaining(['K', 'LB', 'EDGE']))
  expect(scoreWaiverCandidates(candidates, { ...ctx, rosterPositions: ['WR'] }).map(p => p.position)).toEqual(['WR'])
  expect(scoreWaiverCandidates([{ ...candidates[0], value: NaN }], ctx)).toEqual([])
})
