import { prisma } from './prisma';
import { Prisma } from '@prisma/client';
import { DEFAULT_SPORT } from '@/lib/sport-scope';
import { getAllPlayers, SleeperPlayer } from './sleeper-client';
import { FantasyCalcPlayer, findPlayerByName } from './fantasycalc';
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db';

export interface PlatformLeagueInfo {
  name: string;
  sport: string;
  teamCount?: number;
  scoringType?: string;
  leagueType?: string;
  isDevy?: boolean;
  isSF?: boolean;
  isTEP?: boolean;
  rosterSize?: number;
  rank?: number;
  points?: number;
  wins?: number;
  losses?: number;
}

export interface MultiPlatformContext {
  platforms: {
    sleeper?: { username: string; leagueCount: number; leagues?: PlatformLeagueInfo[] };
    yahoo?: { userId: string; displayName?: string; leagueCount: number; leagues?: PlatformLeagueInfo[] };
    fantrax?: { username: string; leagueCount: number; devyLeagues?: number; leagues?: PlatformLeagueInfo[] };
    mfl?: { username: string; isConnected: boolean };
  };
  totalLeagues: number;
  combinedPlayers: PlayerExposure[];
  combinedTrades: TradeHistoryItem[];
  fantasyCalcValues?: Map<string, FantasyCalcPlayer>;
}

export interface TradeHistoryItem {
  platform: string;
  leagueName: string;
  date: string;
  playersAcquired: string[];
  playersTradedAway: string[];
  picksAcquired?: string[];
  picksTradedAway?: string[];
}

export interface LeagueFormatPreferences {
  teamSizes: { size: number; count: number }[];
  mostCommonTeamSize: number;
  scoringFormats: { format: string; count: number }[];
  preferredScoring: string;
  leagueTypes: { type: string; count: number }[];
  preferredLeagueType: string;
  hasSuperflexExperience: boolean;
  superflexCount: number;
  hasTepExperience: boolean;
  tepCount: number;
  hasIdpExperience: boolean;
  idpCount: number;
  sports: { sport: string; count: number }[];
  totalLeagues: number;
}

export interface PlayerExposure {
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  leagueCount: number;
  totalShares: number;
  leagueNames: string[];
  isDynasty: boolean;
  avgAcquisitionValue?: number;
}

export interface TradingPatterns {
  totalTrades: number;
  tradingStyle: string;
  positionTendencies: {
    position: string;
    netAcquired: number;
    acquired: number;
    tradedAway: number;
  }[];
  prefersYouth: boolean;
  prefersConsolidation: boolean;
  prefersPicks: boolean;
  avgTradeFrequency: string;
  recentActivity: {
    last30Days: number;
    last90Days: number;
  };
}

export interface WaiverPatterns {
  totalMoves: number;
  positionPriorities: { position: string; count: number }[];
  avgFaabSpend?: number;
  streamingPositions: string[];
}

export interface LeagueRosterSummary {
  leagueName: string;
  leagueType: string;
  scoringType: string;
  teamCount: number;
  players: string[];
}

export interface UserChatContext {
  sleeperUsername: string;
  leagueFormats: LeagueFormatPreferences;
  topPlayerExposures: PlayerExposure[];
  highExposurePlayers: PlayerExposure[];
  tradingPatterns: TradingPatterns;
  waiverPatterns: WaiverPatterns | null;
  personalizedSuggestions: string[];
  contextSummary: string;
  leagueRosters?: LeagueRosterSummary[];
  multiPlatform?: MultiPlatformContext;
  fantasyCalcTopPlayers?: { name: string; value: number; position: string; trend: number }[];
}

const IDP_POSITIONS = ['LB', 'DL', 'DB', 'DE', 'DT', 'CB', 'S', 'IDP_FLEX', 'LB/DL', 'DB/DL'];

export async function buildUserChatContext(
  sleeperUsername: string
): Promise<UserChatContext | null> {
  const user = await prisma.legacyUser.findUnique({
    where: { sleeperUsername },
    include: {
      leagues: {
        include: {
          rosters: true,
        },
      },
    },
  });

  if (!user || user.leagues.length === 0) {
    return null;
  }

  const allPlayers = await getAllPlayers();
  const leagueFormats = analyzeLeagueFormats(user.leagues);
  const playerExposures = analyzePlayerExposures(user.leagues, allPlayers);
  const tradingPatterns = await analyzeTradingPatterns(sleeperUsername);
  const waiverPatterns = await analyzeWaiverPatterns(sleeperUsername);
  const personalizedSuggestions = generateSuggestions(
    leagueFormats,
    playerExposures,
    tradingPatterns
  );
  const contextSummary = buildContextSummary(
    sleeperUsername,
    leagueFormats,
    playerExposures,
    tradingPatterns
  );

  const leagueRosters = buildLeagueRosters(user.leagues, allPlayers);

  return {
    sleeperUsername,
    leagueFormats,
    topPlayerExposures: playerExposures.slice(0, 20),
    highExposurePlayers: playerExposures.filter(p => p.leagueCount >= 3),
    tradingPatterns,
    waiverPatterns,
    personalizedSuggestions,
    contextSummary,
    leagueRosters,
  };
}

function analyzeLeagueFormats(
  leagues: Array<{
    teamCount: number | null;
    scoringType: string | null;
    leagueType: string | null;
    isSF: boolean;
    isTEP: boolean;
    sport: string;
  }>
): LeagueFormatPreferences {
  const teamSizeMap = new Map<number, number>();
  const scoringMap = new Map<string, number>();
  const typeMap = new Map<string, number>();
  const sportMap = new Map<string, number>();
  let sfCount = 0;
  let tepCount = 0;
  let idpCount = 0;

  for (const league of leagues) {
    if (league.teamCount) {
      teamSizeMap.set(league.teamCount, (teamSizeMap.get(league.teamCount) || 0) + 1);
    }
    if (league.scoringType) {
      const scoring = league.scoringType.toLowerCase();
      scoringMap.set(scoring, (scoringMap.get(scoring) || 0) + 1);
    }
    if (league.leagueType) {
      typeMap.set(league.leagueType, (typeMap.get(league.leagueType) || 0) + 1);
    }
    sportMap.set(league.sport, (sportMap.get(league.sport) || 0) + 1);
    if (league.isSF) sfCount++;
    if (league.isTEP) tepCount++;
  }

  const teamSizes = Array.from(teamSizeMap.entries())
    .map(([size, count]) => ({ size, count }))
    .sort((a, b) => b.count - a.count);

  const scoringFormats = Array.from(scoringMap.entries())
    .map(([format, count]) => ({ format, count }))
    .sort((a, b) => b.count - a.count);

  const leagueTypes = Array.from(typeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const sports = Array.from(sportMap.entries())
    .map(([sport, count]) => ({ sport, count }))
    .sort((a, b) => b.count - a.count);

  return {
    teamSizes,
    mostCommonTeamSize: teamSizes[0]?.size || 12,
    scoringFormats,
    preferredScoring: scoringFormats[0]?.format || 'ppr',
    leagueTypes,
    preferredLeagueType: leagueTypes[0]?.type || 'redraft',
    hasSuperflexExperience: sfCount > 0,
    superflexCount: sfCount,
    hasTepExperience: tepCount > 0,
    tepCount,
    hasIdpExperience: idpCount > 0,
    idpCount,
    sports,
    totalLeagues: leagues.length,
  };
}

function analyzePlayerExposures(
  leagues: Array<{
    name: string;
    leagueType: string | null;
    rosters: Array<{
      isOwner: boolean;
      players: Prisma.JsonValue;
    }>;
  }>,
  allPlayers: Record<string, SleeperPlayer>
): PlayerExposure[] {
  const exposureMap = new Map<string, PlayerExposure>();

  for (const league of leagues) {
    const userRoster = league.rosters.find(r => r.isOwner);
    if (!userRoster) continue;

    const playerIds = userRoster.players as string[] | null;
    if (!Array.isArray(playerIds)) continue;

    for (const playerId of playerIds) {
      if (!playerId) continue;
      
      const playerInfo = allPlayers[playerId];
      if (!playerInfo) continue;

      const existing = exposureMap.get(playerId);
      if (existing) {
        existing.leagueCount++;
        existing.totalShares++;
        if (!existing.leagueNames.includes(league.name)) {
          existing.leagueNames.push(league.name);
        }
      } else {
        exposureMap.set(playerId, {
          playerId,
          playerName: playerInfo.full_name || `${playerInfo.first_name} ${playerInfo.last_name}`,
          position: playerInfo.position || 'Unknown',
          team: playerInfo.team || 'FA',
          leagueCount: 1,
          totalShares: 1,
          leagueNames: [league.name],
          isDynasty: league.leagueType?.toLowerCase() === 'dynasty',
        });
      }
    }
  }

  return Array.from(exposureMap.values())
    .sort((a, b) => b.leagueCount - a.leagueCount);
}

async function analyzeTradingPatterns(
  sleeperUsername: string
): Promise<TradingPatterns> {
  const tradeHistories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperUsername },
    select: { 
      id: true,
      tradingStyle: true,
      tradeFrequency: true,
    },
  });

  if (tradeHistories.length === 0) {
    return {
      totalTrades: 0,
      tradingStyle: 'unknown',
      positionTendencies: [],
      prefersYouth: false,
      prefersConsolidation: false,
      prefersPicks: false,
      avgTradeFrequency: 'unknown',
      recentActivity: { last30Days: 0, last90Days: 0 },
    };
  }

  const historyIds = tradeHistories.map(h => h.id);
  const trades = await prisma.leagueTrade.findMany({
    where: { historyId: { in: historyIds } },
    orderBy: { createdAt: 'desc' },
  });

  const positionStats = new Map<string, { acquired: number; traded: number }>();
  let youthScore = 0;
  let consolidationScore = 0;
  let picksScore = 0;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  let tradesLast30Days = 0;
  let tradesLast90Days = 0;

  for (const trade of trades) {
    const playersGiven = (trade.playersGiven as Array<{ name: string; position: string; age?: number }>) || [];
    const playersReceived = (trade.playersReceived as Array<{ name: string; position: string; age?: number }>) || [];
    const picksGiven = (trade.picksGiven as Array<{ round: number; season: number }>) || [];
    const picksReceived = (trade.picksReceived as Array<{ round: number; season: number }>) || [];

    for (const p of playersReceived) {
      const stat = positionStats.get(p.position) || { acquired: 0, traded: 0 };
      stat.acquired++;
      positionStats.set(p.position, stat);
      if (p.age && p.age < 26) youthScore++;
    }

    for (const p of playersGiven) {
      const stat = positionStats.get(p.position) || { acquired: 0, traded: 0 };
      stat.traded++;
      positionStats.set(p.position, stat);
      if (p.age && p.age >= 28) youthScore++;
    }

    if (playersReceived.length < playersGiven.length) consolidationScore++;
    if (playersReceived.length > playersGiven.length) consolidationScore--;

    if (picksReceived.length > picksGiven.length) picksScore++;
    if (picksGiven.length > picksReceived.length) picksScore--;

    const tradeDate = trade.createdAt;
    if (tradeDate) {
      if (tradeDate >= thirtyDaysAgo) tradesLast30Days++;
      if (tradeDate >= ninetyDaysAgo) tradesLast90Days++;
    }
  }

  const positionTendencies = Array.from(positionStats.entries())
    .map(([position, stats]) => ({
      position,
      netAcquired: stats.acquired - stats.traded,
      acquired: stats.acquired,
      tradedAway: stats.traded,
    }))
    .sort((a, b) => Math.abs(b.netAcquired) - Math.abs(a.netAcquired));

  const frequencySum = tradeHistories.reduce((sum, h) => {
    if (h.tradeFrequency === 'active') return sum + 3;
    if (h.tradeFrequency === 'moderate') return sum + 2;
    return sum + 1;
  }, 0);
  const avgFreq = frequencySum / tradeHistories.length;
  const avgTradeFrequency = avgFreq > 2.5 ? 'active' : avgFreq > 1.5 ? 'moderate' : 'conservative';

  let tradingStyle = 'balanced';
  if (youthScore > trades.length * 0.3) tradingStyle = 'youth-focused';
  else if (consolidationScore > trades.length * 0.2) tradingStyle = 'consolidator';
  else if (consolidationScore < -trades.length * 0.2) tradingStyle = 'depth-builder';
  else if (picksScore > trades.length * 0.2) tradingStyle = 'pick-accumulator';

  return {
    totalTrades: trades.length,
    tradingStyle,
    positionTendencies,
    prefersYouth: youthScore > trades.length * 0.3,
    prefersConsolidation: consolidationScore > trades.length * 0.2,
    prefersPicks: picksScore > trades.length * 0.2,
    avgTradeFrequency,
    recentActivity: {
      last30Days: tradesLast30Days,
      last90Days: tradesLast90Days,
    },
  };
}

async function analyzeWaiverPatterns(
  _sleeperUsername: string
): Promise<WaiverPatterns | null> {
  return null;
}

function generateSuggestions(
  formats: LeagueFormatPreferences,
  exposures: PlayerExposure[],
  trading: TradingPatterns
): string[] {
  const suggestions: string[] = [];

  const highExposure = exposures.filter(p => p.leagueCount >= 4);
  for (const player of highExposure.slice(0, 3)) {
    suggestions.push(
      `You have ${player.playerName} (${player.position}) in ${player.leagueCount} leagues. ` +
      `Consider monitoring their value closely - if the market is high, selling some shares could diversify risk.`
    );
  }

  if (trading.positionTendencies.length > 0) {
    const topAcquired = trading.positionTendencies.find(p => p.netAcquired > 3);
    if (topAcquired) {
      suggestions.push(
        `You tend to acquire ${topAcquired.position}s heavily (+${topAcquired.netAcquired} net). ` +
        `Make sure you're not overvaluing the position in trades.`
      );
    }
  }

  if (formats.hasTepExperience && formats.tepCount >= 2) {
    suggestions.push(
      `With ${formats.tepCount} TEP leagues, you should prioritize elite TEs like Bowers, Kelce, or LaPorta higher than standard rankings suggest.`
    );
  }

  if (formats.hasSuperflexExperience && formats.superflexCount >= 2) {
    suggestions.push(
      `Playing ${formats.superflexCount} Superflex leagues means QBs should be valued 1.5-2x their 1QB rankings. Don't trade elite QBs cheaply.`
    );
  }

  return suggestions;
}

function buildContextSummary(
  username: string,
  formats: LeagueFormatPreferences,
  exposures: PlayerExposure[],
  trading: TradingPatterns
): string {
  const lines: string[] = [
    `## User Profile: ${username}`,
    ``,
    `### League Preferences`,
    `- Total leagues: ${formats.totalLeagues}`,
    `- Preferred team size: ${formats.mostCommonTeamSize}-team leagues`,
    `- Scoring: ${formats.preferredScoring.toUpperCase()}`,
    `- League type: ${formats.preferredLeagueType}`,
  ];

  if (formats.hasSuperflexExperience) {
    lines.push(`- Superflex experience: ${formats.superflexCount} SF leagues`);
  }
  if (formats.hasTepExperience) {
    lines.push(`- TEP experience: ${formats.tepCount} TEP leagues`);
  }

  lines.push(``);
  lines.push(`### Top Player Shares`);
  const top5 = exposures.slice(0, 5);
  for (const p of top5) {
    const leagueList = p.leagueNames.length > 0 ? ` [${p.leagueNames.join(', ')}]` : '';
    lines.push(`- ${p.playerName} (${p.position}): ${p.leagueCount} leagues${leagueList}`);
  }

  lines.push(``);
  lines.push(`### Trading Style`);
  lines.push(`- Total trades: ${trading.totalTrades}`);
  lines.push(`- Style: ${trading.tradingStyle}`);
  lines.push(`- Activity: ${trading.avgTradeFrequency} trader`);
  if (trading.recentActivity.last30Days > 0) {
    lines.push(`- Recent: ${trading.recentActivity.last30Days} trades in last 30 days`);
  }

  if (trading.positionTendencies.length > 0) {
    lines.push(`- Position tendencies:`);
    for (const pt of trading.positionTendencies.slice(0, 3)) {
      const direction = pt.netAcquired > 0 ? 'accumulating' : 'trading away';
      lines.push(`  - ${pt.position}: ${direction} (${pt.netAcquired > 0 ? '+' : ''}${pt.netAcquired} net)`);
    }
  }

  return lines.join('\n');
}

function buildLeagueRosters(
  leagues: Array<{
    name: string;
    leagueType: string | null;
    scoringType: string | null;
    teamCount: number | null;
    rosters: Array<{
      isOwner: boolean;
      players: any;
    }>;
  }>,
  allPlayers: Record<string, SleeperPlayer>
): LeagueRosterSummary[] {
  const rosters: LeagueRosterSummary[] = [];

  for (const league of leagues) {
    const userRoster = league.rosters.find(r => r.isOwner);
    if (!userRoster) continue;

    const playerIds = userRoster.players as string[] | null;
    if (!Array.isArray(playerIds)) continue;

    const playerNames = playerIds
      .filter(id => id && allPlayers[id])
      .map(id => {
        const p = allPlayers[id];
        return `${p.full_name || `${p.first_name} ${p.last_name}`} (${p.position || '?'})`;
      })
      .slice(0, 20);

    rosters.push({
      leagueName: league.name,
      leagueType: league.leagueType || 'unknown',
      scoringType: league.scoringType || 'unknown',
      teamCount: league.teamCount || 0,
      players: playerNames,
    });
  }

  return rosters;
}

export function formatContextForSystemPrompt(context: UserChatContext): string {
  let prompt = `\n\n## PERSONALIZED USER CONTEXT\n`;
  prompt += `You are chatting with ${context.sleeperUsername}, a fantasy manager you know well.\n\n`;
  prompt += context.contextSummary;

  if (context.highExposurePlayers.length > 0) {
    prompt += `\n\n### High Exposure Alert\n`;
    prompt += `These players appear in 3+ of their leagues - give buy/sell advice considering this concentration:\n`;
    for (const p of context.highExposurePlayers.slice(0, 5)) {
      const leagueList = p.leagueNames.length > 0 ? ` [${p.leagueNames.join(', ')}]` : '';
      prompt += `- ${p.playerName} (${p.position}): ${p.leagueCount} leagues${leagueList}\n`;
    }
  }

  if (context.personalizedSuggestions.length > 0) {
    prompt += `\n\n### Proactive Suggestions (offer if relevant to their question)\n`;
    for (const s of context.personalizedSuggestions) {
      prompt += `- ${s}\n`;
    }
  }

  if (context.leagueRosters && context.leagueRosters.length > 0) {
    prompt += `\n\n### Your Rosters by League\n`;
    prompt += `ALWAYS reference these league names when discussing their players:\n`;
    for (const roster of context.leagueRosters.slice(0, 6)) {
      prompt += `\n**"${roster.leagueName}"** (${roster.leagueType}, ${roster.scoringType}, ${roster.teamCount}-team):\n`;
      if (roster.players.length > 0) {
        prompt += `  Roster: ${roster.players.join(', ')}\n`;
      }
    }
  }

  prompt += `\n\nUSE THIS CONTEXT TO:\n`;
  prompt += `1. Reference their specific league NAMES when discussing players (e.g., "In your '${context.leagueRosters?.[0]?.leagueName || 'league'}' league...")\n`;
  prompt += `2. Warn about concentration risk when they ask about players they own in multiple leagues\n`;
  prompt += `3. Tailor trade advice to their trading style (${context.tradingPatterns.tradingStyle})\n`;
  prompt += `4. Consider their scoring preferences (${context.leagueFormats.preferredScoring}) when ranking players\n`;
  prompt += `5. When a user asks about a player they own, mention WHICH league(s) they have that player in by name\n`;

  if (context.multiPlatform) {
    prompt += `\n\n### Multi-Platform Data\n`;
    prompt += `This user has data from multiple fantasy platforms. When they ask about their leagues, use this information:\n\n`;
    
    // Sleeper details
    if (context.multiPlatform.platforms.sleeper) {
      prompt += `**SLEEPER** (${context.multiPlatform.platforms.sleeper.username}): ${context.multiPlatform.platforms.sleeper.leagueCount} leagues\n`;
      const sleeperLeagues = context.multiPlatform.platforms.sleeper.leagues || [];
      for (const league of sleeperLeagues.slice(0, 5)) {
        prompt += `  - "${league.name}" (${league.sport.toUpperCase()}, ${league.leagueType || 'unknown'}, ${league.teamCount || '?'}-team${league.isSF ? ', Superflex' : ''}${league.isTEP ? ', TEP' : ''})\n`;
      }
      if (sleeperLeagues.length > 5) {
        prompt += `  - ...and ${sleeperLeagues.length - 5} more leagues\n`;
      }
      prompt += `\n`;
    }
    
    // Yahoo details
    if (context.multiPlatform.platforms.yahoo) {
      const displayName = context.multiPlatform.platforms.yahoo.displayName || context.multiPlatform.platforms.yahoo.userId;
      prompt += `**YAHOO FANTASY** (${displayName}): ${context.multiPlatform.platforms.yahoo.leagueCount} leagues\n`;
      const yahooLeagues = context.multiPlatform.platforms.yahoo.leagues || [];
      for (const league of yahooLeagues.slice(0, 5)) {
        prompt += `  - "${league.name}" (${league.sport.toUpperCase()}, ${league.leagueType || 'redraft'}, ${league.teamCount || '?'}-team)\n`;
      }
      if (yahooLeagues.length > 5) {
        prompt += `  - ...and ${yahooLeagues.length - 5} more leagues\n`;
      }
      prompt += `\n`;
    }
    
    // Fantrax details
    if (context.multiPlatform.platforms.fantrax) {
      prompt += `**FANTRAX** (${context.multiPlatform.platforms.fantrax.username}): ${context.multiPlatform.platforms.fantrax.leagueCount} leagues`;
      if (context.multiPlatform.platforms.fantrax.devyLeagues) {
        prompt += ` (${context.multiPlatform.platforms.fantrax.devyLeagues} devy)`;
      }
      prompt += `\n`;
      const fantraxLeagues = context.multiPlatform.platforms.fantrax.leagues || [];
      for (const league of fantraxLeagues.slice(0, 5)) {
        const statsInfo = league.wins !== undefined ? ` [${league.wins}-${league.losses}, Rank #${league.rank || '?'}]` : '';
        prompt += `  - "${league.name}" (${league.sport?.toUpperCase() || DEFAULT_SPORT}${league.isDevy ? ', DEVY' : ', dynasty'})${statsInfo}\n`;
      }
      if (fantraxLeagues.length > 5) {
        prompt += `  - ...and ${fantraxLeagues.length - 5} more leagues\n`;
      }
      prompt += `\n`;
    }
    
    // MFL details
    if (context.multiPlatform.platforms.mfl) {
      prompt += `**MFL (MyFantasyLeague)** (${context.multiPlatform.platforms.mfl.username}): Connected\n`;
      prompt += `  - User has MFL account linked but league data requires direct API access\n\n`;
    }
    
    prompt += `**Total across all platforms**: ${context.multiPlatform.totalLeagues} leagues\n`;
    
    prompt += `\nWhen answering questions about specific leagues:\n`;
    prompt += `- Reference the league by name when discussing it\n`;
    prompt += `- Consider the platform-specific context (Fantrax has more detailed scoring, Yahoo has different roster formats)\n`;
    prompt += `- If asked about a specific platform, focus your answer on that platform's leagues\n`;
    prompt += `- For devy leagues, focus on long-term dynasty value and college player analysis\n`;
  }

  if (context.fantasyCalcTopPlayers && context.fantasyCalcTopPlayers.length > 0) {
    prompt += `\n\n### FantasyCalc Market Values (Use for Trade Analysis)\n`;
    prompt += `Current dynasty values for their top owned players:\n`;
    for (const p of context.fantasyCalcTopPlayers.slice(0, 10)) {
      const trendIcon = p.trend > 0 ? '📈' : p.trend < 0 ? '📉' : '➡️';
      prompt += `- ${p.name} (${p.position}): ${p.value} value ${trendIcon}\n`;
    }
    prompt += `\nUse FantasyCalc values when evaluating trades to give accurate market-based advice.\n`;
  }

  return prompt;
}

export async function fetchYahooLeaguesForContext(yahooUserId: string): Promise<{
  leagues: any[];
  teams: any[];
  displayName?: string;
}> {
  try {
    const connection = await prisma.yahooConnection.findUnique({
      where: { yahooUserId },
      include: {
        leagues: {
          include: { teams: true }
        }
      }
    });

    if (!connection) return { leagues: [], teams: [] };

    const userTeams = connection.leagues.flatMap(l => 
      l.teams.filter((t: any) => t.isUserTeam)
    );

    return {
      leagues: connection.leagues,
      teams: userTeams,
      displayName: connection.displayName || undefined
    };
  } catch (err) {
    console.warn('Failed to fetch Yahoo leagues for context:', err);
    return { leagues: [], teams: [] };
  }
}

export async function fetchFantraxLeaguesForContext(fantraxUsername: string): Promise<{
  leagues: any[];
  transactions: any[];
  devyLeagueCount: number;
}> {
  try {
    const user = await prisma.fantraxUser.findUnique({
      where: { fantraxUsername },
      include: { leagues: true }
    });

    if (!user) return { leagues: [], transactions: [], devyLeagueCount: 0 };

    const devyLeagueCount = user.leagues.filter((l: any) => l.isDevy).length;
    const allTransactions = user.leagues.flatMap((l: any) => {
      const txns = l.transactions as any;
      if (!txns) return [];
      return [
        ...(txns.claims || []),
        ...(txns.drops || []),
        ...(txns.trades || [])
      ];
    });

    return {
      leagues: user.leagues,
      transactions: allTransactions,
      devyLeagueCount
    };
  } catch (err) {
    console.warn('Failed to fetch Fantrax leagues for context:', err);
    return { leagues: [], transactions: [], devyLeagueCount: 0 };
  }
}

export async function buildMultiPlatformContext(
  sleeperUsername?: string,
  yahooUserId?: string,
  fantraxUsername?: string,
  mflUsername?: string
): Promise<MultiPlatformContext | null> {
  const platforms: MultiPlatformContext['platforms'] = {};
  const combinedPlayers: PlayerExposure[] = [];
  const combinedTrades: TradeHistoryItem[] = [];
  let totalLeagues = 0;

  if (sleeperUsername) {
    const user = await prisma.legacyUser.findUnique({
      where: { sleeperUsername },
      include: { leagues: { include: { rosters: true } } }
    });
    if (user && user.leagues.length > 0) {
      const sleeperLeagues: PlatformLeagueInfo[] = user.leagues.map((l: any) => ({
        name: l.name,
        sport: l.sport || 'nfl',
        teamCount: l.teamCount || undefined,
        scoringType: l.scoringType || undefined,
        leagueType: l.leagueType || undefined,
        isSF: l.isSF || false,
        isTEP: l.isTEP || false
      }));
      platforms.sleeper = { 
        username: sleeperUsername, 
        leagueCount: user.leagues.length,
        leagues: sleeperLeagues
      };
      totalLeagues += user.leagues.length;
    }
  }

  // Check for MFL connection
  if (mflUsername) {
    const mflConn = await prisma.mFLConnection.findUnique({
      where: { mflUsername }
    });
    if (mflConn) {
      platforms.mfl = { username: mflUsername, isConnected: true };
    }
  }

  if (yahooUserId) {
    const yahooData = await fetchYahooLeaguesForContext(yahooUserId);
    if (yahooData.leagues.length > 0) {
      const yahooLeagues: PlatformLeagueInfo[] = yahooData.leagues.map((l: any) => ({
        name: l.name || l.leagueName,
        sport: l.sport || 'nfl',
        teamCount: l.numTeams || undefined,
        scoringType: l.scoringType || undefined,
        leagueType: l.leagueType || 'redraft'
      }));
      platforms.yahoo = {
        userId: yahooUserId,
        displayName: yahooData.displayName,
        leagueCount: yahooData.leagues.length,
        leagues: yahooLeagues
      };
      totalLeagues += yahooData.leagues.length;

      for (const team of yahooData.teams) {
        if (team.roster) {
          const roster = team.roster as any[];
          for (const player of roster) {
            const existing = combinedPlayers.find(p => 
              p.playerName.toLowerCase() === player.name?.toLowerCase()
            );
            if (existing) {
              existing.leagueCount++;
              existing.leagueNames.push(`Yahoo: ${team.name}`);
            } else if (player.name) {
              combinedPlayers.push({
                playerId: player.player_key || '',
                playerName: player.name,
                position: player.position || 'UNKNOWN',
                team: player.team || '',
                leagueCount: 1,
                totalShares: 1,
                leagueNames: [`Yahoo: ${team.name}`],
                isDynasty: false
              });
            }
          }
        }
      }
    }
  }

  if (fantraxUsername) {
    const fantraxData = await fetchFantraxLeaguesForContext(fantraxUsername);
    if (fantraxData.leagues.length > 0) {
      const fantraxLeagues: PlatformLeagueInfo[] = fantraxData.leagues.map((l: any) => ({
        name: l.leagueName || l.name,
        sport: l.sport || 'nfl',
        teamCount: l.teamCount || undefined,
        scoringType: l.scoringType || undefined,
        leagueType: l.isDevy ? 'devy' : 'dynasty',
        isDevy: l.isDevy || false,
        rank: l.standings?.rank || undefined,
        points: l.standings?.pointsFor || l.statistics?.pointsFor || undefined,
        wins: l.standings?.wins || undefined,
        losses: l.standings?.losses || undefined
      }));
      platforms.fantrax = {
        username: fantraxUsername,
        leagueCount: fantraxData.leagues.length,
        devyLeagues: fantraxData.devyLeagueCount > 0 ? fantraxData.devyLeagueCount : undefined,
        leagues: fantraxLeagues
      };
      totalLeagues += fantraxData.leagues.length;

      for (const league of fantraxData.leagues) {
        const roster = league.roster as any[];
        if (roster && Array.isArray(roster)) {
          for (const player of roster) {
            const existing = combinedPlayers.find(p => 
              p.playerName.toLowerCase() === player.name?.toLowerCase()
            );
            if (existing) {
              existing.leagueCount++;
              existing.leagueNames.push(`Fantrax: ${league.leagueName}`);
            } else if (player.name) {
              combinedPlayers.push({
                playerId: player.fantraxId || '',
                playerName: player.name,
                position: player.position || player.primaryPosition || 'UNKNOWN',
                team: player.nflTeam || player.team || '',
                leagueCount: 1,
                totalShares: 1,
                leagueNames: [`Fantrax: ${league.leagueName}`],
                isDynasty: league.isDevy || false
              });
            }
          }
        }

        const txns = league.transactions as any;
        if (txns?.trades) {
          for (const trade of txns.trades) {
            combinedTrades.push({
              platform: 'fantrax',
              leagueName: league.leagueName,
              date: trade.date,
              playersAcquired: trade.toTeam === fantraxUsername ? [trade.player] : [],
              playersTradedAway: trade.fromTeam === fantraxUsername ? [trade.player] : [],
              picksAcquired: trade.isDraftPick && trade.toTeam === fantraxUsername ? [trade.player] : undefined,
              picksTradedAway: trade.isDraftPick && trade.fromTeam === fantraxUsername ? [trade.player] : undefined
            });
          }
        }
      }
    }
  }

  if (totalLeagues === 0) return null;

  let fantasyCalcValues: Map<string, FantasyCalcPlayer> | undefined;
  try {
    const fcData = await getFantasyCalcValuesDbFirst({ isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 });
    fantasyCalcValues = new Map();
    for (const p of fcData) {
      fantasyCalcValues.set(p.player.name.toLowerCase(), p);
    }
  } catch (err) {
    console.warn('Failed to fetch FantasyCalc values:', err);
  }

  combinedPlayers.sort((a, b) => b.leagueCount - a.leagueCount);

  return {
    platforms,
    totalLeagues,
    combinedPlayers,
    combinedTrades,
    fantasyCalcValues
  };
}

export async function buildEnhancedUserContext(
  sleeperUsername?: string,
  yahooUserId?: string,
  fantraxUsername?: string,
  mflUsername?: string
): Promise<UserChatContext | null> {
  const baseContext = sleeperUsername ? await buildUserChatContext(sleeperUsername) : null;
  const multiPlatform = await buildMultiPlatformContext(sleeperUsername, yahooUserId, fantraxUsername, mflUsername);

  if (!baseContext && !multiPlatform) return null;

  let fantasyCalcTopPlayers: { name: string; value: number; position: string; trend: number }[] | undefined;

  if (multiPlatform?.fantasyCalcValues && multiPlatform.combinedPlayers.length > 0) {
    fantasyCalcTopPlayers = [];
    for (const player of multiPlatform.combinedPlayers.slice(0, 20)) {
      const fcPlayer = multiPlatform.fantasyCalcValues.get(player.playerName.toLowerCase());
      if (fcPlayer) {
        fantasyCalcTopPlayers.push({
          name: fcPlayer.player.name,
          value: fcPlayer.value,
          position: fcPlayer.player.position,
          trend: fcPlayer.trend30Day
        });
      }
    }
  }

  if (baseContext) {
    return {
      ...baseContext,
      multiPlatform: multiPlatform || undefined,
      fantasyCalcTopPlayers
    };
  }

  return {
    sleeperUsername: sleeperUsername || yahooUserId || fantraxUsername || 'unknown',
    leagueFormats: {
      teamSizes: [],
      mostCommonTeamSize: 12,
      scoringFormats: [],
      preferredScoring: 'ppr',
      leagueTypes: [],
      preferredLeagueType: 'dynasty',
      hasSuperflexExperience: false,
      superflexCount: 0,
      hasTepExperience: false,
      tepCount: 0,
      hasIdpExperience: false,
      idpCount: 0,
      sports: [],
      totalLeagues: multiPlatform?.totalLeagues || 0
    },
    topPlayerExposures: multiPlatform?.combinedPlayers.slice(0, 20) || [],
    highExposurePlayers: multiPlatform?.combinedPlayers.filter(p => p.leagueCount >= 3) || [],
    tradingPatterns: {
      totalTrades: multiPlatform?.combinedTrades.length || 0,
      tradingStyle: 'unknown',
      positionTendencies: [],
      prefersYouth: false,
      prefersConsolidation: false,
      prefersPicks: false,
      avgTradeFrequency: 'unknown',
      recentActivity: { last30Days: 0, last90Days: 0 }
    },
    waiverPatterns: null,
    personalizedSuggestions: [],
    contextSummary: `Multi-platform user with ${multiPlatform?.totalLeagues || 0} total leagues across ${Object.keys(multiPlatform?.platforms || {}).length} platforms.`,
    multiPlatform: multiPlatform || undefined,
    fantasyCalcTopPlayers
  };
}
