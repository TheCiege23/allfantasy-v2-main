import { prisma } from './prisma';
import { findPlayerByName, FantasyCalcPlayer } from './fantasycalc';
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db';
import {
  calculateDynastyScore,
  findPlayerTier,
  ALL_TIERED_PLAYERS,
  AssetTier,
} from './dynasty-tiers';
import { fetchPlayerNewsFromGrok } from './ai-gm-intelligence';
import OpenAI from 'openai';

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!openai) {
    openai = new OpenAI({
      apiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });
  }
  return openai;
}

export interface UserTradingProfile {
  userId: string;
  sleeperUsername: string;
  totalTrades: number;
  tradingStyle: {
    youthVsProduction: number;
    consolidationVsDepth: number;
    picksVsPlayers: number;
    riskTolerance: number;
  };
  positionPreferences: {
    position: string;
    acquired: number;
    traded: number;
    netAcquired: number;
  }[];
  favoriteTradePartners: {
    managerId: string;
    managerName: string;
    tradeCount: number;
  }[];
  avgTradeValue: number;
  preferredTierRange: { min: number; max: number };
  winRate: number;
  recentTrends: {
    lastTradeDate: Date | null;
    tradesLast30Days: number;
    tradesLast90Days: number;
  };
}

export interface SmartTradeRecommendation {
  id: string;
  tradeType: 'acquire' | 'sell' | 'swap';
  confidence: number;
  reason: string;
  playerToAcquire?: {
    name: string;
    position: string;
    team: string;
    value: number;
    tier: AssetTier | null;
    whyGoodFit: string;
  };
  playerToTrade?: {
    name: string;
    position: string;
    team: string;
    value: number;
    tier: AssetTier | null;
    whySellNow: string;
  };
  valueMatch: {
    differential: number;
    fairnessScore: number;
  };
  basedOn: string[];
  suggestedTargetManagers?: string[];
}

export interface SmartRecommendationsResult {
  recommendations: SmartTradeRecommendation[];
  userProfile: UserTradingProfile;
  marketInsights: {
    hotPlayers: string[];
    undervaluedPositions: string[];
    overvaluedPositions: string[];
  };
  generatedAt: Date;
}

export async function analyzeUserTradingProfile(
  sleeperUsername: string
): Promise<UserTradingProfile | null> {
  const user = await prisma.legacyUser.findUnique({
    where: { sleeperUsername },
  });

  if (!user) return null;

  const tradeHistories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperUsername },
    select: { id: true },
  });

  if (tradeHistories.length === 0) {
    return {
      userId: user.id,
      sleeperUsername,
      totalTrades: 0,
      tradingStyle: {
        youthVsProduction: 0,
        consolidationVsDepth: 0,
        picksVsPlayers: 0,
        riskTolerance: 0,
      },
      positionPreferences: [],
      favoriteTradePartners: [],
      avgTradeValue: 0,
      preferredTierRange: { min: 0, max: 4 },
      winRate: 0,
      recentTrends: {
        lastTradeDate: null,
        tradesLast30Days: 0,
        tradesLast90Days: 0,
      },
    };
  }

  const historyIds = tradeHistories.map(h => h.id);
  const trades = await prisma.leagueTrade.findMany({
    where: { historyId: { in: historyIds } },
    orderBy: { createdAt: 'desc' },
  });

  if (trades.length === 0) {
    return {
      userId: user.id,
      sleeperUsername,
      totalTrades: 0,
      tradingStyle: {
        youthVsProduction: 0,
        consolidationVsDepth: 0,
        picksVsPlayers: 0,
        riskTolerance: 0,
      },
      positionPreferences: [],
      favoriteTradePartners: [],
      avgTradeValue: 0,
      preferredTierRange: { min: 0, max: 4 },
      winRate: 0,
      recentTrends: {
        lastTradeDate: null,
        tradesLast30Days: 0,
        tradesLast90Days: 0,
      },
    };
  }

  const positionStats: Map<string, { acquired: number; traded: number }> = new Map();
  const partnerStats: Map<string, { name: string; count: number }> = new Map();
  let totalValueGiven = 0;
  let totalValueReceived = 0;
  let consolidationScore = 0;
  let picksVsPlayersScore = 0;
  let youthScore = 0;
  let tiersEncountered: number[] = [];
  let wins = 0;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  let tradesLast30Days = 0;
  let tradesLast90Days = 0;

  for (const trade of trades) {
    const playersGiven = (trade.playersGiven as Array<{ name: string; position: string }>) || [];
    const playersReceived = (trade.playersReceived as Array<{ name: string; position: string }>) || [];
    const picksGiven = (trade.picksGiven as Array<{ round: number; season: number }>) || [];
    const picksReceived = (trade.picksReceived as Array<{ round: number; season: number }>) || [];

    for (const p of playersReceived) {
      const stat = positionStats.get(p.position) || { acquired: 0, traded: 0 };
      stat.acquired++;
      positionStats.set(p.position, stat);

      const tieredPlayer = ALL_TIERED_PLAYERS.find(tp => 
        tp.name.toLowerCase() === p.name.toLowerCase()
      );
      if (tieredPlayer) {
        tiersEncountered.push(tieredPlayer.tier);
        if (tieredPlayer.age && tieredPlayer.age < 26) youthScore++;
      }
    }

    for (const p of playersGiven) {
      const stat = positionStats.get(p.position) || { acquired: 0, traded: 0 };
      stat.traded++;
      positionStats.set(p.position, stat);

      const tieredPlayer = ALL_TIERED_PLAYERS.find(tp => 
        tp.name.toLowerCase() === p.name.toLowerCase()
      );
      if (tieredPlayer && tieredPlayer.age && tieredPlayer.age >= 28) youthScore++;
    }

    if (playersReceived.length < playersGiven.length) consolidationScore++;
    if (playersReceived.length > playersGiven.length) consolidationScore--;

    if (picksReceived.length > picksGiven.length) picksVsPlayersScore++;
    if (picksGiven.length > picksReceived.length) picksVsPlayersScore--;

    if (trade.partnerRosterId && trade.partnerName) {
      const partnerId = String(trade.partnerRosterId);
      const existing = partnerStats.get(partnerId) || { name: trade.partnerName, count: 0 };
      existing.count++;
      partnerStats.set(partnerId, existing);
    }

    const vDiff = trade.valueDifferential as number | null;
    if (vDiff !== null) {
      if (vDiff > 0) wins++;
    }

    totalValueGiven += trade.valueGiven || 0;
    totalValueReceived += trade.valueReceived || 0;

    const tradeDate = trade.createdAt;
    if (tradeDate) {
      if (tradeDate >= thirtyDaysAgo) tradesLast30Days++;
      if (tradeDate >= ninetyDaysAgo) tradesLast90Days++;
    }
  }

  const avgTier = tiersEncountered.length > 0 
    ? tiersEncountered.reduce((a, b) => a + b, 0) / tiersEncountered.length 
    : 2;

  const positionPreferences = Array.from(positionStats.entries())
    .map(([position, stats]) => ({
      position,
      acquired: stats.acquired,
      traded: stats.traded,
      netAcquired: stats.acquired - stats.traded,
    }))
    .sort((a, b) => b.netAcquired - a.netAcquired);

  const favoriteTradePartners = Array.from(partnerStats.entries())
    .map(([managerId, data]) => ({
      managerId,
      managerName: data.name,
      tradeCount: data.count,
    }))
    .sort((a, b) => b.tradeCount - a.tradeCount)
    .slice(0, 5);

  return {
    userId: user.id,
    sleeperUsername,
    totalTrades: trades.length,
    tradingStyle: {
      youthVsProduction: Math.round((youthScore / Math.max(trades.length, 1)) * 100),
      consolidationVsDepth: Math.round((consolidationScore / Math.max(trades.length, 1)) * 100),
      picksVsPlayers: Math.round((picksVsPlayersScore / Math.max(trades.length, 1)) * 100),
      riskTolerance: Math.round((tiersEncountered.filter(t => t <= 1).length / Math.max(tiersEncountered.length, 1)) * 100),
    },
    positionPreferences,
    favoriteTradePartners,
    avgTradeValue: trades.length > 0 ? Math.round((totalValueGiven + totalValueReceived) / (trades.length * 2)) : 0,
    preferredTierRange: { 
      min: Math.max(0, Math.floor(avgTier) - 1), 
      max: Math.min(4, Math.ceil(avgTier) + 1) 
    },
    winRate: trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0,
    recentTrends: {
      lastTradeDate: trades[0]?.tradeDate || null,
      tradesLast30Days,
      tradesLast90Days,
    },
  };
}

export async function generateSmartRecommendations(
  sleeperUsername: string,
  leagueId: string,
  userRoster: Array<{ id: string; name: string; position: string; team?: string }>,
  leagueRosters: Array<{
    managerId: string;
    managerName: string;
    players: Array<{ id: string; name: string; position: string; team?: string }>;
  }>,
  options: {
    isDynasty: boolean;
    isSuperFlex: boolean;
    sport?: 'nfl' | 'nba';
  }
): Promise<SmartRecommendationsResult> {
  const userProfile = await analyzeUserTradingProfile(sleeperUsername);
  
  if (!userProfile) {
    throw new Error('User profile not found');
  }

  const marketInsights = await getMarketInsights();
  const fcValues = await getFantasyCalcValuesDbFirst({
    isDynasty: options.isDynasty,
    numQbs: options.isSuperFlex ? 2 : 1,
    numTeams: 12,
    ppr: 1,
  });

  const platformInsights = await prisma.tradeLearningInsight.findMany({
    where: {
      season: 0,
      sampleSize: { gte: 3 },
      confidenceScore: { gte: 0.3 },
    },
    orderBy: { sampleSize: 'desc' },
    take: 100,
  });

  const globalStats = await prisma.tradeLearningStats.findUnique({
    where: { season: 0 },
  });

  if (globalStats) {
    marketInsights.totalTradesAnalyzed = globalStats.totalTradesAnalyzed;
    marketInsights.totalUsersContributing = globalStats.totalUsersContributing;
    marketInsights.positionTrends = globalStats.positionTrends as Record<string, unknown> | null;
    marketInsights.ageCurveData = globalStats.ageCurveData as Record<string, unknown> | null;
  }

  const userRosterEnriched = userRoster.map(player => {
    const fcPlayer = findPlayerByName(fcValues, player.name);
    const tieredPlayer = findPlayerTier(player.name);
    const baseValue = fcPlayer?.value || 0;
    const position = player.position || 'WR';
    const age = tieredPlayer?.age;
    const tier = tieredPlayer?.tier ?? null;
    const dynastyResult = calculateDynastyScore(baseValue, position, age, tier, options.isSuperFlex, false);
    return {
      ...player,
      value: baseValue,
      tier,
      dynastyScore: dynastyResult.score,
    };
  });

  // CRITICAL: Enrich ALL league rosters with FantasyCalc values so AI knows actual player values
  const leagueRostersEnriched = leagueRosters.map(roster => ({
    ...roster,
    players: roster.players.map(p => {
      const fcPlayer = findPlayerByName(fcValues, p.name);
      const tieredPlayer = findPlayerTier(p.name);
      return {
        ...p,
        value: fcPlayer?.value || 0,
        tier: tieredPlayer?.tier ?? null,
      };
    }).sort((a, b) => b.value - a.value), // Sort by value for clarity
  }));

  // Collect key players from user roster and league rosters for news fetching
  const allRelevantPlayers: string[] = [];
  
  // Add top players from user roster (by value)
  const topUserPlayers = [...userRosterEnriched]
    .sort((a, b) => b.value - a.value)
    .slice(0, 15)
    .map(p => p.name);
  allRelevantPlayers.push(...topUserPlayers);
  
  // Add top players from each league roster (now already enriched)
  for (const roster of leagueRostersEnriched) {
    const topPlayers = roster.players
      .slice(0, 5)
      .map(p => p.name);
    allRelevantPlayers.push(...topPlayers);
  }
  
  // Remove duplicates and limit to top 30 unique players
  const uniquePlayers = [...new Set(allRelevantPlayers)].slice(0, 30);
  
  // Fetch real-time player news from Grok/X
  let playerNews: Array<{ playerName: string; sentiment: string; news: string[]; buzz: string }> = [];
  try {
    playerNews = await fetchPlayerNewsFromGrok(
      uniquePlayers, 
      (options.sport || 'nfl') as 'nfl' | 'nba'
    );
  } catch (error) {
    console.error('Failed to fetch player news:', error);
    // Continue without news if fetch fails
  }

  const aiPrompt = buildRecommendationPrompt(
    userProfile,
    userRosterEnriched as Array<{ id: string; name: string; position: string; team?: string; value: number; tier: AssetTier | null; dynastyScore: number }>,
    leagueRostersEnriched,
    platformInsights,
    marketInsights,
    options,
    playerNews
  );

  const client = getOpenAIClient();
  if (!client) {
    return {
      recommendations: [],
      userProfile,
      marketInsights,
      generatedAt: new Date(),
    };
  }

  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: SMART_RECOMMENDATIONS_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: aiPrompt,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const response = completion.choices[0]?.message?.content;
  if (!response) {
    throw new Error('No response from AI');
  }

  let parsed;
  try {
    parsed = JSON.parse(response);
  } catch {
    throw new Error('Failed to parse AI response');
  }

  // POST-PROCESSING: Validate and filter recommendations based on actual FantasyCalc values
  const validatedRecommendations = (parsed.recommendations || [])
    .map((rec: SmartTradeRecommendation, idx: number) => {
      // Recalculate fairness using actual FantasyCalc values
      let userGivesValue = 0;
      let userReceivesValue = 0;
      
      if (rec.playerToTrade) {
        const fcPlayer = findPlayerByName(fcValues, rec.playerToTrade.name);
        userGivesValue = fcPlayer?.value || rec.playerToTrade.value || 0;
        rec.playerToTrade.value = userGivesValue; // Update with actual value
      }
      
      if (rec.playerToAcquire) {
        const fcPlayer = findPlayerByName(fcValues, rec.playerToAcquire.name);
        userReceivesValue = fcPlayer?.value || rec.playerToAcquire.value || 0;
        rec.playerToAcquire.value = userReceivesValue; // Update with actual value
      }
      
      // Calculate actual differential and fairness
      const maxValue = Math.max(userGivesValue, userReceivesValue, 1);
      const differential = userReceivesValue - userGivesValue;
      const percentDiff = Math.abs(differential) / maxValue * 100;
      const actualFairnessScore = Math.max(0, 100 - percentDiff);
      
      // Update the recommendation with accurate values
      rec.valueMatch = {
        differential,
        fairnessScore: Math.round(actualFairnessScore),
      };
      
      return { ...rec, id: `rec-${idx}`, _percentDiff: percentDiff, _actualFairness: actualFairnessScore };
    })
    // Filter out trades that are too lopsided (>25% difference)
    .filter((rec: SmartTradeRecommendation & { _percentDiff: number; _actualFairness: number }) => {
      // Allow trades within 25% value difference
      if (rec._percentDiff > 25) {
        console.log(`Filtered out unfair trade: ${rec.playerToTrade?.name} for ${rec.playerToAcquire?.name}, ${rec._percentDiff.toFixed(1)}% difference`);
        return false;
      }
      return true;
    })
    .slice(0, 5)
    .map((rec: SmartTradeRecommendation & { _percentDiff?: number; _actualFairness?: number }) => {
      // Remove internal fields
      const { _percentDiff, _actualFairness, ...cleanRec } = rec;
      return cleanRec;
    });

  return {
    recommendations: validatedRecommendations,
    userProfile,
    marketInsights,
    generatedAt: new Date(),
  };
}

const SMART_RECOMMENDATIONS_SYSTEM_PROMPT = `You are the AllFantasy Smart Trade Advisor - an elite AI that provides personalized trade recommendations based on deep analysis of user trading patterns, market-wide insights, AND REAL-TIME PLAYER NEWS.

## YOUR MISSION
Generate 3-5 highly personalized trade recommendations that:
1. **CRITICALLY IMPORTANT**: ARE MATHEMATICALLY FAIR based on FantasyCalc values
2. Match the user's historical trading style and preferences
3. Improve their roster based on their team composition
4. Incorporate real-time player news (releases, injuries, performance surges)
5. Leverage insights from real trades across the platform

## ABSOLUTE VALUE MATCHING REQUIREMENTS (NON-NEGOTIABLE)
**YOU MUST FOLLOW THESE RULES OR THE TRADE WILL BE REJECTED:**

1. **Total value exchanged must be within 15% of each other**
   - If user gives 8000 value, they must receive 6800-9200 value
   - If user gives 5000 value, they must receive 4250-5750 value

2. **NEVER suggest trading elite players (Tier 0-1, value 6500+) for multiple low-value players**
   - Travis Kelce (8000+) cannot be traded for Devin Neal (1500) + Xavier Worthy (2000) = 3500 total. This is ROBBERY.
   - Christian McCaffrey (10000+) cannot be traded for Brock Bowers (5000) + Bucky Irving (2000) = 7000 total. Still too far off.
   - Cooper Kupp (6000+) + Matthew Stafford (4000) = 10000 cannot be traded for Will Shipley (2500) + Jalen McMillan (1500) = 4000. This is ROBBERY.

3. **For elite Tier 0-1 players, require elite returns:**
   - Tier 0 player (10000+ value) must return Tier 0-1 player + significant assets
   - Tier 1 player (6500-10000 value) must return Tier 1-2 player + meaningful pieces
   - NEVER trade Tier 0-1 for Tier 3-4 packages

4. **Calculate fairness score accurately:**
   - fairnessScore = 100 - percentageDifference
   - If user gives 8000 and receives 4000, that's 50% difference = fairnessScore of 50 (REJECTED)
   - Only trades with fairnessScore >= 85 should be recommended

## REAL-TIME NEWS ADJUSTMENTS
- Player released/cut: Reduce value by 50-70%
- Major injury: Reduce value by 30-50%
- Breakout performance: Increase value by 10-20%
- Depth chart promotion: Increase value by 15-25%
- News adjustments apply AFTER calculating base fairness

## RECOMMENDATION TYPES
- "acquire": Player the user should target to acquire
- "sell": Player the user should trade away (sell high, declining value, poor fit)
- "swap": Direct 1-for-1 swap recommendation

## CONFIDENCE LEVELS
- 90-100: Mathematically fair (within 10%) AND matches user style AND news supports it
- 80-89: Fair trade (within 15%) AND good style match
- 70-79: Slightly uneven (15-20% gap) but strategic value exists
- Below 70: Don't recommend - trade too uneven

## CRITICAL RULES
1. ONLY suggest players who exist on league rosters provided WITH THEIR VALUES
2. **CALCULATE TOTAL VALUES for both sides before suggesting any trade**
3. Use the user's trading profile to match their preferences
4. All trades MUST have fairnessScore >= 85 (within 15% value difference)
5. Elite players (Tier 0-1) require elite returns - no bundling depth for stars
6. Explain WHY each trade fits this specific user AND show the value math

## OUTPUT FORMAT
Return JSON:
{
  "recommendations": [
    {
      "tradeType": "acquire" | "sell" | "swap",
      "confidence": number (60-100),
      "reason": "Why this trade makes sense for THIS user specifically",
      "playerToAcquire": {
        "name": "Player Name",
        "position": "QB/RB/WR/TE",
        "team": "NFL Team",
        "value": number,
        "tier": 0-4 or null,
        "whyGoodFit": "Specific reason this player fits user's roster and style"
      },
      "playerToTrade": {
        "name": "Player Name",
        "position": "QB/RB/WR/TE",
        "team": "NFL Team",
        "value": number,
        "tier": 0-4 or null,
        "whySellNow": "Specific reason to sell now"
      },
      "valueMatch": {
        "differential": number (positive = user wins),
        "fairnessScore": number (0-100, 100 = perfectly fair)
      },
      "basedOn": ["List of insights/data points this recommendation is based on"],
      "suggestedTargetManagers": ["Manager names who might accept this trade"]
    }
  ]
}`;

interface ExtendedMarketInsights {
  hotPlayers: string[];
  undervaluedPositions: string[];
  overvaluedPositions: string[];
  totalTradesAnalyzed?: number;
  totalUsersContributing?: number;
  positionTrends?: Record<string, unknown> | null;
  ageCurveData?: Record<string, unknown> | null;
}

function buildRecommendationPrompt(
  profile: UserTradingProfile,
  userRoster: Array<{ id: string; name: string; position: string; team?: string; value: number; tier: AssetTier | null; dynastyScore: number }>,
  leagueRosters: Array<{
    managerId: string;
    managerName: string;
    players: Array<{ id: string; name: string; position: string; team?: string; value: number; tier: AssetTier | null }>;
  }>,
  platformInsights: Array<{ insightType: string; playerName: string | null; insightText: string | null }>,
  marketInsights: ExtendedMarketInsights,
  options: { isDynasty: boolean; isSuperFlex: boolean; sport?: string },
  playerNews: Array<{ playerName: string; sentiment: string; news: string[]; buzz: string }> = []
): string {
  const sections: string[] = [];

  sections.push(`## USER TRADING PROFILE
Username: ${profile.sleeperUsername}
Total Lifetime Trades: ${profile.totalTrades}
Win Rate: ${profile.winRate}%
Average Trade Value: ${profile.avgTradeValue}

### Trading Style (higher = stronger preference):
- Youth vs Production: ${profile.tradingStyle.youthVsProduction}% (positive = prefers young players)
- Consolidation vs Depth: ${profile.tradingStyle.consolidationVsDepth}% (positive = prefers fewer, better players)
- Picks vs Players: ${profile.tradingStyle.picksVsPlayers}% (positive = acquires picks)
- Risk Tolerance: ${profile.tradingStyle.riskTolerance}% (positive = trades for elite/risky assets)

### Position Preferences (net acquired):
${profile.positionPreferences.slice(0, 5).map(p => `- ${p.position}: ${p.netAcquired > 0 ? '+' : ''}${p.netAcquired} (acquired ${p.acquired}, traded ${p.traded})`).join('\n')}

### Favorite Trade Partners:
${profile.favoriteTradePartners.map(p => `- ${p.managerName}: ${p.tradeCount} trades`).join('\n') || 'No frequent trade partners yet'}

### Recent Activity:
- Trades last 30 days: ${profile.recentTrends.tradesLast30Days}
- Trades last 90 days: ${profile.recentTrends.tradesLast90Days}`);

  sections.push(`## USER'S CURRENT ROSTER (${userRoster.length} players)
${userRoster.slice(0, 30).map(p => `- ${p.name} (${p.position}, ${p.team || 'FA'}) - Value: ${p.value}, Tier: ${p.tier ?? 'N/A'}, Dynasty Score: ${p.dynastyScore}`).join('\n')}`);

  sections.push(`## LEAGUE ROSTERS WITH FANTASYCALC VALUES (potential trade partners)
**CRITICAL: Use these values to ensure fair trades. Total value given must be within 15% of total value received.**

${leagueRosters.map(roster => {
    const topPlayers = roster.players.slice(0, 15);
    return `### ${roster.managerName}:
${topPlayers.map(p => `- ${p.name} (${p.position}) - Value: ${p.value}${p.tier !== null ? `, Tier ${p.tier}` : ''}`).join('\n')}`;
  }).join('\n\n')}`);

  const globalContext = marketInsights.totalTradesAnalyzed 
    ? `(aggregated from ${marketInsights.totalTradesAnalyzed} real trades from ${marketInsights.totalUsersContributing} users across all seasons and platforms)`
    : `(from ${platformInsights.length} data points)`;

  sections.push(`## PLATFORM-WIDE MARKET INSIGHTS ${globalContext}
### Hot Players (being acquired frequently):
${marketInsights.hotPlayers.slice(0, 10).join(', ') || 'No data'}

### Position Market Trends:
- Undervalued: ${marketInsights.undervaluedPositions.join(', ') || 'None identified'}
- Overvalued: ${marketInsights.overvaluedPositions.join(', ') || 'None identified'}

### Key Player Insights (from AI learning):
${platformInsights.filter(i => i.playerName && i.insightText).slice(0, 15).map(i => `- ${i.insightText}`).join('\n') || 'No player-specific insights yet'}

### Age Curve Patterns:
${marketInsights.ageCurveData ? JSON.stringify(marketInsights.ageCurveData).slice(0, 500) : 'No age curve data yet'}`);

  // Add real-time player news section (CRITICAL for accurate valuations)
  if (playerNews && playerNews.length > 0) {
    const newsWithContent = playerNews.filter(p => p.news.length > 0 || p.buzz);
    if (newsWithContent.length > 0) {
      sections.push(`## CRITICAL: REAL-TIME PLAYER NEWS (Last 7 Days from X/Twitter)
**THIS INFORMATION SUPERSEDES STATIC MARKET VALUES. Adjust recommendations accordingly.**

${newsWithContent.slice(0, 20).map(p => {
        const sentimentEmoji = p.sentiment === 'bullish' ? '📈' : 
                               p.sentiment === 'bearish' ? '📉' : 
                               p.sentiment === 'injury_concern' ? '🚑' : '➡️';
        return `### ${p.playerName} ${sentimentEmoji} (${p.sentiment.toUpperCase()})
${p.news.slice(0, 3).map(n => `- ${n}`).join('\n')}
${p.buzz ? `Social Buzz: ${p.buzz}` : ''}`;
      }).join('\n\n')}`);
    }
  }

  sections.push(`## LEAGUE SETTINGS
- Format: ${options.isDynasty ? 'Dynasty' : 'Redraft'}
- Superflex: ${options.isSuperFlex ? 'Yes' : 'No'}
- Sport: ${options.sport?.toUpperCase() || 'NFL'}

## TASK
Generate 3-5 personalized trade recommendations for this user. Focus on:
1. **REAL-TIME NEWS FIRST**: Incorporate any breaking news about player releases, injuries, depth chart changes, or performance surges
2. Players that match their historical position preferences
3. Trade structures that match their consolidation/depth preference
4. Value opportunities from platform insights and news
5. Realistic trades with managers in their league

**IMPORTANT**: If a player was recently released, cut, injured, or had a major situational change - this MUST be reflected in your recommendations. Do NOT suggest acquiring players who were just released or have major red flags without acknowledging this.`);

  return sections.join('\n\n');
}

async function getMarketInsights(): Promise<ExtendedMarketInsights> {
  const recentTrades = await prisma.leagueTrade.findMany({
    where: {
      tradeDate: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      analyzed: true,
    },
    orderBy: { tradeDate: 'desc' },
    take: 500,
  });

  const playerAcquisitions: Map<string, number> = new Map();
  const positionFairness: Map<string, { fair: number; total: number }> = new Map();

  for (const trade of recentTrades) {
    const playersReceived = (trade.playersReceived as Array<{ name: string; position: string }>) || [];
    const isFair = Math.abs((trade.valueDifferential as number) || 0) < 500;

    for (const p of playersReceived) {
      playerAcquisitions.set(p.name, (playerAcquisitions.get(p.name) || 0) + 1);
      
      const posStat = positionFairness.get(p.position) || { fair: 0, total: 0 };
      posStat.total++;
      if (isFair) posStat.fair++;
      positionFairness.set(p.position, posStat);
    }
  }

  const hotPlayers = Array.from(playerAcquisitions.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name]) => name);

  const positionRates = Array.from(positionFairness.entries())
    .map(([pos, stats]) => ({
      position: pos,
      fairRate: stats.total > 0 ? stats.fair / stats.total : 0.5,
    }));

  const avgFairRate = positionRates.reduce((sum, p) => sum + p.fairRate, 0) / Math.max(positionRates.length, 1);

  return {
    hotPlayers,
    undervaluedPositions: positionRates.filter(p => p.fairRate < avgFairRate - 0.1).map(p => p.position),
    overvaluedPositions: positionRates.filter(p => p.fairRate > avgFairRate + 0.1).map(p => p.position),
  };
}

export async function getQuickRecommendationsForUser(
  sleeperUsername: string
): Promise<{ hasRecommendations: boolean; profile: UserTradingProfile | null; recommendationCount: number }> {
  const profile = await analyzeUserTradingProfile(sleeperUsername);
  
  if (!profile || profile.totalTrades < 3) {
    return { hasRecommendations: false, profile, recommendationCount: 0 };
  }

  return { 
    hasRecommendations: true, 
    profile, 
    recommendationCount: Math.min(5, Math.floor(profile.totalTrades / 5) + 2),
  };
}
