import { describe, it, expect, vi } from 'vitest'
import { buildTradeAnalyzerIntelPrompt, type TradeAnalyzerIntelDeps } from '@/lib/trade-engine/trade-analyzer-intel'
import type { TradeDecisionContextV1 } from '@/lib/trade-engine/trade-decision-context'

function makeCtx(numTeams: number): TradeDecisionContextV1 {
  return {
    version: '1.0.0',
    assembledAt: new Date().toISOString(),
    contextId: 'ctx-test',
    leagueConfig: {
      leagueId: '123',
      name: 'Test League',
      platform: 'sleeper',
      scoringType: 'PPR',
      numTeams,
      isSF: true,
      isTEP: false,
      tepBonus: 0,
      rosterPositions: ['QB', 'RB', 'WR', 'TE', 'FLEX'],
      starterSlots: 8,
      benchSlots: 6,
      taxiSlots: 0,
      scoringSettings: {},
    },
    sideA: {
      teamId: 'A',
      teamName: 'Team A',
      assets: [
        {
          name: 'Justin Jefferson', type: 'PLAYER', position: 'WR', age: 25, team: 'MIN',
          marketValue: 9000, impactValue: 8000, vorpValue: 7000, volatility: 0.1,
          valuationSource: { source: 'fantasycalc', valuedAt: new Date().toISOString() },
          adp: null, isCornerstone: true, cornerstoneReason: 'elite'
        }
      ],
      totalValue: 9000,
      riskMarkers: [],
      rosterComposition: { size: 25, pickCount: 3, youngAssetCount: 10, starterStrengthIndex: 75 },
      needs: ['RB'], surplus: ['WR'], contenderTier: 'contender', managerPreferences: null,
    },
    sideB: {
      teamId: 'B',
      teamName: 'Team B',
      assets: [
        {
          name: 'Bijan Robinson', type: 'PLAYER', position: 'RB', age: 22, team: 'ATL',
          marketValue: 8500, impactValue: 7800, vorpValue: 6900, volatility: 0.12,
          valuationSource: { source: 'fantasycalc', valuedAt: new Date().toISOString() },
          adp: null, isCornerstone: true, cornerstoneReason: 'elite'
        }
      ],
      totalValue: 8500,
      riskMarkers: [],
      rosterComposition: { size: 25, pickCount: 4, youngAssetCount: 11, starterStrengthIndex: 72 },
      needs: ['WR'], surplus: ['RB'], contenderTier: 'middle', managerPreferences: null,
    },
    competitors: [],
    valueDelta: { absoluteDiff: 500, percentageDiff: 6, favoredSide: 'A' },
    tradeHistoryStats: { totalTrades: 10, recentTrades: 3, recencyWindowDays: 30, avgValueDelta: 0, leagueTradeFrequency: 'medium', computedAt: new Date().toISOString() },
    missingData: {
      valuationsMissing: [], adpMissing: [], analyticsMissing: [],
      injuryDataStale: false, valuationDataStale: false, adpDataStale: false, analyticsDataStale: false, tradeHistoryStale: false,
      managerTendenciesUnavailable: [], competitorDataUnavailable: false, tradeHistoryInsufficient: false,
    },
    dataQuality: { assetsCovered: 2, assetsTotal: 2, coveragePercent: 100, adpHitRate: 100, injuryDataAvailable: true, analyticsAvailable: true, warnings: [] },
    dataSources: {
      valuationFetchedAt: new Date().toISOString(), adpFetchedAt: null, injuryFetchedAt: null, analyticsFetchedAt: null, rostersFetchedAt: null, tradeHistoryFetchedAt: null,
    },
  }
}

/*
 * ⚠ THE DEP WAS RENAMED IN THE PRODUCTION CONTRACT AND THE FAKE WAS NOT.
 * `TradeAnalyzerIntelDeps` declares `getFantasyCalcValuesDbFirst` (the db-first
 * reader); this file still supplied `fetchFantasyCalcValues`, so the key never
 * matched and the call landed on undefined — "deps.getFantasyCalcValuesDbFirst
 * is not a function". Same settings argument, same FantasyCalcPlayer[] return,
 * so only the name moved.
 */
describe('buildTradeAnalyzerIntelPrompt', () => {
  it('builds prompt with external sections', async () => {
    const deps: TradeAnalyzerIntelDeps = {
      fetchNewsContext: vi.fn().mockResolvedValue({ items: [{ id: 'n1', title: 'Player X expected to start', source: 'NewsAPI', url: null, team: 'MIN', publishedAt: '2026-02-01T00:00:00Z', isInjury: false, relevance: 'direct' }], fetchedAt: '2026-02-01T00:00:00Z', sources: ['newsapi'], playerHits: 1, teamHits: 0 }),
      fetchRollingInsights: vi.fn().mockResolvedValue({ players: [{ playerId: '1', name: 'Justin Jefferson', team: 'MIN', position: 'WR', status: 'active', age: null, fantasyPointsPerGame: 18.7, gamesPlayed: 17, seasonStats: null }], teams: [], fetchedAt: '2026-02-01T00:00:00Z', source: 'db_cache' }),
      getFantasyCalcValuesDbFirst: vi.fn().mockResolvedValue([{ player: { id: 1, name: 'Justin Jefferson', mflId: '', sleeperId: '', position: 'WR', maybeBirthday: null, maybeHeight: null, maybeWeight: null, maybeCollege: null, maybeTeam: 'MIN', maybeAge: 25, maybeYoe: null }, value: 10000, overallRank: 1, positionRank: 1, trend30Day: 50, redraftDynastyValueDifference: 0, redraftDynastyValuePercDifference: 0, redraftValue: 0, combinedValue: 0, maybeMovingStandardDeviation: null, maybeMovingAverage: null }]),
      findPlayerByName: vi.fn((players, name) => players.find((p: any) => p.player.name === name) || null),
      findLatestRookieClass: vi.fn().mockResolvedValue({ year: 2026, strength: 0.88, qbDepth: 0.7, rbDepth: 0.9, wrDepth: 0.92, teDepth: 0.61, updatedAt: new Date() }),
      findTopRookieRankings: vi.fn().mockResolvedValue([{ id: '1', year: 2026, name: 'Rookie One', position: 'WR', team: 'MIN', rank: 1, dynastyValue: 7000, college: 'X', createdAt: new Date(), updatedAt: new Date() }]),
      findKtcCache: vi.fn().mockResolvedValue({ key: 'ktc-dynasty-rankings', data: [{ name: 'Justin Jefferson', value: 9999, rank: 1 }], expiresAt: new Date(), createdAt: new Date() }),
    }

    const out = await buildTradeAnalyzerIntelPrompt(makeCtx(12), deps)
    expect(out).toContain('EXTERNAL TRADE INTELLIGENCE LAYER')
    expect(out).toContain('News: 1 items')
    expect(out).toContain('FantasyCalc matches:')
    expect(out).toContain('Rookie Class 2026')
    expect(out).toContain('KTC matches:')
  })

  it('falls back to 12-team fantasycalc settings when league size unsupported', async () => {
    const deps: TradeAnalyzerIntelDeps = {
      fetchNewsContext: vi.fn().mockResolvedValue({ items: [], fetchedAt: new Date().toISOString(), sources: [], playerHits: 0, teamHits: 0 }),
      fetchRollingInsights: vi.fn().mockResolvedValue({ players: [], teams: [], fetchedAt: new Date().toISOString(), source: 'db_cache' }),
      getFantasyCalcValuesDbFirst: vi.fn().mockResolvedValue([]),
      findPlayerByName: vi.fn().mockReturnValue(null),
      findLatestRookieClass: vi.fn().mockResolvedValue(null),
      findTopRookieRankings: vi.fn().mockResolvedValue([]),
      findKtcCache: vi.fn().mockResolvedValue(null),
    }

    await buildTradeAnalyzerIntelPrompt(makeCtx(13), deps)

    expect(deps.getFantasyCalcValuesDbFirst).toHaveBeenCalledWith(
      expect.objectContaining({ numTeams: 12 })
    )
  })
})
