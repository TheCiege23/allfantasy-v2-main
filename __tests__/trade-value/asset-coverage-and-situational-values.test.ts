import { describe, expect, it } from 'vitest'
import { assessTradeAssetCoverage } from '@/lib/trade-value/assetCoverage'
import { situationalFaabValue } from '@/lib/trade-value/faabValue'
import { normalizedPickValue } from '@/lib/trade-value/valueEngine'
import { projectPickSlotDistribution } from '@/lib/trade-intel/pickOutlook'

describe('trade asset coverage gate', () => {
  it('blocks a plausible grade when a devy asset has no supported value model', () => {
    const coverage = assessTradeAssetCoverage([
      {
        kind: 'future_consideration', canonicalAssetType: 'devy', fromRosterId: 'a', toRosterId: 'b',
        playerId: 'college-1', playerName: 'College Prospect', sources: {
          projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null, idpValue: null,
        }, internalValue: 0,
      },
    ])
    expect(coverage.status).toBe('blocked')
    expect(coverage.items[0]?.assetClass).toBe('college_devy')
    expect(coverage.coveragePct).toBe(0)
  })

  it('recognizes supported offensive, IDP, kicker, pick, and FAAB assets', () => {
    const source = { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null, idpValue: null }
    const coverage = assessTradeAssetCoverage([
      { kind: 'player', fromRosterId: 'a', toRosterId: 'b', playerId: 'o', position: 'WR', sources: { ...source, fantasyCalcValue: 4000 }, valuationBasis: 'market', internalValue: 4000 },
      { kind: 'player', fromRosterId: 'b', toRosterId: 'a', playerId: 'd', position: 'LB', sources: { ...source, idpValue: 2600 }, valuationBasis: 'idp', internalValue: 2600 },
      { kind: 'player', fromRosterId: 'a', toRosterId: 'b', playerId: 'k', position: 'K', sources: { ...source, projectionValue: 90 }, valuationBasis: 'projection', internalValue: 1287 },
      { kind: 'draft_pick', fromRosterId: 'b', toRosterId: 'a', pickRound: 1, pickLabel: '2027 1st', sources: source, internalValue: 2200 },
      { kind: 'faab', fromRosterId: 'b', toRosterId: 'a', faabAmount: 10, sources: source, internalValue: 180 },
    ])
    expect(coverage.status).toBe('complete')
    expect(coverage.coveragePct).toBe(100)
  })
})

describe('probabilistic pick value', () => {
  it('prices likely-early picks above likely-late picks and fades distant certainty', () => {
    const early = projectPickSlotDistribution({ season: 2027, round: 1, currentSeason: 2026, senderRank: 12, teamCount: 12 })
    const late = projectPickSlotDistribution({ season: 2027, round: 1, currentSeason: 2026, senderRank: 1, teamCount: 12 })
    expect(early.early).toBeGreaterThan(early.late)
    expect(late.late).toBeGreaterThan(late.early)
    expect(normalizedPickValue({ round: 1, teams: 12, slotProbability: early })).toBeGreaterThan(
      normalizedPickValue({ round: 1, teams: 12, slotProbability: late }),
    )

    const distant = projectPickSlotDistribution({ season: 2030, round: 1, currentSeason: 2026, senderRank: 12, teamCount: 12 })
    expect(distant.confidence).toBe(0)
    expect(distant.middle).toBeGreaterThan(distant.early)
  })
})

describe('situational FAAB value', () => {
  it('preserves the old baseline and applies only sourced context', () => {
    expect(situationalFaabValue({ amount: 10, originalBudget: 100 }).value).toBe(180)
    const useful = situationalFaabValue({
      amount: 10,
      originalBudget: 100,
      receiverRemaining: 35,
      opponentRemaining: [5, 10, 20, 25],
      currentWeek: 2,
      regularSeasonWeeks: 14,
      waiverPoolStrength: 1,
      rollover: true,
    })
    expect(useful.value).toBeGreaterThan(180)
    expect(useful.basis).toContain('remaining-budget leverage')
  })
})
