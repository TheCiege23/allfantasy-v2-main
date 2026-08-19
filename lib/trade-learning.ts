import { prisma } from './prisma';
import { Prisma } from '@prisma/client';
import {
  fetchFantasyCalcValues,
  findPlayerBySleeperId,
  findPlayerByName,
  getPickValue,
  FantasyCalcPlayer
} from './fantasycalc';
import { resolveCurrentTradeLearningSeason } from './trade-engine/season-resolver';

interface TradePlayer {
  id: string;
  name: string;
  position: string;
}

interface TradePick {
  season: number;
  round: number;
}

interface TradeAnalysisResult {
  winner: 'user' | 'partner' | 'even';
  grade: string;
  valueDifferential: number;
  percentDiff: number;
  keyReasons: string[];
  marketContext: {
    isConsolidation: boolean;
    consolidationType?: '2-for-1' | '3-for-1' | 'multi-for-1';
    involvesPicks: boolean;
    involvesEliteAsset: boolean;
  };
}

interface ExtendedTradeAnalysisResult extends TradeAnalysisResult {
  valueGiven: number;
  valueReceived: number;
  playersGivenWithValues: Array<{ name: string; position: string; value: number }>;
  playersReceivedWithValues: Array<{ name: string; position: string; value: number }>;
}

export async function analyzeHistoricalTrade(
  trade: {
    id: string;
    playersGiven: unknown;
    picksGiven: unknown;
    playersReceived: unknown;
    picksReceived: unknown;
    season: number;
    leagueFormat?: string | null;
    scoringType?: string | null;
    isSuperFlex?: boolean | null;
  }
): Promise<ExtendedTradeAnalysisResult | null> {
  try {
    const playersGiven = (trade.playersGiven as TradePlayer[]) || [];
    const picksGiven = (trade.picksGiven as TradePick[]) || [];
    const playersReceived = (trade.playersReceived as TradePlayer[]) || [];
    const picksReceived = (trade.picksReceived as TradePick[]) || [];

    if (playersGiven.length === 0 && picksGiven.length === 0) return null;
    if (playersReceived.length === 0 && picksReceived.length === 0) return null;

    const isDynasty = trade.leagueFormat === 'dynasty' || trade.leagueFormat === 'keeper';
    const numQbs = trade.isSuperFlex ? 2 : 1;

    const fantasyCalcPlayers = await fetchFantasyCalcValues({
      isDynasty,
      numQbs: numQbs as 1 | 2,
      numTeams: 12,
      ppr: 1,
    });

    const getPlayerValue = (player: TradePlayer): number => {
      const fcPlayer = findPlayerBySleeperId(fantasyCalcPlayers, player.id) ||
                       findPlayerByName(fantasyCalcPlayers, player.name);
      return fcPlayer?.value || 200;
    };

    const getPickTotalValue = (picks: TradePick[]): number => {
      return picks.reduce((sum, pick) => sum + getPickValue(pick.season, pick.round, isDynasty), 0);
    };

    const playersGivenWithValues = playersGiven.map(p => ({
      name: p.name,
      position: p.position,
      value: getPlayerValue(p),
    }));
    const playersReceivedWithValues = playersReceived.map(p => ({
      name: p.name,
      position: p.position,
      value: getPlayerValue(p),
    }));

    const valueGiven = playersGivenWithValues.reduce((sum, p) => sum + p.value, 0) + getPickTotalValue(picksGiven);
    const valueReceived = playersReceivedWithValues.reduce((sum, p) => sum + p.value, 0) + getPickTotalValue(picksReceived);

    const valueDifferential = valueReceived - valueGiven;
    const maxValue = Math.max(valueGiven, valueReceived, 1);
    const percentDiff = Math.round(Math.abs(valueDifferential) / maxValue * 100);

    let winner: 'user' | 'partner' | 'even' = 'even';
    let grade = 'C';

    if (percentDiff >= 25) {
      winner = valueDifferential > 0 ? 'user' : 'partner';
      grade = valueDifferential > 0 ? 'A' : 'D';
    } else if (percentDiff >= 15) {
      winner = valueDifferential > 0 ? 'user' : 'partner';
      grade = valueDifferential > 0 ? 'B+' : 'C-';
    } else if (percentDiff >= 8) {
      winner = valueDifferential > 0 ? 'user' : 'partner';
      grade = valueDifferential > 0 ? 'B' : 'C';
    }

    const givenCount = playersGiven.length + picksGiven.length;
    const receivedCount = playersReceived.length + picksReceived.length;
    const isConsolidation = givenCount > receivedCount && receivedCount <= 2;
    
    let consolidationType: '2-for-1' | '3-for-1' | 'multi-for-1' | undefined;
    if (isConsolidation) {
      if (givenCount === 2 && receivedCount === 1) consolidationType = '2-for-1';
      else if (givenCount === 3 && receivedCount === 1) consolidationType = '3-for-1';
      else consolidationType = 'multi-for-1';
    }

    const hasEliteGiven = playersGivenWithValues.some(p => p.value >= 7000);
    const hasEliteReceived = playersReceivedWithValues.some(p => p.value >= 7000);

    const keyReasons: string[] = [];
    if (isConsolidation) {
      keyReasons.push(`Consolidation trade (${consolidationType})`);
    }
    if (hasEliteReceived) {
      keyReasons.push('Acquired elite-tier asset');
    }
    if (picksGiven.length > 0 || picksReceived.length > 0) {
      keyReasons.push('Involves draft capital');
    }
    if (percentDiff < 10) {
      keyReasons.push('Fair value exchange');
    }

    return {
      winner,
      grade,
      valueDifferential,
      percentDiff,
      keyReasons,
      marketContext: {
        isConsolidation,
        consolidationType,
        involvesPicks: picksGiven.length > 0 || picksReceived.length > 0,
        involvesEliteAsset: hasEliteGiven || hasEliteReceived,
      },
      valueGiven,
      valueReceived,
      playersGivenWithValues,
      playersReceivedWithValues,
    };
  } catch (error) {
    console.error('Error analyzing trade:', error);
    return null;
  }
}

async function acquireProcessingLock(): Promise<boolean> {
  try {
    const existingLock = await prisma.tradeLearningStats.findFirst({
      where: {
        season: 9999,
      },
    });

    if (existingLock) {
      const lockAge = Date.now() - existingLock.createdAt.getTime();
      if (lockAge < 5 * 60 * 1000) {
        return false;
      }
      await prisma.tradeLearningStats.delete({ where: { id: existingLock.id } });
    }

    await prisma.tradeLearningStats.create({
      data: {
        season: 9999,
        totalTradesAnalyzed: 0,
        totalUsersContributing: 0,
      },
    });
    return true;
  } catch {
    return false;
  }
}

async function releaseProcessingLock(): Promise<void> {
  try {
    await prisma.tradeLearningStats.deleteMany({
      where: { season: 9999 },
    });
  } catch {
  }
}

export async function processUnanalyzedTrades(limit: number = 50): Promise<{ processed: number; affectedLeagues: Array<{ sleeperUsername: string; sleeperLeagueId: string }> }> {
  const hasLock = await acquireProcessingLock();
  if (!hasLock) {
    console.log('Trade analysis already in progress, skipping');
    return { processed: 0, affectedLeagues: [] };
  }

  try {
    const trades = await prisma.leagueTrade.findMany({
      where: { 
        analyzed: false,
        season: { gte: 2024 },
      },
      take: limit,
      include: {
        history: {
          select: {
            sleeperLeagueId: true,
            sleeperUsername: true,
          },
        },
      },
    });

    let processed = 0;
    const affectedSet = new Set<string>();
    const affectedLeagues: Array<{ sleeperUsername: string; sleeperLeagueId: string }> = [];

    for (const trade of trades) {
      const result = await analyzeHistoricalTrade(trade);

      if (result) {
        await prisma.leagueTrade.update({
          where: { id: trade.id },
          data: {
            analyzed: true,
            valueGiven: result.valueGiven,
            valueReceived: result.valueReceived,
            valueDifferential: result.valueDifferential,
            analysisResult: {
              winner: result.winner,
              grade: result.grade,
              valueDifferential: result.valueDifferential,
              percentDiff: result.percentDiff,
              keyReasons: result.keyReasons,
              marketContext: result.marketContext,
              playersGivenWithValues: result.playersGivenWithValues,
              playersReceivedWithValues: result.playersReceivedWithValues,
            },
          },
        });
        processed++;

        const key = `${trade.history.sleeperUsername}:${trade.history.sleeperLeagueId}`;
        if (!affectedSet.has(key)) {
          affectedSet.add(key);
          affectedLeagues.push({
            sleeperUsername: trade.history.sleeperUsername,
            sleeperLeagueId: trade.history.sleeperLeagueId,
          });
        }
      } else {
        await prisma.leagueTrade.update({
          where: { id: trade.id },
          data: { analyzed: true },
        });
      }
    }

    return { processed, affectedLeagues };
  } finally {
    await releaseProcessingLock();
  }
}

interface ExtendedAnalysisResult {
  winner: string;
  grade: string;
  valueDifferential: number;
  percentDiff: number;
  keyReasons: string[];
  marketContext: {
    isConsolidation: boolean;
    consolidationType?: string;
    involvesPicks: boolean;
    involvesEliteAsset: boolean;
  };
  playersGivenWithValues?: Array<{ name: string; position: string; value: number }>;
  playersReceivedWithValues?: Array<{ name: string; position: string; value: number }>;
}

export async function aggregateTradeLearningInsights(season?: number): Promise<void> {
  season = season ?? await resolveCurrentTradeLearningSeason();
  const analyzedTrades = await prisma.leagueTrade.findMany({
    where: {
      analyzed: true,
      season,
      analysisResult: { not: Prisma.DbNull },
      valueGiven: { not: null },
      valueReceived: { not: null },
    },
  });

  if (analyzedTrades.length < 10) {
    console.log('Not enough analyzed trades to generate insights');
    return;
  }

  const playerMarketData: Map<string, { 
    name: string; 
    position: string;
    timesTraded: number;
    totalValueInTrades: number;
    avgTradeValue: number;
    fairTradeCount: number;
    trades: Array<{ value: number; percentDiff: number }>;
  }> = new Map();

  const consolidationStats = {
    '2-for-1': { count: 0, totalPremium: 0, fairCount: 0 },
    '3-for-1': { count: 0, totalPremium: 0, fairCount: 0 },
  };

  const positionTrends: Map<string, { 
    count: number; 
    totalValue: number;
    avgValue: number;
  }> = new Map();

  for (const trade of analyzedTrades) {
    const result = trade.analysisResult as unknown as ExtendedAnalysisResult;
    if (!result) continue;

    const playersWithValues = [
      ...(result.playersGivenWithValues || []),
      ...(result.playersReceivedWithValues || []),
    ];

    for (const player of playersWithValues) {
      if (!player.name) continue;
      const key = player.name.toLowerCase();
      const existing = playerMarketData.get(key) || {
        name: player.name,
        position: player.position,
        timesTraded: 0,
        totalValueInTrades: 0,
        avgTradeValue: 0,
        fairTradeCount: 0,
        trades: [],
      };

      existing.timesTraded++;
      existing.totalValueInTrades += player.value;
      if (result.percentDiff < 15) existing.fairTradeCount++;
      existing.trades.push({ value: player.value, percentDiff: result.percentDiff });

      playerMarketData.set(key, existing);

      const posTrend = positionTrends.get(player.position) || { count: 0, totalValue: 0, avgValue: 0 };
      posTrend.count++;
      posTrend.totalValue += player.value;
      positionTrends.set(player.position, posTrend);
    }

    if (result.marketContext?.isConsolidation && result.marketContext.consolidationType) {
      const type = result.marketContext.consolidationType as '2-for-1' | '3-for-1';
      if (consolidationStats[type]) {
        consolidationStats[type].count++;
        consolidationStats[type].totalPremium += result.percentDiff;
        if (result.percentDiff < 15) {
          consolidationStats[type].fairCount++;
        }
      }
    }
  }

  for (const posTrend of Array.from(positionTrends.values())) {
    if (posTrend.count > 0) {
      posTrend.avgValue = Math.round(posTrend.totalValue / posTrend.count);
    }
  }

  for (const [_key, stats] of Array.from(playerMarketData.entries())) {
    if (stats.timesTraded >= 3) {
      stats.avgTradeValue = Math.round(stats.totalValueInTrades / stats.timesTraded);
      const fairRate = stats.fairTradeCount / stats.timesTraded;
      
      let marketTrend = 'fair';
      if (fairRate >= 0.7) marketTrend = 'stable';
      else if (fairRate < 0.4) marketTrend = 'volatile';

      const insightText = `${stats.name} (${stats.position}): Traded ${stats.timesTraded} times at avg value ${stats.avgTradeValue}. ` +
        `${Math.round(fairRate * 100)}% of trades were fair value. Market: ${marketTrend}.`;

      await prisma.tradeLearningInsight.upsert({
        where: {
          insightType_playerName_position_ageRange_season: {
            insightType: 'player_value',
            playerName: stats.name,
            position: stats.position,
            ageRange: '',
            season,
          },
        },
        create: {
          insightType: 'player_value',
          playerName: stats.name,
          position: stats.position,
          sampleSize: stats.timesTraded,
          avgValueGiven: stats.avgTradeValue,
          avgValueReceived: stats.avgTradeValue,
          winRate: fairRate,
          marketTrend,
          confidenceScore: Math.min(stats.timesTraded / 10, 1),
          insightText,
          examples: stats.trades.slice(0, 5),
          season,
        },
        update: {
          sampleSize: stats.timesTraded,
          avgValueGiven: stats.avgTradeValue,
          avgValueReceived: stats.avgTradeValue,
          winRate: fairRate,
          marketTrend,
          confidenceScore: Math.min(stats.timesTraded / 10, 1),
          insightText,
          examples: stats.trades.slice(0, 5),
        },
      });
    }
  }

  const twoForOneFairRate = consolidationStats['2-for-1'].count > 0 
    ? Math.round((consolidationStats['2-for-1'].fairCount / consolidationStats['2-for-1'].count) * 100)
    : 0;
  const threeForOneFairRate = consolidationStats['3-for-1'].count > 0
    ? Math.round((consolidationStats['3-for-1'].fairCount / consolidationStats['3-for-1'].count) * 100)
    : 0;
  const twoForOneAvgPremium = consolidationStats['2-for-1'].count > 0
    ? Math.round(consolidationStats['2-for-1'].totalPremium / consolidationStats['2-for-1'].count)
    : 0;
  const threeForOneAvgPremium = consolidationStats['3-for-1'].count > 0
    ? Math.round(consolidationStats['3-for-1'].totalPremium / consolidationStats['3-for-1'].count)
    : 0;

  const consolidationInsightText = `2-for-1 trades: ${twoForOneFairRate}% are fair value with avg ${twoForOneAvgPremium}% premium (n=${consolidationStats['2-for-1'].count}). ` +
    `3-for-1 trades: ${threeForOneFairRate}% are fair value with avg ${threeForOneAvgPremium}% premium (n=${consolidationStats['3-for-1'].count}).`;

  await prisma.tradeLearningInsight.upsert({
    where: {
      insightType_playerName_position_ageRange_season: {
        insightType: 'consolidation_pattern',
        playerName: '',
        position: '',
        ageRange: '',
        season,
      },
    },
    create: {
      insightType: 'consolidation_pattern',
      sampleSize: consolidationStats['2-for-1'].count + consolidationStats['3-for-1'].count,
      insightText: consolidationInsightText,
      examples: consolidationStats,
      season,
    },
    update: {
      sampleSize: consolidationStats['2-for-1'].count + consolidationStats['3-for-1'].count,
      insightText: consolidationInsightText,
      examples: consolidationStats,
    },
  });

  const uniqueUsers = await prisma.leagueTradeHistory.count({
    where: {
      trades: {
        some: {
          analyzed: true,
          season,
        },
      },
    },
  });

  await prisma.tradeLearningStats.upsert({
    where: { season },
    create: {
      season,
      totalTradesAnalyzed: analyzedTrades.length,
      totalUsersContributing: uniqueUsers,
      positionTrends: Object.fromEntries(positionTrends),
    },
    update: {
      totalTradesAnalyzed: analyzedTrades.length,
      totalUsersContributing: uniqueUsers,
      positionTrends: Object.fromEntries(positionTrends),
    },
  });

  console.log(`Aggregated insights from ${analyzedTrades.length} trades, ${uniqueUsers} users`);
}

export async function getLearningContextForAI(season?: number): Promise<string> {
  season = season ?? await resolveCurrentTradeLearningSeason();
  const stats = await prisma.tradeLearningStats.findUnique({
    where: { season },
  });

  const insights = await prisma.tradeLearningInsight.findMany({
    where: {
      season,
      sampleSize: { gte: 3 },
      confidenceScore: { gte: 0.3 },
    },
    orderBy: { sampleSize: 'desc' },
    take: 30,
  });

  if (!stats || insights.length === 0) {
    return '';
  }

  const lines: string[] = [
    '\n## REAL USER TRADE DATA INSIGHTS (from AllFantasy users)',
    `Based on ${stats.totalTradesAnalyzed} real trades from ${stats.totalUsersContributing} users in ${season}:`,
    '',
  ];

  const playerInsights = insights.filter(i => i.insightType === 'player_value');
  if (playerInsights.length > 0) {
    lines.push('### Player Market Trends:');
    for (const insight of playerInsights.slice(0, 15)) {
      if (insight.insightText) {
        lines.push(`- ${insight.insightText}`);
      }
    }
    lines.push('');
  }

  const consolidationInsight = insights.find(i => i.insightType === 'consolidation_pattern');
  if (consolidationInsight?.insightText) {
    lines.push('### Consolidation Trade Patterns:');
    lines.push(`- ${consolidationInsight.insightText}`);
    lines.push('');
  }

  return lines.join('\n');
}

export async function runBackgroundTradeAnalysis(): Promise<{ processed: number; aggregated: boolean; calibrated: boolean; driftDetected: boolean }> {
  try {
    const result = await processUnanalyzedTrades(100);

    let calibrated = false
    let driftDetected = false
    if (result.processed > 0) {
      // Resolved once so every step of this background cycle (insights,
      // calibration, drift, outcome backfill) operates on the same season.
      const season = await resolveCurrentTradeLearningSeason();
      await aggregateTradeLearningInsights(season);

      if (result.affectedLeagues.length > 0) {
        try {
          const { invalidateTendencyCache } = await import('./trade-pre-analysis')
          for (const league of result.affectedLeagues) {
            await invalidateTendencyCache(league.sleeperUsername, league.sleeperLeagueId)
          }
          console.log(`[TradeAnalysis] Invalidated tendency caches for ${result.affectedLeagues.length} affected league(s) after processing ${result.processed} trades`)
        } catch (invErr) {
          console.error('[TradeAnalysis] Tendency invalidation error:', invErr)
        }
      }

      try {
        const { runFullCalibration } = await import('./trade-engine/accept-calibration')
        const calResult = await runFullCalibration(season)
        calibrated = calResult.intercept.adjusted || calResult.feedback.adjusted
      } catch (calErr) {
        console.error('[TradeAnalysis] Calibration error:', calErr)
      }

      try {
        const { runDriftDetection } = await import('./trade-engine/drift-detection')
        const driftReport = await runDriftDetection(season)
        driftDetected = driftReport.overallSeverity !== 'ok'
      } catch (driftErr) {
        console.error('[TradeAnalysis] Drift detection error:', driftErr)
      }

      try {
        const { logAcceptedTradesAsOutcomes } = await import('./trade-engine/trade-event-logger')
        const outcomeCount = await logAcceptedTradesAsOutcomes(season)
        if (outcomeCount > 0) {
          console.log(`[TradeAnalysis] Backfilled ${outcomeCount} trade outcome events`)
        }
      } catch (outErr) {
        console.error('[TradeAnalysis] Trade outcome backfill error:', outErr)
      }

      return { processed: result.processed, aggregated: true, calibrated, driftDetected };
    }

    return { processed: result.processed, aggregated: false, calibrated: false, driftDetected: false };
  } catch (error) {
    console.error('Background trade analysis error:', error);
    return { processed: 0, aggregated: false, calibrated: false, driftDetected: false };
  }
}
