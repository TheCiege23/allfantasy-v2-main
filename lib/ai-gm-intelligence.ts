import { prisma } from './prisma';
import { X_SEARCH_ALLOWED_HANDLES } from '@/lib/news/beatReporterHandles'
import { xaiChatJson, parseTextFromXaiChatCompletion } from './xai-client';
import { 
  fetchFantasyCalcValues, 
  findPlayerByName,
  getPickValue,
  FantasyCalcPlayer 
} from './fantasycalc';
import {
  calculateDynastyScore,
  findPlayerTier,
  ALL_TIERED_PLAYERS,
  AssetTier,
} from './dynasty-tiers';
import { getComprehensiveLearningContext } from './comprehensive-trade-learning';
import { getLeagueRosters, getLeagueUsers as getSleeperLeagueUsers } from './sleeper-client';
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

export interface TradeParty {
  rosterId: number;
  managerId: string;
  managerName: string;
  players: Array<{ id: string; name: string; position: string }>;
  picks: Array<{ season: number; round: number; originalOwner?: number }>;
}

export interface ComprehensiveTradeContext {
  leagueId: string;
  leagueName: string;
  leagueSettings: {
    isDynasty: boolean;
    isSuperFlex: boolean;
    isTeePremium: boolean;
    scoringType: string;
    rosterPositions: string[];
    teamCount: number;
  };
  userParty: TradeParty;
  otherParties: TradeParty[];
  userTradingProfile: {
    totalTrades: number;
    winRate: number;
    tradingStyle: {
      youthVsProduction: number;
      consolidationVsDepth: number;
      picksVsPlayers: number;
    };
    positionPreferences: Array<{ position: string; netAcquired: number }>;
    recentSimilarTrades: Array<{
      date: string;
      playersGiven: string[];
      playersReceived: string[];
      outcome: string;
    }>;
  };
  otherManagerProfiles: Array<{
    managerId: string;
    managerName: string;
    hasUsedLegacy: boolean;
    tradingPreferences?: {
      prefersYouth: boolean;
      prefersDepth: boolean;
      favoritePositions: string[];
    };
    teamSituation: 'contender' | 'rebuilding' | 'middle';
    recentTradeActivity: number;
  }>;
  playerNewsAndSentiment: Array<{
    playerName: string;
    sentiment: 'bullish' | 'bearish' | 'neutral' | 'injury_concern';
    recentNews: string[];
    socialBuzz: string;
  }>;
  realWorldTeamContext: Array<{
    nflTeam: string;
    situation: string;
    coachStyle: string;
    teamOutlook: string;
  }>;
  marketValues: {
    playersGiven: Array<{ name: string; value: number; tier: AssetTier | null; dynastyScore: number }>;
    playersReceived: Array<{ name: string; value: number; tier: AssetTier | null; dynastyScore: number }>;
    picksGiven: Array<{ pick: string; value: number }>;
    picksReceived: Array<{ pick: string; value: number }>;
  };
  platformInsights: string;
}

export interface AIGMAnalysis {
  verdict: 'accept' | 'decline' | 'counter' | 'needs_negotiation';
  confidence: number;
  summary: string;
  detailedAnalysis: {
    valueAssessment: {
      valueGiven: number;
      valueReceived: number;
      differential: number;
      fairnessScore: number;
    };
    fitAnalysis: {
      fitsUserStyle: boolean;
      styleMatchScore: number;
      reasoning: string;
    };
    rosterImpact: {
      strengthensPositions: string[];
      weakensPositions: string[];
      overallImpact: 'positive' | 'negative' | 'neutral';
    };
    timingFactors: {
      playerNewsImpact: string;
      marketTiming: string;
      seasonalConsiderations: string;
    };
  };
  similarPastTrades: Array<{
    date: string;
    description: string;
    outcome: string;
    relevance: string;
  }>;
  counterOfferSuggestion?: {
    adjustments: string[];
    reasoning: string;
    expectedAcceptance: number;
  };
  alternativeTargets?: Array<{
    managerName: string;
    reasoning: string;
    suggestedApproach: string;
    likelyToAccept: boolean;
  }>;
  keyInsights: string[];
  warnings: string[];
}

export async function fetchPlayerNewsFromGrok(
  playerNames: string[],
  sport: 'nfl' | 'nba' = 'nfl'
): Promise<Array<{ playerName: string; sentiment: string; news: string[]; buzz: string }>> {
  if (playerNames.length === 0) return [];

  // Calculate date 7 days ago for x_search
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fromDate = sevenDaysAgo.toISOString().split('T')[0];

  const prompt = `Use X/Twitter search to find the LATEST news and updates for these ${sport.toUpperCase()} players: ${playerNames.join(', ')}.

CRITICAL: Look for:
- Player RELEASES, CUTS, or WAIVED news (major red flags!)
- Injuries and injury updates
- Depth chart changes (promoted/demoted)
- Breakout performances or playoff surges
- Contract extensions or trades
- Coaching changes affecting players
- Target share or snap count trends

For each player, provide:
1. Current sentiment (bullish/bearish/neutral/injury_concern)
2. Key recent news from the last 7 days
3. Social media buzz summary

Return JSON array:
[{
  "playerName": "Name",
  "sentiment": "bullish|bearish|neutral|injury_concern",
  "news": ["news item 1", "news item 2"],
  "buzz": "brief social media sentiment summary"
}]

IMPORTANT: If a player was RELEASED or CUT, sentiment MUST be "bearish" and this MUST be the first news item.`;

  const result = await xaiChatJson({
    messages: [
      { role: 'system', content: 'You are a fantasy sports news aggregator. Use x_search to find real-time player news from X/Twitter. Return only valid JSON. Focus on player releases, injuries, and performance updates.' },
      { role: 'user', content: prompt },
    ],
    model: 'grok-4-fast-non-reasoning',
    temperature: 0.3,
    maxTokens: 2000,
    tools: [
      {
        /*
         * ⚠ WITHOUT allowed_x_handles THIS SEARCHES ALL OF X. Whatever the
         * platform surfaces for a player's name becomes input to a model that
         * reports injury status and sentiment back into trade recommendations
         * and draft picks. Fake beat-writer accounts are a fixture of NFL news;
         * an unfiltered search is how one moves a manager's lineup.
         */
        type: 'x_search',
        from_date: fromDate,
        allowed_x_handles: X_SEARCH_ALLOWED_HANDLES,
      },
      {
        type: 'web_search',
        user_location_country: 'US',
      },
    ],
  });

  if (!result.ok) {
    console.error('Grok news fetch failed:', result.details);
    return playerNames.map(name => ({
      playerName: name,
      sentiment: 'neutral',
      news: ['No recent news available'],
      buzz: 'Unable to fetch social sentiment',
    }));
  }

  try {
    const text = parseTextFromXaiChatCompletion(result.json);
    if (!text) return [];
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return playerNames.map(name => ({
      playerName: name,
      sentiment: 'neutral',
      news: [],
      buzz: '',
    }));
  }
}

export async function fetchRealWorldTeamContext(
  teams: string[],
  sport: 'nfl' | 'nba' = 'nfl'
): Promise<Array<{ team: string; situation: string; coachStyle: string; outlook: string }>> {
  if (teams.length === 0) return [];

  const prompt = `For these ${sport.toUpperCase()} teams: ${teams.join(', ')}, provide current team context:

For each team:
1. Current situation (rebuilding/contending/middle)
2. Coach style (offense-first/defense-first/balanced)
3. 2025 outlook

Return JSON array:
[{
  "team": "Team Name",
  "situation": "rebuilding|contending|middle",
  "coachStyle": "offense-first|defense-first|balanced",
  "outlook": "brief outlook summary"
}]`;

  const result = await xaiChatJson({
    messages: [
      { role: 'system', content: 'You are an NFL/NBA analyst. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ],
    model: 'grok-4-fast-non-reasoning',
    temperature: 0.3,
    maxTokens: 1000,
  });

  if (!result.ok) {
    return teams.map(team => ({
      team,
      situation: 'unknown',
      coachStyle: 'balanced',
      outlook: 'No data available',
    }));
  }

  try {
    const text = parseTextFromXaiChatCompletion(result.json);
    if (!text) return [];
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return teams.map(team => ({
      team,
      situation: 'unknown',
      coachStyle: 'balanced',
      outlook: '',
    }));
  }
}

export async function getUserSimilarPastTrades(
  sleeperUsername: string,
  playersInTrade: string[]
): Promise<Array<{ date: string; playersGiven: string[]; playersReceived: string[]; outcome: string; relevance: string }>> {
  const tradeHistories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperUsername },
    select: { id: true },
  });

  if (tradeHistories.length === 0) return [];

  const historyIds = tradeHistories.map(h => h.id);
  const trades = await prisma.leagueTrade.findMany({
    where: { historyId: { in: historyIds } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const playerNamesLower = playersInTrade.map(p => p.toLowerCase());
  const relevantTrades: Array<{ date: string; playersGiven: string[]; playersReceived: string[]; outcome: string; relevance: string }> = [];

  for (const trade of trades) {
    const playersGiven = (trade.playersGiven as Array<{ name: string }>) || [];
    const playersReceived = (trade.playersReceived as Array<{ name: string }>) || [];
    
    const givenNames = playersGiven.map(p => p.name);
    const receivedNames = playersReceived.map(p => p.name);
    const allNames = [...givenNames, ...receivedNames].map(n => n.toLowerCase());

    const hasMatchingPlayer = playerNamesLower.some(p => allNames.some(n => n.includes(p) || p.includes(n)));
    
    const givenPositions = (trade.playersGiven as Array<{ position: string }>)?.map(p => p.position) || [];
    const receivedPositions = (trade.playersReceived as Array<{ position: string }>)?.map(p => p.position) || [];
    const currentPositions = playersInTrade.map(p => {
      const tiered = ALL_TIERED_PLAYERS.find(tp => tp.name.toLowerCase() === p.toLowerCase());
      return tiered?.position || '';
    });
    const hasMatchingPosition = currentPositions.some(pos => 
      givenPositions.includes(pos) || receivedPositions.includes(pos)
    );

    if (hasMatchingPlayer || hasMatchingPosition) {
      const vDiff = trade.valueDifferential as number | null;
      let outcome = 'Unknown';
      if (vDiff !== null) {
        outcome = vDiff > 200 ? 'Won' : vDiff < -200 ? 'Lost' : 'Fair';
      }

      let relevance = '';
      if (hasMatchingPlayer) relevance = 'Involved similar player';
      else if (hasMatchingPosition) relevance = 'Similar position swap';

      relevantTrades.push({
        date: trade.createdAt.toISOString().split('T')[0],
        playersGiven: givenNames,
        playersReceived: receivedNames,
        outcome,
        relevance,
      });
    }
  }

  return relevantTrades.slice(0, 5);
}

interface RosterStanding {
  ownerId: string;
  wins: number;
  losses: number;
  fpts: number;
  rank: number;
}

async function fetchLeagueRosterStandings(leagueId: string): Promise<RosterStanding[]> {
  try {
    const rosters = await getLeagueRosters(leagueId);
    if (!Array.isArray(rosters) || rosters.length === 0) return [];
    
    const standings: RosterStanding[] = rosters
      .filter((r: { owner_id?: string }) => r.owner_id)
      .map((r: { owner_id: string; settings?: { wins?: number; losses?: number; fpts?: number } }) => ({
        ownerId: r.owner_id,
        wins: r.settings?.wins || 0,
        losses: r.settings?.losses || 0,
        fpts: r.settings?.fpts || 0,
        rank: 0,
      }));
    
    standings.sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
    standings.forEach((s, i) => s.rank = i + 1);
    
    return standings;
  } catch {
    return [];
  }
}

async function fetchLeagueUsers(leagueId: string): Promise<Map<string, string>> {
  try {
    const users = await getSleeperLeagueUsers(leagueId);
    if (!Array.isArray(users) || users.length === 0) return new Map();
    
    const userMap = new Map<string, string>();
    for (const u of users) {
      userMap.set(u.user_id, u.display_name || u.username || `Manager ${u.user_id.slice(-4)}`);
    }
    return userMap;
  } catch {
    return new Map();
  }
}

export async function getManagerProfiles(
  leagueId: string,
  managerIds: string[]
): Promise<Array<{
  managerId: string;
  managerName: string;
  hasUsedLegacy: boolean;
  tradingPreferences?: { prefersYouth: boolean; prefersDepth: boolean; favoritePositions: string[] };
  teamSituation: 'contender' | 'rebuilding' | 'middle';
  recentTradeActivity: number;
}>> {
  const [standings, userMap] = await Promise.all([
    fetchLeagueRosterStandings(leagueId),
    fetchLeagueUsers(leagueId),
  ]);
  
  const totalTeams = standings.length || 12;
  const topThreshold = Math.ceil(totalTeams / 3);
  const bottomThreshold = Math.floor(totalTeams * 2 / 3);

  const profiles: Array<{
    managerId: string;
    managerName: string;
    hasUsedLegacy: boolean;
    tradingPreferences?: { prefersYouth: boolean; prefersDepth: boolean; favoritePositions: string[] };
    teamSituation: 'contender' | 'rebuilding' | 'middle';
    recentTradeActivity: number;
  }> = [];

  for (const managerId of managerIds) {
    const legacyUser = await prisma.legacyUser.findFirst({
      where: { sleeperUserId: managerId },
    });

    let tradingPreferences: { prefersYouth: boolean; prefersDepth: boolean; favoritePositions: string[] } | undefined;
    let recentTradeActivity = 0;

    if (legacyUser) {
      const tradeHistories = await prisma.leagueTradeHistory.findMany({
        where: { sleeperUsername: legacyUser.sleeperUsername },
        select: { id: true },
      });

      if (tradeHistories.length > 0) {
        const historyIds = tradeHistories.map(h => h.id);
        const recentTrades = await prisma.leagueTrade.findMany({
          where: { 
            historyId: { in: historyIds },
            createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          },
        });
        recentTradeActivity = recentTrades.length;

        let youthScore = 0;
        let depthScore = 0;
        const positionCounts: Map<string, number> = new Map();

        for (const trade of recentTrades) {
          const received = (trade.playersReceived as Array<{ name: string; position: string }>) || [];
          const given = (trade.playersGiven as Array<{ name: string; position: string }>) || [];

          for (const p of received) {
            const tiered = ALL_TIERED_PLAYERS.find(tp => tp.name.toLowerCase() === p.name.toLowerCase());
            if (tiered?.age && tiered.age < 26) youthScore++;
            positionCounts.set(p.position, (positionCounts.get(p.position) || 0) + 1);
          }

          if (received.length > given.length) depthScore++;
          if (received.length < given.length) depthScore--;
        }

        const favoritePositions = Array.from(positionCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([pos]) => pos);

        tradingPreferences = {
          prefersYouth: youthScore > 0,
          prefersDepth: depthScore > 0,
          favoritePositions,
        };
      }
    }

    const standing = standings.find(s => s.ownerId === managerId);
    let teamSituation: 'contender' | 'rebuilding' | 'middle' = 'middle';
    
    if (standing) {
      if (standing.rank <= topThreshold) {
        teamSituation = 'contender';
      } else if (standing.rank > bottomThreshold) {
        teamSituation = 'rebuilding';
      }
    }

    const managerName = userMap.get(managerId) || `Manager ${managerId.slice(-4)}`;

    profiles.push({
      managerId,
      managerName,
      hasUsedLegacy: !!legacyUser,
      tradingPreferences,
      teamSituation,
      recentTradeActivity,
    });
  }

  return profiles;
}

export async function buildComprehensiveTradeContext(
  leagueId: string,
  sleeperUsername: string,
  userParty: TradeParty,
  otherParties: TradeParty[],
  leagueSettings: ComprehensiveTradeContext['leagueSettings']
): Promise<ComprehensiveTradeContext> {
  const allPlayerNames = [
    ...userParty.players.map(p => p.name),
    ...otherParties.flatMap(op => op.players.map(p => p.name)),
  ];

  const fcValues = await fetchFantasyCalcValues({
    isDynasty: leagueSettings.isDynasty,
    numQbs: leagueSettings.isSuperFlex ? 2 : 1,
    numTeams: leagueSettings.teamCount,
    ppr: 1,
  });
  
  const allTeams = new Set<string>();
  const allPlayersWithTeams = [...userParty.players, ...otherParties.flatMap(op => op.players)];
  for (const player of allPlayersWithTeams) {
    const fcPlayer = findPlayerByName(fcValues, player.name);
    if (fcPlayer?.player?.maybeTeam) {
      allTeams.add(fcPlayer.player.maybeTeam);
    }
  }

  const [
    playerNews,
    teamContext,
    userSimilarTrades,
    managerProfiles,
    platformInsights,
  ] = await Promise.all([
    fetchPlayerNewsFromGrok(allPlayerNames),
    fetchRealWorldTeamContext(Array.from(allTeams)),
    getUserSimilarPastTrades(sleeperUsername, allPlayerNames),
    getManagerProfiles(leagueId, otherParties.map(op => op.managerId)),
    getComprehensiveLearningContext(),
  ]);

  const enrichPlayer = (player: { name: string; position: string }) => {
    const fcPlayer = findPlayerByName(fcValues, player.name);
    const tiered = findPlayerTier(player.name);
    const baseValue = fcPlayer?.value || 0;
    const dynastyResult = calculateDynastyScore(
      baseValue,
      player.position,
      tiered?.age,
      tiered?.tier ?? null,
      leagueSettings.isSuperFlex,
      leagueSettings.isTeePremium
    );
    return {
      name: player.name,
      value: baseValue,
      tier: tiered?.tier ?? null,
      dynastyScore: dynastyResult.score,
    };
  };

  const enrichPick = (pick: { season: number; round: number }) => {
    const value = getPickValue(pick.season, pick.round, leagueSettings.isDynasty);
    return {
      pick: `${pick.season} Round ${pick.round}`,
      value,
    };
  };

  const userProfile = await prisma.legacyUser.findUnique({
    where: { sleeperUsername },
  });

  let userTradingProfile: ComprehensiveTradeContext['userTradingProfile'] = {
    totalTrades: 0,
    winRate: 0,
    tradingStyle: { youthVsProduction: 0, consolidationVsDepth: 0, picksVsPlayers: 0 },
    positionPreferences: [],
    recentSimilarTrades: userSimilarTrades.map(t => ({
      date: t.date,
      playersGiven: t.playersGiven,
      playersReceived: t.playersReceived,
      outcome: t.outcome,
    })),
  };

  if (userProfile) {
    const tradeHistories = await prisma.leagueTradeHistory.findMany({
      where: { sleeperUsername },
      select: { id: true },
    });
    
    if (tradeHistories.length > 0) {
      const historyIds = tradeHistories.map(h => h.id);
      const allTrades = await prisma.leagueTrade.findMany({
        where: { historyId: { in: historyIds } },
      });

      let wins = 0;
      let youthScore = 0;
      let consolidationScore = 0;
      let picksScore = 0;
      const positionStats: Map<string, number> = new Map();

      for (const trade of allTrades) {
        const vDiff = trade.valueDifferential as number | null;
        if (vDiff !== null && vDiff > 0) wins++;

        const received = (trade.playersReceived as Array<{ name: string; position: string }>) || [];
        const given = (trade.playersGiven as Array<{ name: string; position: string }>) || [];
        const picksReceived = (trade.picksReceived as Array<unknown>) || [];
        const picksGiven = (trade.picksGiven as Array<unknown>) || [];

        for (const p of received) {
          const tiered = ALL_TIERED_PLAYERS.find(tp => tp.name.toLowerCase() === p.name.toLowerCase());
          if (tiered?.age && tiered.age < 26) youthScore++;
          positionStats.set(p.position, (positionStats.get(p.position) || 0) + 1);
        }
        for (const p of given) {
          positionStats.set(p.position, (positionStats.get(p.position) || 0) - 1);
        }

        if (received.length < given.length) consolidationScore++;
        if (received.length > given.length) consolidationScore--;
        if (picksReceived.length > picksGiven.length) picksScore++;
        if (picksGiven.length > picksReceived.length) picksScore--;
      }

      userTradingProfile = {
        totalTrades: allTrades.length,
        winRate: allTrades.length > 0 ? Math.round((wins / allTrades.length) * 100) : 0,
        tradingStyle: {
          youthVsProduction: Math.round((youthScore / Math.max(allTrades.length, 1)) * 100),
          consolidationVsDepth: Math.round((consolidationScore / Math.max(allTrades.length, 1)) * 100),
          picksVsPlayers: Math.round((picksScore / Math.max(allTrades.length, 1)) * 100),
        },
        positionPreferences: Array.from(positionStats.entries())
          .map(([position, netAcquired]) => ({ position, netAcquired }))
          .sort((a, b) => b.netAcquired - a.netAcquired),
        recentSimilarTrades: userSimilarTrades.map(t => ({
          date: t.date,
          playersGiven: t.playersGiven,
          playersReceived: t.playersReceived,
          outcome: t.outcome,
        })),
      };
    }
  }

  return {
    leagueId,
    leagueName: `League ${leagueId.slice(-6)}`,
    leagueSettings,
    userParty,
    otherParties,
    userTradingProfile,
    otherManagerProfiles: managerProfiles,
    playerNewsAndSentiment: playerNews.map(pn => ({
      playerName: pn.playerName,
      sentiment: pn.sentiment as 'bullish' | 'bearish' | 'neutral' | 'injury_concern',
      recentNews: pn.news,
      socialBuzz: pn.buzz,
    })),
    realWorldTeamContext: teamContext.map(tc => ({
      nflTeam: tc.team,
      situation: tc.situation,
      coachStyle: tc.coachStyle,
      teamOutlook: tc.outlook,
    })),
    marketValues: {
      playersGiven: userParty.players.map(enrichPlayer),
      playersReceived: otherParties.flatMap(op => op.players.map(enrichPlayer)),
      picksGiven: userParty.picks.map(enrichPick),
      picksReceived: otherParties.flatMap(op => op.picks.map(enrichPick)),
    },
    platformInsights,
  };
}

const AI_GM_SYSTEM_PROMPT = `You are the AllFantasy AI Assistant GM — an elite fantasy sports analyst who acts as the user's personal general manager and scout.

## CORE PHILOSOPHY: TRADE INTEGRITY
Trades are their own unique ecosystem in fantasy sports. They deserve respect, honesty, and integrity.

**The Golden Rule of Trading:**
In a GOOD trade, both teams walk away feeling like they gave up something valuable but already got better. It's not about "winning" or "dominating" - it's about fair exchanges that make both teams stronger in different ways.

**League Integrity Above All:**
A bad, lopsided trade can demolish an entire league. When one team is stripped of assets with no future, the league dies. You must ALWAYS consider league health before recommending or approving any trade.

**What This Means:**
- NEVER encourage trades that exploit a desperate or uninformed manager
- If a trade is heavily one-sided, be honest about it - but explain WHY it's unfair
- Suggest adjustments that make trades FAIR, not adjustments that help the user "win more"
- A fair trade where both teams improve is better than a "steal"
- Respect the other manager as a fellow fantasy enthusiast, not a mark

## YOUR ROLE
- You are the user's trusted advisor, scout, and assistant GM
- You analyze trades with the depth and insight of a professional front office
- You understand this specific user's trading history and preferences
- You consider ALL factors: player news, team situations, market timing, and personal fit
- You are HONEST and STRAIGHTFORWARD - never sugarcoat, never oversell

## ANALYSIS APPROACH
1. **Fairness Check First**: Is this trade fair? Would both managers feel good about it?
2. **Value Assessment**: Calculate fair market value using FantasyCalc data and dynasty tiers
3. **Style Fit**: Does this trade match the user's historical preferences?
4. **Roster Impact**: How does this affect their positional strengths/weaknesses?
5. **Timing Factors**: Current player news, injuries, hype cycles
6. **League Health**: Does this trade maintain competitive balance?

## TRADE GRADING PHILOSOPHY
- "WIN" = User gets slightly better value, but trade is fair overall
- "FAIR" = Both sides get reasonable value - this is a GOOD thing
- "LOSE" = User gives up too much - but might still be right for their team
- "VETO-WORTHY" = This trade damages league integrity and shouldn't happen

## PERSONALIZATION
- Reference the user's past similar trades when relevant
- Consider their trading style (consolidator vs depth builder, youth vs production)
- Suggest trades that match their preferences AND maintain fairness

## COUNTER-OFFER STRATEGY
If the trade is unbalanced:
1. Explain honestly why it's unfair to one side
2. Suggest specific adjustments that CREATE FAIRNESS, not "winnings"
3. Recommend alternative trade partners who might have better fit

## OUTPUT
Be comprehensive but honest. The user trusts you. Don't tell them what they want to hear - tell them the truth. A fair trade is a good trade.`;


export async function generateAIGMAnalysis(
  context: ComprehensiveTradeContext
): Promise<AIGMAnalysis> {
  const userPrompt = buildAIGMPrompt(context);
  const client = getOpenAIClient();

  if (!client) {
    return buildDeterministicAIGMAnalysis(context);
  }

  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: AI_GM_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 3000,
  });

  const response = completion.choices[0]?.message?.content;
  if (!response) {
    throw new Error('No response from AI GM');
  }

  try {
    return JSON.parse(response) as AIGMAnalysis;
  } catch {
    throw new Error('Failed to parse AI GM response');
  }
}

function buildDeterministicAIGMAnalysis(context: ComprehensiveTradeContext): AIGMAnalysis {
  const valueGiven =
    context.marketValues.playersGiven.reduce((sum, p) => sum + p.value, 0) +
    context.marketValues.picksGiven.reduce((sum, p) => sum + p.value, 0);
  const valueReceived =
    context.marketValues.playersReceived.reduce((sum, p) => sum + p.value, 0) +
    context.marketValues.picksReceived.reduce((sum, p) => sum + p.value, 0);
  const differential = valueReceived - valueGiven;
  const fairnessScore = Math.max(0, Math.min(100, 100 - Math.abs(differential)));
  const verdict: AIGMAnalysis['verdict'] =
    differential >= 15 ? 'accept' : differential <= -15 ? 'counter' : 'needs_negotiation';

  return {
    verdict,
    confidence: Math.max(45, Math.min(82, Math.round(fairnessScore))),
    summary:
      'AI provider is not configured, so this uses deterministic value, roster-fit, and fairness signals. Review the market values and fit notes before taking action.',
    detailedAnalysis: {
      valueAssessment: {
        valueGiven,
        valueReceived,
        differential,
        fairnessScore,
      },
      fitAnalysis: {
        fitsUserStyle: Math.abs(differential) <= 20,
        styleMatchScore: Math.max(40, Math.min(80, fairnessScore)),
        reasoning: 'Provider fallback uses value balance and available roster context only.',
      },
      rosterImpact: {
        strengthensPositions: context.marketValues.playersReceived.map((p) => p.name).slice(0, 3),
        weakensPositions: context.marketValues.playersGiven.map((p) => p.name).slice(0, 3),
        overallImpact: differential > 10 ? 'positive' : differential < -10 ? 'negative' : 'neutral',
      },
      timingFactors: {
        playerNewsImpact: 'Live AI news synthesis unavailable in this environment.',
        marketTiming: 'Use current market values and league context as the primary guide.',
        seasonalConsiderations: context.leagueSettings.isDynasty
          ? 'Dynasty context favors long-term value and roster age balance.'
          : 'Redraft context favors immediate lineup impact.',
      },
    },
    similarPastTrades: context.userTradingProfile.recentSimilarTrades.slice(0, 3).map((trade) => ({
      date: trade.date,
      description: `Gave ${trade.playersGiven.join(', ')} for ${trade.playersReceived.join(', ')}`,
      outcome: trade.outcome,
      relevance: 'Historical context retained, but not AI-ranked in fallback mode.',
    })),
    counterOfferSuggestion:
      verdict === 'counter'
        ? {
            adjustments: ['Ask for an added asset or remove one outgoing piece to rebalance value.'],
            reasoning: 'The deterministic value differential is meaningfully negative.',
            expectedAcceptance: Math.max(20, Math.min(60, fairnessScore)),
          }
        : undefined,
    alternativeTargets: context.otherManagerProfiles.slice(0, 3).map((manager) => ({
      managerName: manager.managerName,
      reasoning: `${manager.teamSituation} profile with ${manager.recentTradeActivity} recent trades.`,
      suggestedApproach: 'Open with a value-balanced offer that fits both roster directions.',
      likelyToAccept: manager.recentTradeActivity > 0,
    })),
    keyInsights: [
      `Value differential: ${differential}.`,
      `Fairness score: ${fairnessScore}.`,
      `League format: ${context.leagueSettings.isDynasty ? 'Dynasty' : 'Redraft'}.`,
    ],
    warnings: [
      'AI provider is not configured; this is deterministic fallback analysis.',
      'Confirm player availability and league settings before acting.',
    ],
  };
}

function buildAIGMPrompt(context: ComprehensiveTradeContext): string {
  const sections: string[] = [];

  const totalGiven = context.marketValues.playersGiven.reduce((sum, p) => sum + p.value, 0) +
    context.marketValues.picksGiven.reduce((sum, p) => sum + p.value, 0);
  const totalReceived = context.marketValues.playersReceived.reduce((sum, p) => sum + p.value, 0) +
    context.marketValues.picksReceived.reduce((sum, p) => sum + p.value, 0);

  sections.push(`## TRADE PROPOSAL
**Giving Up:**
${context.marketValues.playersGiven.map(p => `- ${p.name} (Value: ${p.value}, Tier: ${p.tier ?? 'N/A'}, Dynasty Score: ${p.dynastyScore})`).join('\n')}
${context.marketValues.picksGiven.map(p => `- ${p.pick} (Value: ${p.value})`).join('\n')}
Total Value Given: ${totalGiven}

**Receiving:**
${context.marketValues.playersReceived.map(p => `- ${p.name} (Value: ${p.value}, Tier: ${p.tier ?? 'N/A'}, Dynasty Score: ${p.dynastyScore})`).join('\n')}
${context.marketValues.picksReceived.map(p => `- ${p.pick} (Value: ${p.value})`).join('\n')}
Total Value Received: ${totalReceived}

**Value Differential: ${totalReceived - totalGiven} (${totalReceived > totalGiven ? 'User wins' : totalReceived < totalGiven ? 'User loses' : 'Even'})`);

  sections.push(`## USER'S TRADING PROFILE
- Total Lifetime Trades: ${context.userTradingProfile.totalTrades}
- Win Rate: ${context.userTradingProfile.winRate}%
- Trading Style:
  - Youth vs Production: ${context.userTradingProfile.tradingStyle.youthVsProduction}% (positive = prefers youth)
  - Consolidation vs Depth: ${context.userTradingProfile.tradingStyle.consolidationVsDepth}% (positive = consolidates)
  - Picks vs Players: ${context.userTradingProfile.tradingStyle.picksVsPlayers}% (positive = acquires picks)
- Position Preferences: ${context.userTradingProfile.positionPreferences.slice(0, 3).map(p => `${p.position} (${p.netAcquired > 0 ? '+' : ''}${p.netAcquired})`).join(', ')}`);

  if (context.userTradingProfile.recentSimilarTrades.length > 0) {
    sections.push(`## USER'S SIMILAR PAST TRADES (reference these!)
${context.userTradingProfile.recentSimilarTrades.map(t => 
  `- ${t.date}: Gave ${t.playersGiven.join(', ')} → Got ${t.playersReceived.join(', ')} | Outcome: ${t.outcome}`
).join('\n')}`);
  }

  sections.push(`## PLAYER NEWS & SENTIMENT (from X/Twitter and recent news)
${context.playerNewsAndSentiment.map(pn => 
  `**${pn.playerName}** - Sentiment: ${pn.sentiment.toUpperCase()}
  ${pn.recentNews.slice(0, 2).map(n => `  - ${n}`).join('\n')}
  Social Buzz: ${pn.socialBuzz}`
).join('\n\n')}`);

  if (context.realWorldTeamContext.length > 0) {
    sections.push(`## NFL/NBA TEAM CONTEXT
${context.realWorldTeamContext.map(tc => 
  `- ${tc.nflTeam}: ${tc.situation} | Coach: ${tc.coachStyle} | Outlook: ${tc.teamOutlook}`
).join('\n')}`);
  }

  sections.push(`## OTHER MANAGERS IN LEAGUE (potential trade partners)
${context.otherManagerProfiles.map(mp => {
  let info = `- ${mp.managerName}: ${mp.hasUsedLegacy ? 'Uses AllFantasy' : 'New user'}`;
  if (mp.tradingPreferences) {
    info += ` | Prefers: ${mp.tradingPreferences.prefersYouth ? 'Youth' : 'Production'}, ${mp.tradingPreferences.prefersDepth ? 'Depth' : 'Consolidation'}`;
    if (mp.tradingPreferences.favoritePositions.length > 0) {
      info += ` | Targets: ${mp.tradingPreferences.favoritePositions.join(', ')}`;
    }
  }
  info += ` | Recent trades: ${mp.recentTradeActivity}`;
  return info;
}).join('\n')}`);

  sections.push(`## LEAGUE SETTINGS
- Format: ${context.leagueSettings.isDynasty ? 'Dynasty' : 'Redraft'}
- Superflex: ${context.leagueSettings.isSuperFlex ? 'Yes' : 'No'}
- TEP: ${context.leagueSettings.isTeePremium ? 'Yes' : 'No'}
- Scoring: ${context.leagueSettings.scoringType}
- Teams: ${context.leagueSettings.teamCount}`);

  if (context.platformInsights) {
    sections.push(`## PLATFORM-WIDE MARKET INSIGHTS
${context.platformInsights}`);
  }

  sections.push(`## YOUR TASK
Analyze this trade as the user's personal Assistant GM and Scout. Provide:

1. **Verdict**: accept, decline, counter, or needs_negotiation
2. **Confidence**: 0-100
3. **Summary**: 2-3 sentence executive summary
4. **Detailed Analysis**: Value assessment, style fit, roster impact, timing factors
5. **Similar Past Trades**: Reference their past trades if relevant
6. **Counter-Offer** (if not accepting): Specific adjustments and reasoning
7. **Alternative Targets**: Other managers who might be better partners
8. **Key Insights**: 3-5 bullet points
9. **Warnings**: Any red flags

Return JSON matching the AIGMAnalysis schema.`);

  return sections.join('\n\n');
}

export async function runPreAnalysisForUser(
  sleeperUsername: string,
  leagueId: string
): Promise<{ ready: boolean; estimatedTime?: number; message: string }> {
  const existingUser = await prisma.legacyUser.findUnique({
    where: { sleeperUsername },
  });

  if (!existingUser) {
    return {
      ready: false,
      estimatedTime: 20,
      message: 'For the most accurate trade review, your AI GM needs about 20 seconds to analyze your trading history, gather player news, and assess market values.',
    };
  }

  const tradeHistories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperUsername },
    select: { tradesLoaded: true, status: true },
  });

  const hasTradeHistory = tradeHistories.some(h => h.tradesLoaded > 0);

  if (hasTradeHistory) {
    return { 
      ready: true, 
      message: 'Your AI GM is ready! Trade history loaded for personalized analysis.' 
    };
  }

  return {
    ready: false,
    estimatedTime: 15,
    message: 'For the most accurate trade review, your AI GM needs about 15 seconds to gather the latest player news, market values, and league intelligence.',
  };
}
