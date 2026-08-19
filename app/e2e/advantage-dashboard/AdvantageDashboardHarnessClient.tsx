'use client'

import { useEffect, useState } from 'react'
import AdvantageDashboardPage, {
  type AdvantageCoachLoader,
  type AdvantageGlobalLoader,
  type AdvantagePowerLoader,
  type AdvantageSimulationPreview,
  type AdvantageSimulationLoader,
} from '@/components/advantage-dashboard/AdvantageDashboardPage'
import type { CoachEvaluationResult } from '@/lib/fantasy-coach/types'
import type { GlobalFantasyInsights } from '@/lib/global-fantasy-intelligence'
import type { PlatformPowerLeaderboardResult } from '@/lib/platform-power-rankings'

const SPORT_TREND_PLAYERS: Record<string, { name: string; team: string; position: string }> = {
  NFL: { name: 'Sky Moore', team: 'KC', position: 'WR' },
  NBA: { name: 'Jalen Johnson', team: 'ATL', position: 'F' },
  MLB: { name: 'Riley Greene', team: 'DET', position: 'OF' },
  NHL: { name: 'Matt Boldy', team: 'MIN', position: 'W' },
  NCAAB: { name: 'Terrence Edwards', team: 'Louisville', position: 'G' },
  NCAAF: { name: 'Nyck Harbor', team: 'South Carolina', position: 'WR' },
  SOCCER: { name: 'Cole Palmer', team: 'Chelsea', position: 'MID' },
}

const SPORT_LEADERS: Record<string, string> = {
  NFL: 'Alpha Gridiron',
  NBA: 'Paint Dominator',
  MLB: 'Box Score Baron',
  NHL: 'Blue Line Boss',
  NCAAB: 'Bracket Brain',
  NCAAF: 'Saturday Signal',
  SOCCER: 'Pitch General',
}

const loadGlobalInsights: AdvantageGlobalLoader = async ({
  sport,
  teamName,
  week,
}): Promise<GlobalFantasyInsights> => {
  const trendPlayer = SPORT_TREND_PLAYERS[sport] ?? SPORT_TREND_PLAYERS.NFL
  const generatedAt = '2026-03-27T10:00:00.000Z'

  return {
    trend: {
      items: [
        {
          trendType: 'breakout_candidate',
          playerId: `${sport.toLowerCase()}-trend-player`,
          sport,
          displayName: trendPlayer.name,
          position: trendPlayer.position,
          team: trendPlayer.team,
          signals: {
            performanceDelta: 8.2,
            usageChange: 0.15,
            minutesOrSnapShare: 0.81,
            efficiencyScore: 79,
            volumeChange: 0.12,
            efficiencyDelta: 6.1,
            confidence: 0.84,
            signalStrength: 86,
          },
          snapshot: {
            dataSource: 'game_stats',
            recentGamesSample: 4,
            priorGamesSample: 4,
            recentFantasyPointsAvg: 19.2,
            priorFantasyPointsAvg: 12.8,
            recentUsageValue: 0.29,
            priorUsageValue: 0.2,
            recentMinutesOrShare: 0.81,
            priorMinutesOrShare: 0.67,
            recentEfficiency: 79,
            priorEfficiency: 69,
            expectedFantasyPointsPerGame: 16.1,
            seasonFantasyPointsPerGame: 14.6,
            expectedGap: 3.5,
            weeklyVolatility: 2.4,
            breakoutRating: 0.74,
            currentAdpTrend: -1.6,
          },
          summary: {
            headline: `${trendPlayer.name} is forcing a bigger role`,
            rationale: 'Recent usage and efficiency both cleared the prior window.',
            recommendation: 'Move early before this role change is fully priced in.',
          },
          trendScore: 83,
          direction: 'Rising',
          updatedAt: generatedAt,
        },
      ],
      sport,
      generatedAt,
      trendTypeCounts: {
        hot_streak: 1,
        cold_streak: 0,
        breakout_candidate: 2,
        sell_high_candidate: 1,
      },
      averageSignalStrength: 82.6,
      strongestSignal: {
        playerId: `${sport.toLowerCase()}-trend-player`,
        displayName: trendPlayer.name,
        position: trendPlayer.position,
        team: trendPlayer.team,
        trendType: 'breakout_candidate',
        signalStrength: 86,
        recommendation: 'Move early before this role change is fully priced in.',
      },
    },
    meta: {
      draftStrategyShifts: [],
      positionValueChanges: [],
      waiverStrategyTrends: [],
      overviewCards: [],
      headlines: [],
      sourceCoverage: null,
      sport,
      generatedAt,
      averageConfidence: 0.81,
      topHeadline: null,
    },
    dynasty: {
      projections: [],
      leagueId: null,
      sport,
      generatedAt,
      contenderCount: 0,
      rebuildCount: 0,
      averageAgingRiskScore: null,
      averageFutureAssetScore: null,
      topWindowTeamId: null,
      topWindowScore: null,
      topFutureAssetTeamId: null,
    },
    simulation: {
      matchupSimulations: [],
      seasonSimulations: [],
      leagueId: null,
      season: 2026,
      weekOrPeriod: week,
      generatedAt,
      topMatchupEdgeTeamId: null,
      topMatchupWinProbability: null,
      topPlayoffOddsTeamId: null,
      topPlayoffProbability: null,
      averageMatchupEdge: null,
      averageExpectedMargin: null,
      averagePlayoffProbability: null,
    },
    sport,
    leagueId: null,
    season: 2026,
    weekOrPeriod: week,
    summary: `${sport} advantage pulse: ${trendPlayer.name} is the clearest trend riser, ${teamName} has one coach-priority fix before lock, and the dashboard is lining up your next tool jump.`,
    overviewCards: [
      {
        id: 'sources',
        label: 'Sources online',
        value: '4/4',
        detail: 'Trend, coach, rankings, and simulation are all feeding the dashboard.',
        tone: 'positive',
      },
      {
        id: 'signal',
        label: 'Trend heat',
        value: '83',
        detail: 'Breakout pressure is outrunning the baseline for this sport.',
        tone: 'positive',
      },
    ],
    headlines: [
      {
        id: 'headline-1',
        category: 'trend',
        title: `${trendPlayer.name} is the strongest skill-position signal`,
        summary: 'Usage expansion and better efficiency are both showing up in the recent window.',
        confidence: 0.84,
        priority: 'high',
        relatedEntity: trendPlayer.name,
      },
      {
        id: 'headline-2',
        category: 'cross_system',
        title: `${teamName} has one clear weekly lever`,
        summary: 'Coach guidance and trend pressure agree that one quick move can raise the weekly floor.',
        confidence: 0.79,
        priority: 'medium',
        relatedEntity: teamName,
      },
      {
        id: 'headline-3',
        category: 'simulation',
        title: 'Simulation lane is stable enough to trust the favorite',
        summary: 'The current deterministic preview is not a coin flip, so a direct lineup plan makes sense.',
        confidence: 0.76,
        priority: 'medium',
        relatedEntity: null,
      },
    ],
    actionItems: [
      {
        id: 'trend-action',
        category: 'trend',
        priority: 'high',
        title: 'Open the trend feed',
        recommendation: `Investigate ${trendPlayer.name} while the signal remains underpriced.`,
        rationale: 'The dashboard is already showing a breakout classification with strong confidence.',
        relatedEntity: trendPlayer.name,
      },
    ],
    systemScores: {
      trendHeat: 83,
      metaVolatility: 61,
      dynastyLeverage: 52,
      simulationConfidence: 74,
      opportunityIndex: 78,
      riskIndex: 34,
    },
    sourceStatus: {
      trend: 'ready',
      meta: 'ready',
      dynasty: 'unavailable',
      simulation: 'unavailable',
      availableSources: 3,
      errorCount: 0,
      hasLeagueContext: false,
    },
    generatedAt,
  }
}

const loadCoachEvaluation: AdvantageCoachLoader = async ({
  sport,
  teamName,
  week,
}): Promise<CoachEvaluationResult> => {
  return {
    sport,
    rosterStrengths: [
      `${teamName} has enough top-end scoring to win this week if the floor holds.`,
      'The strongest room is still producing above neutral expectation.',
    ],
    rosterWeaknesses: [
      'One thin position group is absorbing too much downside.',
      'Bench insulation is weaker than the top contenders.',
    ],
    waiverOpportunities: [
      {
        playerName: 'Harness Flex Booster',
        position: sport === 'SOCCER' ? 'MID' : 'FLEX',
        reason: 'This is the cleanest short-term patch for the weakest room.',
        priority: 'high',
        playerHref: '/player-comparison?player=Harness%20Flex%20Booster&e2e=1',
      },
    ],
    tradeSuggestions: [
      {
        summary: 'Convert one excess depth piece into a steadier weekly starter.',
        tradeAnalyzerHref: '/trade-evaluator?source=advantage-dashboard&e2e=1',
        targetHint: 'Model a 2-for-1 package first.',
        priority: 'high',
      },
    ],
    lineupImprovements: [
      'Break ties toward the higher-floor starter.',
      'Use the swing slot for ceiling only if you are chasing.',
    ],
    actionRecommendations: [
      {
        id: 'waiver',
        type: 'waiver',
        label: 'Open Waiver AI',
        summary: 'Patch the weakest room before lock and protect the weekly floor.',
        priority: 'high',
        toolHref: '/waiver-ai?source=advantage-dashboard&e2e=1',
      },
      {
        id: 'trade',
        type: 'trade',
        label: 'Open Trade Evaluator',
        summary: 'Test a depth-for-stability construction while leverage is available.',
        priority: 'medium',
        toolHref: '/trade-evaluator?source=advantage-dashboard&e2e=1',
      },
    ],
    evaluationMetrics: [
      {
        id: 'floor',
        label: 'Starter floor',
        score: 74,
        trend: 'up',
        summary: 'The weekly floor is usable but still one move away from comfort.',
      },
      {
        id: 'leverage',
        label: 'Trade leverage',
        score: 69,
        trend: 'steady',
        summary: 'There is enough surplus to chase a cleaner weekly starter.',
      },
    ],
    teamSummary: `${teamName} can win Week ${week}, but one weak room is keeping the projection band from matching the top-end profile.`,
    teamSnapshot: {
      presetId: 'advantage-harness',
      presetName: 'Harness Rotation',
      teamName,
      week,
      adjustedProjection: 128.6,
      adjustedFloor: 114.4,
      adjustedCeiling: 141.1,
      scheduleAdjustment: 2.4,
      strongestSlot: sport === 'SOCCER' ? 'MID' : 'WR',
      weakestSlot: sport === 'SOCCER' ? 'DEF' : 'TE',
      swingSlot: sport === 'SOCCER' ? 'FWD' : 'FLEX',
    },
    providerInsights: {
      deepseek:
        'The math says the roster is competitive, but one weak room still consumes too much downside.',
      grok:
        'This is the kind of team that can win now if you patch the floor instead of chasing one more splash play.',
      openai:
        'Coach move: make the stabilizing add first, then revisit higher-variance decisions.',
    },
    rosterMathSummary:
      'The math says the roster is competitive, but one weak room still consumes too much downside.',
    strategyInsight:
      'This is the kind of team that can win now if you patch the floor instead of chasing one more splash play.',
    weeklyAdvice:
      'Coach move: make the stabilizing add first, then revisit higher-variance decisions.',
    deterministicSeed: 90412,
    lastEvaluatedAt: '2026-03-27T10:05:00.000Z',
  }
}

const loadPowerRankings: AdvantagePowerLoader = async ({
  sport,
}): Promise<PlatformPowerLeaderboardResult> => {
  const leaderName = SPORT_LEADERS[sport] ?? SPORT_LEADERS.NFL

  return {
    rows: [
      {
        managerId: `${sport.toLowerCase()}-leader`,
        rank: 1,
        powerScore: 0.912,
        legacyScore: 97.4,
        totalXP: 14820,
        championshipCount: 4,
        winPercentage: 68.4,
        totalLeaguesPlayed: 11,
        displayName: leaderName,
      },
      {
        managerId: `${sport.toLowerCase()}-runner-up`,
        rank: 2,
        powerScore: 0.874,
        legacyScore: 92.7,
        totalXP: 13910,
        championshipCount: 3,
        winPercentage: 64.1,
        totalLeaguesPlayed: 10,
        displayName: 'Contender Central',
      },
    ],
    total: 28,
    generatedAt: '2026-03-27T09:58:00.000Z',
  }
}

const loadSimulationPreview: AdvantageSimulationLoader = async ({
  sport,
}): Promise<AdvantageSimulationPreview> => {
  return {
    teamAName: `${sport} Alpha`,
    teamBName: `${sport} Beta`,
    favoriteTeam: `${sport} Alpha`,
    underdogTeam: `${sport} Beta`,
    favoriteWinProbability: 0.68,
    projectedFavoriteScore: 126.8,
    projectedUnderdogScore: 118.9,
    projectedMargin: 7.9,
    iterations: 1500,
    volatilityTag: 'medium',
    deterministicSeed: 44771,
    updatedAt: '2026-03-27T10:04:00.000Z',
  }
}

export default function AdvantageDashboardHarnessClient() {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  return (
    <div className="min-h-screen bg-[#040915] text-white">
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Advantage Dashboard Harness</h1>
          <p className="text-sm text-white/70">
            Deterministic harness for the unified advantage dashboard and its routing audit.
          </p>
          <p className="text-xs text-white/50" data-testid="advantage-hydrated-flag">
            {hydrated ? 'hydrated' : 'hydrating'}
          </p>
        </div>

        <AdvantageDashboardPage
          initialSport="NFL"
          initialTeamName="Harness United"
          initialWeek={7}
          loadGlobalInsights={loadGlobalInsights}
          loadCoachEvaluation={loadCoachEvaluation}
          loadPowerRankings={loadPowerRankings}
          loadSimulationPreview={loadSimulationPreview}
        />
      </div>
    </div>
  )
}
