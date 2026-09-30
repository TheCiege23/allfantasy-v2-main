import { prisma } from './prisma';
import { findPlayerBySleeperId, findPlayerByName, getPickValue, FantasyCalcPlayer } from './fantasycalc';
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db';

/*
 * 🛑 MARKET VALUES ONLY (2026-09-30, owner's ruling). Every value here is FantasyCalc's — the market
 * path, which is the authoritative value. This module used to price each player at
 * `dynastyScore || fantasyCalcValue || 200`: the dynasty-tiers score FIRST, which is ruled not
 * authoritative, and a flat 200 for anyone FantasyCalc did not know, which is an invented number.
 * Now a trade with any player FantasyCalc cannot match is marked analyzed with NO values rather
 * than priced by a guess, and no dynasty-tier figure is stored or written into the text the AI reads.
 */

/** "Elite" by market: FantasyCalc overall rank at or above this. Replaces the dynasty tier-1 test. */
const ELITE_OVERALL_RANK = 24;

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
  playersWithEnrichment: Array<{
    name: string;
    position: string;
    fantasyCalcValue: number;
    overallRank: number | null;
    age: number | null;
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

function getPlayerAge(player: FantasyCalcPlayer | null): number | null {
  return player?.player?.maybeAge || null;
}

export async function collectTradeMarketFacts(
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
    // FantasyCalc prices NFL only; any other sport has no market value to read.
    if (String(trade.sport ?? 'nfl').toLowerCase() !== 'nfl') return null;

    const isDynasty = trade.leagueFormat === 'dynasty' || trade.leagueFormat === 'keeper';
    const isSF = trade.isSuperFlex === true;
    const numQbs: 1 | 2 = isSF ? 2 : 1;

    const fantasyCalcPlayers = await getCachedFantasyCalcValues(isDynasty, numQbs);

    const playersWithEnrichment: EnhancedTradeAnalysis['playersWithEnrichment'] = [];
    const valueOf = new Map<TradePlayer, number>();

    for (const player of [...playersGiven, ...playersReceived]) {
      const fcPlayer = findPlayerBySleeperId(fantasyCalcPlayers, player.id) ||
                       findPlayerByName(fantasyCalcPlayers, player.name);
      // No market value is not a value of 200. Refuse the whole trade rather than price it by a guess.
      if (!fcPlayer || !(fcPlayer.value > 0)) return null;

      valueOf.set(player, fcPlayer.value);
      playersWithEnrichment.push({
        name: player.name,
        position: player.position,
        fantasyCalcValue: fcPlayer.value,
        overallRank: Number.isFinite(fcPlayer.overallRank) ? fcPlayer.overallRank : null,
        age: getPlayerAge(fcPlayer),
      });
    }

    const getPlayerValue = (player: TradePlayer): number => valueOf.get(player) ?? 0;

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

    const hasElite = playersWithEnrichment.some(p => p.overallRank !== null && p.overallRank <= ELITE_OVERALL_RANK);

    return {
      valueGiven,
      valueReceived,
      valueDifferential,
      percentDiff,
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

export type TradeProcessingSummary = {
  /** Unanalyzed trades read this pass. */
  examined: number;
  /** Given market values and marked analyzed. */
  valued: number;
  /** Marked analyzed with NO values: an unmatched player, a non-NFL sport, or an empty side. */
  refused: number;
  /** Skipped because another pass held the lock. */
  locked: boolean;
};

export async function processAllHistoricalTrades(
  limit: number = 100,
  opts: { isExhausted?: () => boolean } = {},
): Promise<TradeProcessingSummary> {
  const summary: TradeProcessingSummary = { examined: 0, valued: 0, refused: 0, locked: false };
  const hasLock = await acquireComprehensiveLock();
  if (!hasLock) {
    console.log('Comprehensive trade analysis already in progress');
    return { ...summary, locked: true };
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
      return summary;
    }

    console.log(`Processing ${trades.length} trades from all years...`);

    for (const trade of trades) {
      if (opts.isExhausted?.()) break;
      summary.examined++;
      try {
        const analysis = await collectTradeMarketFacts({
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
              playerAgeData: Object.keys(playerAgeData).length > 0 ? playerAgeData : undefined,
              analysisResult: {
                percentDiff: analysis.percentDiff,
                consolidationType: analysis.consolidationType,
                involvesPicks: analysis.involvesPicks,
                involvesEliteAsset: analysis.involvesEliteAsset,
                playersWithEnrichment: analysis.playersWithEnrichment,
              },
            },
          });
          summary.valued++;
        } else {
          await prisma.leagueTrade.update({
            where: { id: trade.id },
            data: { analyzed: true },
          });
          summary.refused++;
        }
      } catch (error) {
        console.error(`Error processing trade ${trade.id}:`, error);
      }
    }

    return summary;
  } finally {
    await releaseComprehensiveLock();
  }
}

interface AggregatedPlayerData {
  name: string;
  position: string;
  tradeCount: number;
  avgValue: number;
  /** Mean |value gap| between the two sides, in percent, across his trades. */
  avgGapPct: number;
  avgAge: number | null;
}

interface ConsolidationStats {
  '2-for-1': { count: number; totalPremium: number };
  '3-for-1': { count: number; totalPremium: number };
}

interface PositionTrend {
  position: string;
  avgValue: number;
  tradeVolume: number;
  avgGapPct: number;
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
      // A refused trade (no market value for someone in it) is analyzed but carries no values.
      valueGiven: { not: null },
    },
    select: {
      season: true,
      platform: true,
      sport: true,
      valueGiven: true,
      valueReceived: true,
      valueDifferential: true,
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
    '2-for-1': { count: 0, totalPremium: 0 },
    '3-for-1': { count: 0, totalPremium: 0 },
  };
  const positionStats = new Map<string, { totalValue: number; count: number; totalGap: number }>();
  const ageCurveStats = new Map<string, { totalValue: number; count: number }>();
  const seasonStats = new Map<number, { count: number; totalValue: number }>();

  for (const trade of allAnalyzedTrades) {
    const result = trade.analysisResult as {
      percentDiff?: number;
      consolidationType?: string;
      playersWithEnrichment?: Array<{
        name: string;
        position: string;
        fantasyCalcValue: number;
        age: number | null;
      }>;
    } | null;

    if (!result?.playersWithEnrichment) continue;

    // The value gap between the sides, in percent: a fact. Whether that is "fair" is the engine's call.
    const percentDiff = Math.abs(result.percentDiff || 0);

    if (result.consolidationType === '2-for-1') {
      consolidationStats['2-for-1'].count++;
      consolidationStats['2-for-1'].totalPremium += percentDiff;
    } else if (result.consolidationType === '3-for-1') {
      consolidationStats['3-for-1'].count++;
      consolidationStats['3-for-1'].totalPremium += percentDiff;
    }

    const seasonStat = seasonStats.get(trade.season) || { count: 0, totalValue: 0 };
    seasonStat.count++;
    seasonStat.totalValue += (trade.valueGiven || 0) + (trade.valueReceived || 0);
    seasonStats.set(trade.season, seasonStat);

    for (const player of result.playersWithEnrichment) {
      const key = player.name.toLowerCase();
      const existing = playerStats.get(key) || {
        name: player.name,
        position: player.position,
        tradeCount: 0,
        avgValue: 0,
        avgGapPct: 0,
        avgAge: null,
      };

      existing.tradeCount++;
      existing.avgValue = ((existing.avgValue * (existing.tradeCount - 1)) + player.fantasyCalcValue) / existing.tradeCount;
      existing.avgGapPct = ((existing.avgGapPct * (existing.tradeCount - 1)) + percentDiff) / existing.tradeCount;
      if (player.age) {
        if (existing.avgAge === null) {
          existing.avgAge = player.age;
        } else {
          existing.avgAge = (existing.avgAge * (existing.tradeCount - 1) + player.age) / existing.tradeCount;
        }
      }
      playerStats.set(key, existing);

      const posStat = positionStats.get(player.position) || { totalValue: 0, count: 0, totalGap: 0 };
      posStat.totalValue += player.fantasyCalcValue;
      posStat.count++;
      posStat.totalGap += percentDiff;
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
    const confidenceScore = Math.min(1, player.tradeCount / 20);

    // Facts only (owner's facts-vs-labels ruling): no `fair_valued` / `dynasty_premium` style label.
    // The old labels compared against the dynasty-tiers score, which is ruled not authoritative.

    const insightText = `${player.name} (${player.position}): Traded ${player.tradeCount}x, avg market value ` +
      `${Math.round(player.avgValue)}, avg value gap between sides ${Math.round(player.avgGapPct)}%.`;

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
      avgValueReceived: null,
      winRate: null,
      marketTrend: null,
      confidenceScore,
      insightText,
      examples: { avgAge: player.avgAge },
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
    const avgGapPct = stat.totalGap / stat.count;

    const insightText = `${position}: ${stat.count} trades, avg market value ${Math.round(avgValue)}, ` +
      `avg value gap between sides ${Math.round(avgGapPct)}%.`;

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
          avgValueReceived: null,
          winRate: null,
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
          avgValueReceived: null,
          winRate: null,
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

  const twoForOneAvgPremium = consolidationStats['2-for-1'].count > 0
    ? Math.round(consolidationStats['2-for-1'].totalPremium / consolidationStats['2-for-1'].count)
    : 0;
  const threeForOneAvgPremium = consolidationStats['3-for-1'].count > 0
    ? Math.round(consolidationStats['3-for-1'].totalPremium / consolidationStats['3-for-1'].count)
    : 0;

  const consolidationInsightText = `2-for-1: avg value gap ${twoForOneAvgPremium}% (n=${consolidationStats['2-for-1'].count}). ` +
    `3-for-1: avg value gap ${threeForOneAvgPremium}% (n=${consolidationStats['3-for-1'].count}).`;

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
            tradeVolume: stat.count,
            avgGapPct: Math.round(stat.totalGap / stat.count),
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
            tradeVolume: stat.count,
            avgGapPct: Math.round(stat.totalGap / stat.count),
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

/** Re-aggregate at most this often while a backlog is draining — it reads every valued trade. */
const AGGREGATE_EVERY_MS = 6 * 60 * 60 * 1000;

export type TradeLearningPassResult = TradeProcessingSummary & {
  /** Unanalyzed trades left after this pass; null if the count could not be read. */
  remaining: number | null;
  aggregated: boolean;
  /** Why aggregation did not run this pass, when it did not. */
  aggregateSkipped: string | null;
  error: string | null;
};

/**
 * One bounded pass of the trade-learning writer, scheduled on /api/cron/reap-sync-runs (hourly).
 *
 * ⚠ NOTHING CALLED THIS UNTIL 2026-09-30, and it is the ONLY writer of `TradeLearningInsight`:
 * measured then, 25,970 NFL `LeagueTrade` rows were all `analyzed: false` and the insight table had
 * zero rows, while four live paths (`/api/ai/waiver`, the legacy waiver analyze route,
 * `ai-gm-intelligence`, `trade-pre-analysis`) read `getComprehensiveLearningContext` and silently got
 * an empty string. A reader pointed at a table nothing refreshes fails silently and looks correct.
 *
 * Bounded by `budgetMs`: trades are processed newest-first until 60% of the budget is spent, and
 * aggregation (which reads every valued trade) runs only when something new was valued AND either the
 * backlog is empty or the last aggregation is older than six hours, with budget to spare.
 */
export async function runComprehensiveBackgroundAnalysis(
  opts: { budgetMs?: number; batchSize?: number; now?: () => number } = {},
): Promise<TradeLearningPassResult> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const budgetMs = Math.max(0, opts.budgetMs ?? 60_000);
  const result: TradeLearningPassResult = {
    examined: 0,
    valued: 0,
    refused: 0,
    locked: false,
    remaining: null,
    aggregated: false,
    aggregateSkipped: null,
    error: null,
  };
  try {
    const summary = await processAllHistoricalTrades(opts.batchSize ?? 500, {
      isExhausted: () => now() - startedAt >= budgetMs * 0.6,
    });
    Object.assign(result, summary);
    result.remaining = await prisma.leagueTrade.count({ where: { analyzed: false } }).catch(() => null);

    if (summary.valued === 0) {
      result.aggregateSkipped = 'nothing new was valued';
    } else if (now() - startedAt >= budgetMs * 0.75) {
      result.aggregateSkipped = 'budget spent';
    } else {
      const stats = await prisma.tradeLearningStats
        .findUnique({ where: { season: 0 }, select: { lastUpdated: true } })
        .catch(() => null);
      const stale = !stats || now() - stats.lastUpdated.getTime() >= AGGREGATE_EVERY_MS;
      if (result.remaining === 0 || stale) {
        await aggregateComprehensiveInsights();
        result.aggregated = true;
      } else {
        result.aggregateSkipped = 'aggregated within the last 6h and the backlog is still draining';
      }
    }
    return result;
  } catch (error) {
    console.error('Comprehensive background trade analysis error:', error);
    return { ...result, error: error instanceof Error ? error.message.slice(0, 160) : 'the pass failed' };
  }
}
