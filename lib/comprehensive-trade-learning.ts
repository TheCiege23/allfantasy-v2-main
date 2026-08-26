import { prisma } from './prisma';
import { findPlayerBySleeperId, findPlayerByName, getPickValue, FantasyCalcPlayer } from './fantasycalc';
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db';
import {
  calculateDynastyScore,
  getAgeCurveWithCliffs,
  getPositionMultiplier,
  findPlayerTier,
  ALL_TIERED_PLAYERS,
  AssetTier,
} from './dynasty-tiers';
import { getSportsData } from './sports-router';

interface TradePlayer {
  id: string;
  name: string;
  position: string;
}

interface TradePick {
  season: number;
  round: number;
}

interface EnhancedTradeAnalysis {
  valueGiven: number;
  valueReceived: number;
  valueDifferential: number;
  percentDiff: number;
  dynastyTierScore: number;
  isFairTrade: boolean;
  playersWithEnrichment: Array<{
    name: string;
    position: string;
    fantasyCalcValue: number;
    dynastyTier: AssetTier | null;
    dynastyScore: number;
    age: number | null;
    ageCurve: number;
  }>;
  consolidationType: '2-for-1' | '3-for-1' | 'multi-for-1' | null;
  involvesPicks: boolean;
  involvesEliteAsset: boolean;
}

const fcCache: Map<string, { data: FantasyCalcPlayer[]; fetchedAt: number }> = new Map();
const FC_CACHE_TTL = 1000 * 60 * 30;

async function getCachedFantasyCalcValues(isDynasty: boolean, numQbs: 1 | 2): Promise<FantasyCalcPlayer[]> {
  const key = `${isDynasty}-${numQbs}`;
  const cached = fcCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < FC_CACHE_TTL) {
    return cached.data;
  }
  
  const data = await getFantasyCalcValuesDbFirst({
    isDynasty,
    numQbs,
    numTeams: 12,
    ppr: 1,
  });
  
  fcCache.set(key, { data, fetchedAt: Date.now() });
  return data;
}

function getPlayerAge(player: FantasyCalcPlayer | null, tieredPlayer: { age?: number } | null | undefined): number | null {
  if (player?.player?.maybeAge) return player.player.maybeAge;
  if (tieredPlayer?.age) return tieredPlayer.age;
  return null;
}

export async function analyzeTradeComprehensive(
  trade: {
    id: string;
    playersGiven: unknown;
    picksGiven: unknown;
    playersReceived: unknown;
    picksReceived: unknown;
    season: number;
    leagueFormat?: string | null;
    isSuperFlex?: boolean | null;
    sport?: string;
  }
): Promise<EnhancedTradeAnalysis | null> {
  try {
    const playersGiven = (trade.playersGiven as TradePlayer[]) || [];
    const picksGiven = (trade.picksGiven as TradePick[]) || [];
    const playersReceived = (trade.playersReceived as TradePlayer[]) || [];
    const picksReceived = (trade.picksReceived as TradePick[]) || [];

    if (playersGiven.length === 0 && picksGiven.length === 0) return null;
    if (playersReceived.length === 0 && picksReceived.length === 0) return null;

    const isDynasty = trade.leagueFormat === 'dynasty' || trade.leagueFormat === 'keeper';
    const isSF = trade.isSuperFlex === true;
    const numQbs: 1 | 2 = isSF ? 2 : 1;

    const fantasyCalcPlayers = await getCachedFantasyCalcValues(isDynasty, numQbs);

    const allPlayers = [...playersGiven, ...playersReceived];
    const playersWithEnrichment: EnhancedTradeAnalysis['playersWithEnrichment'] = [];
    const playerAgeData: Record<string, number> = {};

    for (const player of allPlayers) {
      const fcPlayer = findPlayerBySleeperId(fantasyCalcPlayers, player.id) ||
                       findPlayerByName(fantasyCalcPlayers, player.name);
      const tieredPlayer = findPlayerTier(player.name);
      const age = getPlayerAge(fcPlayer, tieredPlayer);
      const tier = tieredPlayer?.tier ?? null;
      
      const fcValue = fcPlayer?.value || 200;
      const ageCurve = getAgeCurveWithCliffs(player.position, age ?? undefined);
      
      const dynastyResult = calculateDynastyScore(
        fcValue,
        player.position,
        age ?? undefined,
        tier,
        isSF,
        false
      );

      if (age) {
        playerAgeData[player.name] = age;
      }

      playersWithEnrichment.push({
        name: player.name,
        position: player.position,
        fantasyCalcValue: fcValue,
        dynastyTier: tier,
        dynastyScore: dynastyResult.score,
        age,
        ageCurve,
      });
    }

    const getPlayerValue = (player: TradePlayer): number => {
      const enriched = playersWithEnrichment.find(p => p.name === player.name);
      return enriched?.dynastyScore || enriched?.fantasyCalcValue || 200;
    };

    const getPickTotalValue = (picks: TradePick[]): number => {
      return picks.reduce((sum, pick) => sum + getPickValue(pick.season, pick.round, isDynasty), 0);
    };

    const valueGiven = playersGiven.reduce((sum, p) => sum + getPlayerValue(p), 0) + getPickTotalValue(picksGiven);
    const valueReceived = playersReceived.reduce((sum, p) => sum + getPlayerValue(p), 0) + getPickTotalValue(picksReceived);

    const valueDifferential = valueReceived - valueGiven;
    const maxValue = Math.max(valueGiven, valueReceived, 1);
    const percentDiff = Math.round(Math.abs(valueDifferential) / maxValue * 100);

    const givenCount = playersGiven.length + picksGiven.length;
    const receivedCount = playersReceived.length + picksReceived.length;
    const isConsolidation = givenCount > receivedCount && receivedCount <= 2;
    
    let consolidationType: EnhancedTradeAnalysis['consolidationType'] = null;
    if (isConsolidation) {
      if (givenCount === 2 && receivedCount === 1) consolidationType = '2-for-1';
      else if (givenCount === 3 && receivedCount === 1) consolidationType = '3-for-1';
      else consolidationType = 'multi-for-1';
    }

    const dynastyTierScore = playersWithEnrichment.reduce((sum, p) => sum + p.dynastyScore, 0);
    const hasElite = playersWithEnrichment.some(p => p.dynastyTier !== null && p.dynastyTier <= 1);

    return {
      valueGiven,
      valueReceived,
      valueDifferential,
      percentDiff,
      dynastyTierScore,
      isFairTrade: percentDiff < 10,
      playersWithEnrichment,
      consolidationType,
      involvesPicks: picksGiven.length > 0 || picksReceived.length > 0,
      involvesEliteAsset: hasElite,
    };
  } catch (error) {
    console.error('Error in comprehensive trade analysis:', error);
    return null;
  }
}

async function acquireComprehensiveLock(): Promise<boolean> {
  try {
    const existingLock = await prisma.tradeLearningStats.findFirst({
      where: { season: 8888 },
    });

    if (existingLock) {
      const lockAge = Date.now() - existingLock.createdAt.getTime();
      if (lockAge < 10 * 60 * 1000) {
        return false;
      }
      await prisma.tradeLearningStats.delete({ where: { id: existingLock.id } });
    }

    await prisma.tradeLearningStats.create({
      data: {
        season: 8888,
        totalTradesAnalyzed: 0,
        totalUsersContributing: 0,
      },
    });
    return true;
  } catch {
    return false;
  }
}

async function releaseComprehensiveLock(): Promise<void> {
  try {
    await prisma.tradeLearningStats.deleteMany({
      where: { season: 8888 },
    });
  } catch {}
}

export async function processAllHistoricalTrades(limit: number = 100): Promise<number> {
  const hasLock = await acquireComprehensiveLock();
  if (!hasLock) {
    console.log('Comprehensive trade analysis already in progress');
    return 0;
  }

  try {
    const trades = await prisma.leagueTrade.findMany({
      where: { 
        analyzed: false,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    if (trades.length === 0) {
      return 0;
    }

    console.log(`Processing ${trades.length} trades from all years...`);
    let processed = 0;

    for (const trade of trades) {
      try {
        const analysis = await analyzeTradeComprehensive({
          id: trade.id,
          playersGiven: trade.playersGiven,
          picksGiven: trade.picksGiven,
          playersReceived: trade.playersReceived,
          picksReceived: trade.picksReceived,
          season: trade.season,
          leagueFormat: trade.leagueFormat,
          isSuperFlex: trade.isSuperFlex,
          sport: trade.sport,
        });

        if (analysis) {
          const playerAgeData: Record<string, number> = {};
          for (const p of analysis.playersWithEnrichment) {
            if (p.age) playerAgeData[p.name] = p.age;
          }

          await prisma.leagueTrade.update({
            where: { id: trade.id },
            data: {
              analyzed: true,
              valueGiven: analysis.valueGiven,
              valueReceived: analysis.valueReceived,
              valueDifferential: analysis.valueDifferential,
              dynastyTierScore: analysis.dynastyTierScore,
              playerAgeData: Object.keys(playerAgeData).length > 0 ? playerAgeData : undefined,
              analysisResult: {
                percentDiff: analysis.percentDiff,
                isFairTrade: analysis.isFairTrade,
                consolidationType: analysis.consolidationType,
                involvesPicks: analysis.involvesPicks,
                involvesEliteAsset: analysis.involvesEliteAsset,
                playersWithEnrichment: analysis.playersWithEnrichment,
              },
            },
          });
          processed++;
        } else {
          await prisma.leagueTrade.update({
            where: { id: trade.id },
            data: { analyzed: true },
          });
        }
      } catch (error) {
        console.error(`Error processing trade ${trade.id}:`, error);
      }
    }

    return processed;
  } finally {
    await releaseComprehensiveLock();
  }
}

interface AggregatedPlayerData {
  name: string;
  position: string;
  tradeCount: number;
  avgValue: number;
  avgDynastyScore: number;
  fairTradeRate: number;
  avgAge: number | null;
  tiers: number[];
}

interface ConsolidationStats {
  '2-for-1': { count: number; fairCount: number; totalPremium: number };
  '3-for-1': { count: number; fairCount: number; totalPremium: number };
}

interface PositionTrend {
  position: string;
  avgValue: number;
  avgDynastyScore: number;
  tradeVolume: number;
  fairTradeRate: number;
}

interface AgeCurveTrend {
  position: string;
  ageRange: string;
  avgValue: number;
  tradeCount: number;
}

export async function aggregateComprehensiveInsights(): Promise<void> {
  const allAnalyzedTrades = await prisma.leagueTrade.findMany({
    where: {
      analyzed: true,
    },
    select: {
      season: true,
      platform: true,
      sport: true,
      valueGiven: true,
      valueReceived: true,
      valueDifferential: true,
      dynastyTierScore: true,
      playerAgeData: true,
      analysisResult: true,
      playersGiven: true,
      playersReceived: true,
    },
  });

  if (allAnalyzedTrades.length < 5) {
    console.log('Not enough trades for comprehensive aggregation');
    return;
  }

  console.log(`Aggregating insights from ${allAnalyzedTrades.length} trades across all years...`);

  const playerStats = new Map<string, AggregatedPlayerData>();
  const consolidationStats: ConsolidationStats = {
    '2-for-1': { count: 0, fairCount: 0, totalPremium: 0 },
    '3-for-1': { count: 0, fairCount: 0, totalPremium: 0 },
  };
  const positionStats = new Map<string, { totalValue: number; totalDynastyScore: number; count: number; fairCount: number }>();
  const ageCurveStats = new Map<string, { totalValue: number; count: number }>();
  const seasonStats = new Map<number, { count: number; totalValue: number; fairCount: number }>();

  for (const trade of allAnalyzedTrades) {
    const result = trade.analysisResult as {
      percentDiff?: number;
      isFairTrade?: boolean;
      consolidationType?: string;
      playersWithEnrichment?: Array<{
        name: string;
        position: string;
        fantasyCalcValue: number;
        dynastyTier: number | null;
        dynastyScore: number;
        age: number | null;
      }>;
    } | null;

    if (!result?.playersWithEnrichment) continue;

    const isFair = result.isFairTrade === true;
    const percentDiff = result.percentDiff || 0;

    if (result.consolidationType === '2-for-1') {
      consolidationStats['2-for-1'].count++;
      if (isFair) consolidationStats['2-for-1'].fairCount++;
      consolidationStats['2-for-1'].totalPremium += percentDiff;
    } else if (result.consolidationType === '3-for-1') {
      consolidationStats['3-for-1'].count++;
      if (isFair) consolidationStats['3-for-1'].fairCount++;
      consolidationStats['3-for-1'].totalPremium += percentDiff;
    }

    const seasonStat = seasonStats.get(trade.season) || { count: 0, totalValue: 0, fairCount: 0 };
    seasonStat.count++;
    seasonStat.totalValue += (trade.valueGiven || 0) + (trade.valueReceived || 0);
    if (isFair) seasonStat.fairCount++;
    seasonStats.set(trade.season, seasonStat);

    for (const player of result.playersWithEnrichment) {
      const key = player.name.toLowerCase();
      const existing = playerStats.get(key) || {
        name: player.name,
        position: player.position,
        tradeCount: 0,
        avgValue: 0,
        avgDynastyScore: 0,
        fairTradeRate: 0,
        avgAge: null,
        tiers: [],
      };

      existing.tradeCount++;
      existing.avgValue = ((existing.avgValue * (existing.tradeCount - 1)) + player.fantasyCalcValue) / existing.tradeCount;
      existing.avgDynastyScore = ((existing.avgDynastyScore * (existing.tradeCount - 1)) + player.dynastyScore) / existing.tradeCount;
      if (isFair) {
        existing.fairTradeRate = (existing.fairTradeRate * (existing.tradeCount - 1) + 1) / existing.tradeCount;
      } else {
        existing.fairTradeRate = (existing.fairTradeRate * (existing.tradeCount - 1)) / existing.tradeCount;
      }
      if (player.dynastyTier !== null) {
        existing.tiers.push(player.dynastyTier);
      }
      if (player.age) {
        if (existing.avgAge === null) {
          existing.avgAge = player.age;
        } else {
          existing.avgAge = (existing.avgAge * (existing.tradeCount - 1) + player.age) / existing.tradeCount;
        }
      }
      playerStats.set(key, existing);

      const posStat = positionStats.get(player.position) || { totalValue: 0, totalDynastyScore: 0, count: 0, fairCount: 0 };
      posStat.totalValue += player.fantasyCalcValue;
      posStat.totalDynastyScore += player.dynastyScore;
      posStat.count++;
      if (isFair) posStat.fairCount++;
      positionStats.set(player.position, posStat);

      if (player.age) {
        let ageRange: string;
        if (player.age < 24) ageRange = '<24';
        else if (player.age <= 27) ageRange = '24-27';
        else if (player.age <= 30) ageRange = '28-30';
        else ageRange = '30+';

        const ageKey = `${player.position}_${ageRange}`;
        const ageStat = ageCurveStats.get(ageKey) || { totalValue: 0, count: 0 };
        ageStat.totalValue += player.fantasyCalcValue;
        ageStat.count++;
        ageCurveStats.set(ageKey, ageStat);
      }
    }
  }

  const topPlayers = Array.from(playerStats.values())
    .filter(p => p.tradeCount >= 3)
    .sort((a, b) => b.tradeCount - a.tradeCount)
    .slice(0, 50);

  for (const player of topPlayers) {
    const avgTier = player.tiers.length > 0 
      ? player.tiers.reduce((a, b) => a + b, 0) / player.tiers.length 
      : null;
    
    const confidenceScore = Math.min(1, player.tradeCount / 20);
    
    let marketTrend: string;
    if (player.fairTradeRate >= 0.6) {
      marketTrend = 'fair_valued';
    } else if (player.avgDynastyScore > player.avgValue * 1.1) {
      marketTrend = 'dynasty_premium';
    } else if (player.avgDynastyScore < player.avgValue * 0.9) {
      marketTrend = 'dynasty_discount';
    } else {
      marketTrend = 'market_aligned';
    }

    const insightText = `${player.name} (${player.position}): Traded ${player.tradeCount}x, avg value ${Math.round(player.avgValue)}, ` +
      `dynasty score ${Math.round(player.avgDynastyScore)}, ${Math.round(player.fairTradeRate * 100)}% fair trades. ${marketTrend}.`;

    const existingPlayerInsight = await prisma.tradeLearningInsight.findFirst({
      where: {
        insightType: 'player_value',
        playerName: player.name,
        position: player.position,
        season: 0,
      },
    });

    const playerInsightData = {
      sampleSize: player.tradeCount,
      avgValueGiven: player.avgValue,
      avgValueReceived: player.avgDynastyScore,
      winRate: player.fairTradeRate,
      marketTrend,
      confidenceScore,
      insightText,
      examples: { avgTier, tiers: player.tiers },
    };

    if (existingPlayerInsight) {
      await prisma.tradeLearningInsight.update({
        where: { id: existingPlayerInsight.id },
        data: playerInsightData,
      });
    } else {
      await prisma.tradeLearningInsight.create({
        data: {
          insightType: 'player_value',
          playerName: player.name,
          position: player.position,
          season: 0,
          ...playerInsightData,
        },
      });
    }
  }

  const positionEntries = Array.from(positionStats.entries());
  for (const [position, stat] of positionEntries) {
    if (stat.count < 5) continue;

    const avgValue = stat.totalValue / stat.count;
    const avgDynastyScore = stat.totalDynastyScore / stat.count;
    const fairRate = stat.fairCount / stat.count;

    const insightText = `${position}: ${stat.count} trades, avg value ${Math.round(avgValue)}, ` +
      `avg dynasty score ${Math.round(avgDynastyScore)}, ${Math.round(fairRate * 100)}% fair trade rate.`;

    const existingPositionInsight = await prisma.tradeLearningInsight.findFirst({
      where: {
        insightType: 'position_trend',
        position,
        season: 0,
      },
    });

    if (existingPositionInsight) {
      await prisma.tradeLearningInsight.update({
        where: { id: existingPositionInsight.id },
        data: {
          sampleSize: stat.count,
          avgValueGiven: avgValue,
          avgValueReceived: avgDynastyScore,
          winRate: fairRate,
          insightText,
          confidenceScore: Math.min(1, stat.count / 50),
        },
      });
    } else {
      await prisma.tradeLearningInsight.create({
        data: {
          insightType: 'position_trend',
          position,
          sampleSize: stat.count,
          avgValueGiven: avgValue,
          avgValueReceived: avgDynastyScore,
          winRate: fairRate,
          insightText,
          season: 0,
          confidenceScore: Math.min(1, stat.count / 50),
        },
      });
    }
  }

  const ageCurveEntries = Array.from(ageCurveStats.entries());
  for (const [ageKey, stat] of ageCurveEntries) {
    if (stat.count < 3) continue;

    const [position, ageRange] = ageKey.split('_');
    const avgValue = stat.totalValue / stat.count;

    const insightText = `${position} age ${ageRange}: ${stat.count} trades, avg value ${Math.round(avgValue)}.`;

    const existingAgeCurve = await prisma.tradeLearningInsight.findFirst({
      where: {
        insightType: 'age_curve',
        position,
        ageRange,
        season: 0,
      },
    });

    if (existingAgeCurve) {
      await prisma.tradeLearningInsight.update({
        where: { id: existingAgeCurve.id },
        data: {
          sampleSize: stat.count,
          avgValueGiven: avgValue,
          insightText,
          confidenceScore: Math.min(1, stat.count / 20),
        },
      });
    } else {
      await prisma.tradeLearningInsight.create({
        data: {
          insightType: 'age_curve',
          position,
          ageRange,
          sampleSize: stat.count,
          avgValueGiven: avgValue,
          insightText,
          season: 0,
          confidenceScore: Math.min(1, stat.count / 20),
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

  const consolidationInsightText = `2-for-1: ${twoForOneFairRate}% fair, avg ${twoForOneAvgPremium}% premium (n=${consolidationStats['2-for-1'].count}). ` +
    `3-for-1: ${threeForOneFairRate}% fair, avg ${threeForOneAvgPremium}% premium (n=${consolidationStats['3-for-1'].count}).`;

  const existingConsolidation = await prisma.tradeLearningInsight.findFirst({
    where: {
      insightType: 'consolidation_pattern',
      season: 0,
    },
  });

  const consolidationData = {
    sampleSize: consolidationStats['2-for-1'].count + consolidationStats['3-for-1'].count,
    insightText: consolidationInsightText,
    examples: JSON.parse(JSON.stringify(consolidationStats)),
    confidenceScore: Math.min(1, (consolidationStats['2-for-1'].count + consolidationStats['3-for-1'].count) / 30),
  };

  if (existingConsolidation) {
    await prisma.tradeLearningInsight.update({
      where: { id: existingConsolidation.id },
      data: consolidationData,
    });
  } else {
    await prisma.tradeLearningInsight.create({
      data: {
        insightType: 'consolidation_pattern',
        season: 0,
        ...consolidationData,
      },
    });
  }

  const totalTradesAnalyzed = allAnalyzedTrades.length;
  const uniqueUsers = await prisma.leagueTradeHistory.count();

  await prisma.tradeLearningStats.upsert({
    where: { season: 0 },
    create: {
      season: 0,
      totalTradesAnalyzed,
      totalUsersContributing: uniqueUsers,
      positionTrends: Object.fromEntries(
        Array.from(positionStats.entries()).map(([pos, stat]) => [
          pos,
          {
            avgValue: Math.round(stat.totalValue / stat.count),
            avgDynastyScore: Math.round(stat.totalDynastyScore / stat.count),
            tradeVolume: stat.count,
            fairRate: Math.round((stat.fairCount / stat.count) * 100),
          },
        ])
      ),
      ageCurveData: Object.fromEntries(
        Array.from(ageCurveStats.entries()).map(([key, stat]) => [
          key,
          { avgValue: Math.round(stat.totalValue / stat.count), count: stat.count },
        ])
      ),
    },
    update: {
      totalTradesAnalyzed,
      totalUsersContributing: uniqueUsers,
      positionTrends: Object.fromEntries(
        Array.from(positionStats.entries()).map(([pos, stat]) => [
          pos,
          {
            avgValue: Math.round(stat.totalValue / stat.count),
            avgDynastyScore: Math.round(stat.totalDynastyScore / stat.count),
            tradeVolume: stat.count,
            fairRate: Math.round((stat.fairCount / stat.count) * 100),
          },
        ])
      ),
      ageCurveData: Object.fromEntries(
        Array.from(ageCurveStats.entries()).map(([key, stat]) => [
          key,
          { avgValue: Math.round(stat.totalValue / stat.count), count: stat.count },
        ])
      ),
    },
  });

  console.log(`Aggregated insights from ${totalTradesAnalyzed} trades, ${uniqueUsers} users, ${topPlayers.length} player insights`);
}

export async function getComprehensiveLearningContext(): Promise<string> {
  const stats = await prisma.tradeLearningStats.findUnique({
    where: { season: 0 },
  });

  const insights = await prisma.tradeLearningInsight.findMany({
    where: {
      season: 0,
      sampleSize: { gte: 3 },
      confidenceScore: { gte: 0.3 },
    },
    orderBy: [
      { sampleSize: 'desc' },
      { confidenceScore: 'desc' },
    ],
    take: 50,
  });

  if (!stats || insights.length === 0) {
    return '';
  }

  const lines: string[] = [
    '\n## REAL USER TRADE DATA INSIGHTS (aggregated from AllFantasy users across all seasons)',
    `Based on ${stats.totalTradesAnalyzed} real trades from ${stats.totalUsersContributing} users:`,
    '',
  ];

  const positionInsights = insights.filter(i => i.insightType === 'position_trend');
  if (positionInsights.length > 0) {
    lines.push('### Position Trading Patterns:');
    for (const insight of positionInsights) {
      if (insight.insightText) {
        lines.push(`- ${insight.insightText}`);
      }
    }
    lines.push('');
  }

  const playerInsights = insights.filter(i => i.insightType === 'player_value');
  if (playerInsights.length > 0) {
    lines.push('### Most Traded Players (market signals):');
    for (const insight of playerInsights.slice(0, 20)) {
      if (insight.insightText) {
        lines.push(`- ${insight.insightText}`);
      }
    }
    lines.push('');
  }

  const ageCurveInsights = insights.filter(i => i.insightType === 'age_curve');
  if (ageCurveInsights.length > 0) {
    lines.push('### Age Curve Market Data:');
    for (const insight of ageCurveInsights.slice(0, 12)) {
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

export async function runComprehensiveBackgroundAnalysis(): Promise<{ processed: number; aggregated: boolean }> {
  try {
    const processed = await processAllHistoricalTrades(100);
    
    if (processed > 0) {
      await aggregateComprehensiveInsights();
      return { processed, aggregated: true };
    }

    return { processed, aggregated: false };
  } catch (error) {
    console.error('Comprehensive background trade analysis error:', error);
    return { processed: 0, aggregated: false };
  }
}
