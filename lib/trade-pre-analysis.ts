import { prisma } from './prisma';
import { Prisma } from '@prisma/client';
import { 
  fetchFantasyCalcValues, 
  findPlayerByName,
  FantasyCalcPlayer 
} from './fantasycalc';
import { 
  findPlayerTier, 
  ALL_TIERED_PLAYERS 
} from './dynasty-tiers';
import { getComprehensiveLearningContext } from './comprehensive-trade-learning';
import { fetchPlayerNewsFromGrok } from './ai-gm-intelligence';
import {
  getLeagueInfo,
  getLeagueRosters,
  getLeagueTransactions,
  getLeagueUsers,
  getTradedDraftPicks,
  SleeperDraftPick,
} from './sleeper-client';
import {
  getCanonicalPlayerMapForSport,
  DECISION_FRESHNESS_MS,
  type FreshnessStats,
} from './canonical/getCanonicalPlayer';
import { computeManagerTendencies, type ManagerTendencyProfile } from './trade-engine/manager-tendency-engine';

const CACHE_FRESHNESS_HOURS = 4;
const STALE_THRESHOLD_HOURS = 24;
const TENDENCY_CACHE_DAYS = 7;

interface LeagueSettings {
  isDynasty: boolean;
  isSuperFlex: boolean;
  isTeePremium: boolean;
  scoringType: string;
  rosterPositions: string[];
  teamCount: number;
}

interface RosterNeeds {
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

interface ManagerTradeHistory {
  totalTrades: number;
  positionsAcquired: Record<string, number>; // What they tend to buy
  positionsTraded: Record<string, number>;   // What they tend to sell
  prefersYouth: boolean;       // Tends to acquire younger players
  prefersPicks: boolean;       // Tends to acquire draft picks
  prefersConsolidation: boolean; // Tends to 2-for-1 consolidate
  recentTradePartners: string[]; // Who they trade with most
  likelyToAccept: string[];    // Types of trades they'd likely accept
  unlikelyToAccept: string[];  // Types of trades they'd likely reject
}

// Draft pick with specific position (e.g., 1.08 means round 1, pick 8)
interface DraftPickAsset {
  season: string;      // e.g., "2026"
  round: number;       // 1, 2, 3, 4
  pickPosition?: number; // Estimated position (e.g., 8 for pick 1.08)
  originalOwner?: string; // Who originally owned this pick
  displayName: string; // e.g., "2026 1st (1.08)" or "2026 2nd via TeamName"
  estimatedValue: number; // FantasyCalc-style value
}

interface ManagerProfile {
  managerId: string;
  managerName: string;
  teamSituation: 'contender' | 'rebuilding' | 'middle';
  wins: number;
  losses: number;
  pointsFor: number;
  tradingActivity: number;
  hasUsedLegacy: boolean;
  tradeHistory?: ManagerTradeHistory;
  draftPicks?: DraftPickAsset[]; // Actual draft picks this manager owns
  tradingPreferences?: {
    prefersYouth: boolean;
    prefersDepth: boolean;
    favoritePositions: string[];
  };
}

interface UserTradingProfile {
  totalTrades: number;
  winRate: number;
  tradingStyle: {
    youthVsProduction: number;
    consolidationVsDepth: number;
    picksVsPlayers: number;
  };
  positionBias: Record<string, number>;
  favoritePartners: string[];
  avgTradeValue: number;
}

interface LeagueTradePatterns {
  avgTradesPerWeek: number;
  totalLeagueTrades: number;
  commonPositionSwaps: Array<{ give: string; receive: string; count: number }>;
  pickValueTrends: Record<string, number>;
  mostActiveTraders: string[];
}

export interface PreAnalysisResult {
  status: 'ready' | 'analyzing' | 'pending';
  estimatedTime?: number;
  message: string;
  cache?: {
    leagueSettings: LeagueSettings;
    userTradingProfile: UserTradingProfile;
    leagueTradePatterns: LeagueTradePatterns;
    managerProfiles: ManagerProfile[];
    managerTendencies?: Record<string, ManagerTendencyProfile>;
    rosterNeeds: RosterNeeds;
    marketInsights: {
      overvaluedPlayers: string[];
      undervaluedPlayers: string[];
      risingPlayers: string[];
      fallingPlayers: string[];
    };
    lastUpdated: Date;
  };
}

function extractManagerDataFromCache(raw: unknown): { profiles: ManagerProfile[]; tendencies: Record<string, ManagerTendencyProfile> } {
  if (!raw) return { profiles: [], tendencies: {} }
  if (Array.isArray(raw)) return { profiles: raw as ManagerProfile[], tendencies: {} }
  const obj = raw as { profiles?: ManagerProfile[]; tendencies?: Record<string, ManagerTendencyProfile> }
  return {
    profiles: obj.profiles || [],
    tendencies: obj.tendencies || {},
  }
}

async function fetchSleeperLeagueInfo(leagueId: string) {
  try {
    return await getLeagueInfo(leagueId);
  } catch {
    return null;
  }
}

async function fetchSleeperRosters(leagueId: string) {
  try {
    return await getLeagueRosters(leagueId);
  } catch {
    return [];
  }
}

async function fetchSleeperUsers(leagueId: string): Promise<Map<string, { displayName: string; username: string }>> {
  try {
    const users = await getLeagueUsers(leagueId);
    
    const userMap = new Map<string, { displayName: string; username: string }>();
    for (const u of users) {
      userMap.set(u.user_id, { 
        displayName: u.display_name || u.username,
        username: u.username
      });
    }
    return userMap;
  } catch {
    return new Map();
  }
}

async function fetchSleeperTransactions(leagueId: string, season: string): Promise<Array<{
  type: string;
  roster_ids: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: Array<{ season: string; round: number; roster_id: number; previous_owner_id: number; owner_id: number }>;
  status: string;
  created: number;
}>> {
  const allTransactions: Array<{
    type: string;
    roster_ids: number[];
    adds: Record<string, number> | null;
    drops: Record<string, number> | null;
    draft_picks: Array<{ season: string; round: number; roster_id: number; previous_owner_id: number; owner_id: number }>;
    status: string;
    created: number;
  }> = [];
  
  for (let week = 1; week <= 18; week++) {
    try {
      const transactions = await getLeagueTransactions(leagueId, week);
      allTransactions.push(...transactions.filter((t: { type: string }) => t.type === 'trade'));
    } catch {
      continue;
    }
  }
  
  return allTransactions;
}

async function analyzeLeagueTradePatterns(
  leagueId: string,
  allPlayers: Record<string, { first_name: string; last_name: string; position: string }>
): Promise<LeagueTradePatterns> {
  const leagueInfo = await fetchSleeperLeagueInfo(leagueId);
  const season = leagueInfo?.season || new Date().getFullYear().toString();
  
  const transactions = await fetchSleeperTransactions(leagueId, season);
  
  const positionSwaps: Map<string, number> = new Map();
  const traderActivity: Map<number, number> = new Map();
  
  for (const tx of transactions) {
    for (const rosterId of tx.roster_ids || []) {
      traderActivity.set(rosterId, (traderActivity.get(rosterId) || 0) + 1);
    }
    
    if (tx.adds && tx.drops) {
      const addPositions = Object.keys(tx.adds).map(id => allPlayers[id]?.position || 'Unknown');
      const dropPositions = Object.keys(tx.drops).map(id => allPlayers[id]?.position || 'Unknown');
      
      for (const give of dropPositions) {
        for (const receive of addPositions) {
          if (give !== receive) {
            const key = `${give}->${receive}`;
            positionSwaps.set(key, (positionSwaps.get(key) || 0) + 1);
          }
        }
      }
    }
  }
  
  const commonPositionSwaps = Array.from(positionSwaps.entries())
    .map(([key, count]) => {
      const [give, receive] = key.split('->');
      return { give, receive, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  const mostActiveTraders = Array.from(traderActivity.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([rosterId]) => `Roster ${rosterId}`);
  
  const weeksWithTrades = new Set(transactions.map(t => Math.floor(t.created / (7 * 24 * 60 * 60 * 1000)))).size || 1;
  
  return {
    avgTradesPerWeek: transactions.length / Math.max(weeksWithTrades, 1),
    totalLeagueTrades: transactions.length,
    commonPositionSwaps,
    pickValueTrends: {},
    mostActiveTraders,
  };
}

// Draft pick value estimates based on round and pick position (dynasty values)
function estimateDraftPickValue(round: number, pickPosition?: number): number {
  // Base values by round (FantasyCalc-style dynasty values)
  const roundBaseValues: Record<number, number> = {
    1: 6000, // 1st round picks are very valuable
    2: 3000, // 2nd round
    3: 1500, // 3rd round
    4: 750,  // 4th round
    5: 400,  // 5th+ round
  };
  
  const baseValue = roundBaseValues[round] || 200;
  
  // Adjust for pick position within the round
  if (pickPosition && round <= 2) {
    // Early picks are more valuable (1.01 > 1.12)
    const positionBonus = Math.max(0, (13 - pickPosition) * (round === 1 ? 400 : 150));
    return baseValue + positionBonus;
  }
  
  return baseValue;
}

// Compute each manager's draft pick inventory
async function computeDraftPickInventory(
  leagueId: string,
  rosters: Array<{ roster_id: number; owner_id: string; settings?: { wins?: number; losses?: number; fpts?: number } }>,
  userMap: Map<string, { displayName: string; username: string }>,
  numTeams: number
): Promise<Map<number, DraftPickAsset[]>> {
  // Get traded picks from Sleeper
  const tradedPicks = await getTradedDraftPicks(leagueId);
  
  // Sort rosters by performance to estimate pick positions
  // Worst team gets 1.01, best team gets 1.12 (for 12-team league)
  const sortedRosters = [...rosters]
    .filter(r => r.owner_id)
    .sort((a, b) => {
      const aScore = (a.settings?.wins || 0) * 1000 + (a.settings?.fpts || 0);
      const bScore = (b.settings?.wins || 0) * 1000 + (b.settings?.fpts || 0);
      return aScore - bScore; // Worst first
    });
  
  // Map roster_id to estimated pick position (1 = worst team, 12 = best)
  const pickPositionMap = new Map<number, number>();
  sortedRosters.forEach((r, i) => {
    pickPositionMap.set(r.roster_id, i + 1);
  });
  
  // Map roster_id to manager name
  const rosterNameMap = new Map<number, string>();
  for (const roster of rosters) {
    if (roster.owner_id) {
      rosterNameMap.set(roster.roster_id, userMap.get(roster.owner_id)?.displayName || `Team ${roster.roster_id}`);
    }
  }
  
  // Use a stable key for each pick: season-round-originalRosterId
  // Map from key -> current owner roster_id
  const pickOwnerMap = new Map<string, number>();
  
  const currentYear = new Date().getFullYear();
  const futureSeasonsCount = 3; // Current year + 2 more
  
  // Initialize: each team owns their own picks
  for (const roster of rosters) {
    if (!roster.owner_id) continue;
    
    for (let year = currentYear; year < currentYear + futureSeasonsCount; year++) {
      for (let round = 1; round <= 4; round++) {
        const key = `${year}-${round}-${roster.roster_id}`;
        pickOwnerMap.set(key, roster.roster_id); // Initially owned by original team
      }
    }
  }
  
  // Apply trades: update ownership based on current owner
  // Sleeper traded_picks gives us the CURRENT state (owner_id = who owns it now)
  for (const trade of tradedPicks) {
    const key = `${trade.season}-${trade.round}-${trade.roster_id}`; // roster_id = original owner
    pickOwnerMap.set(key, trade.owner_id); // owner_id = current owner
  }
  
  // Build final inventory by current owner
  const pickInventory = new Map<number, DraftPickAsset[]>();
  
  // Initialize empty arrays for all rosters
  for (const roster of rosters) {
    if (roster.owner_id) {
      pickInventory.set(roster.roster_id, []);
    }
  }
  
  // Assign picks to their current owners
  for (const [key, currentOwnerId] of pickOwnerMap) {
    const [season, roundStr, originalRosterIdStr] = key.split('-');
    const round = parseInt(roundStr);
    const originalRosterId = parseInt(originalRosterIdStr);
    
    const originalPickPos = pickPositionMap.get(originalRosterId) || Math.ceil(numTeams / 2);
    const originalOwnerName = rosterNameMap.get(originalRosterId) || `Team ${originalRosterId}`;
    const currentOwnerName = rosterNameMap.get(currentOwnerId) || `Team ${currentOwnerId}`;
    
    const roundName = round === 1 ? '1st' : round === 2 ? '2nd' : round === 3 ? '3rd' : '4th';
    const isTraded = originalRosterId !== currentOwnerId;
    
    const picks = pickInventory.get(currentOwnerId) || [];
    picks.push({
      season,
      round,
      pickPosition: originalPickPos,
      originalOwner: originalOwnerName,
      displayName: isTraded 
        ? `${season} ${roundName} (${round}.${originalPickPos.toString().padStart(2, '0')}) via ${originalOwnerName}`
        : `${season} ${roundName} (${round}.${originalPickPos.toString().padStart(2, '0')})`,
      estimatedValue: estimateDraftPickValue(round, originalPickPos),
    });
    pickInventory.set(currentOwnerId, picks);
  }
  
  // Sort each manager's picks by value (most valuable first)
  for (const [rosterId, picks] of pickInventory) {
    picks.sort((a, b) => {
      // Sort by season, then round, then position
      if (a.season !== b.season) return parseInt(a.season) - parseInt(b.season);
      if (a.round !== b.round) return a.round - b.round;
      return (a.pickPosition || 6) - (b.pickPosition || 6);
    });
    pickInventory.set(rosterId, picks);
  }
  
  return pickInventory;
}

// Analyze each manager's trade history to predict what trades they'd accept
async function analyzeManagerTradeHistory(
  leagueId: string,
  rosterId: number,
  allPlayers: Record<string, { first_name: string; last_name: string; position: string; age?: number }>,
  userMap: Map<string, { displayName: string; username: string }>,
  rosterOwnerMap: Map<number, string>
): Promise<ManagerTradeHistory> {
  const leagueInfo = await fetchSleeperLeagueInfo(leagueId);
  const season = leagueInfo?.season || new Date().getFullYear().toString();
  
  const transactions = await fetchSleeperTransactions(leagueId, season);
  
  // Filter to just this manager's trades
  const managerTrades = transactions.filter(t => t.roster_ids?.includes(rosterId));
  
  const positionsAcquired: Record<string, number> = {};
  const positionsTraded: Record<string, number> = {};
  const partnerCounts: Record<string, number> = {};
  let youthAcquired = 0;
  let veteranAcquired = 0;
  let picksAcquired = 0;
  let picksTraded = 0;
  let consolidationTrades = 0;
  let depthTrades = 0;
  
  for (const tx of managerTrades) {
    // Skip non-completed trades
    if (tx.status !== 'complete') continue;
    
    // In Sleeper trade transactions:
    // - tx.adds: { playerId: receiving_roster_id } - players moving TO rosters
    // - For this manager: received = adds where value === rosterId
    // - For this manager: given = adds where value !== rosterId (went to other team)
    const receivedPlayerIds = Object.entries(tx.adds || {})
      .filter(([, rid]) => rid === rosterId)
      .map(([playerId]) => playerId);
    
    // Get all player IDs that went to OTHER rosters in this trade (what this manager gave)
    const allTradedPlayerIds = Object.keys(tx.adds || {});
    const givenPlayerIds = allTradedPlayerIds.filter(pid => (tx.adds?.[pid] !== rosterId));
    
    // Track positions acquired
    for (const playerId of receivedPlayerIds) {
      const player = allPlayers[playerId];
      if (player?.position) {
        positionsAcquired[player.position] = (positionsAcquired[player.position] || 0) + 1;
        // Track age preference
        if (player.age && player.age < 26) youthAcquired++;
        else if (player.age && player.age >= 28) veteranAcquired++;
      }
    }
    
    // Track positions traded away
    for (const playerId of givenPlayerIds) {
      const player = allPlayers[playerId];
      if (player?.position) {
        positionsTraded[player.position] = (positionsTraded[player.position] || 0) + 1;
      }
    }
    
    // Track picks
    for (const pick of tx.draft_picks || []) {
      if (pick.owner_id === rosterId) picksAcquired++;
      if (pick.previous_owner_id === rosterId) picksTraded++;
    }
    
    // Track consolidation vs depth trades
    if (receivedPlayerIds.length < givenPlayerIds.length) consolidationTrades++;
    if (receivedPlayerIds.length > givenPlayerIds.length) depthTrades++;
    
    // Track trade partners
    for (const rid of tx.roster_ids || []) {
      if (rid !== rosterId) {
        const ownerId = rosterOwnerMap.get(rid);
        if (ownerId) {
          const partner = userMap.get(ownerId);
          if (partner) {
            partnerCounts[partner.displayName] = (partnerCounts[partner.displayName] || 0) + 1;
          }
        }
      }
    }
  }
  
  const prefersYouth = youthAcquired > veteranAcquired;
  const prefersPicks = picksAcquired > picksTraded;
  const prefersConsolidation = consolidationTrades > depthTrades;
  
  const recentTradePartners = Object.entries(partnerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
  
  // Generate likely/unlikely to accept based on patterns
  const likelyToAccept: string[] = [];
  const unlikelyToAccept: string[] = [];
  
  // Top positions they acquire = what they want
  const topAcquired = Object.entries(positionsAcquired)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([pos]) => pos);
  
  // Top positions they trade = what they're willing to give up
  const topTraded = Object.entries(positionsTraded)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([pos]) => pos);
  
  if (topAcquired.length > 0) {
    likelyToAccept.push(`Trades offering ${topAcquired.join('/')}`);
  }
  if (topTraded.length > 0) {
    likelyToAccept.push(`Trades asking for ${topTraded.join('/')}`);
  }
  if (prefersYouth) {
    likelyToAccept.push('Youth-for-production swaps');
    unlikelyToAccept.push('Giving up young players for vets');
  }
  if (prefersPicks) {
    likelyToAccept.push('Trades including draft picks');
    unlikelyToAccept.push('Giving up picks for players');
  }
  if (prefersConsolidation) {
    likelyToAccept.push('2-for-1 consolidation offers');
    unlikelyToAccept.push('1-for-2 depth trades');
  }
  
  return {
    totalTrades: managerTrades.length,
    positionsAcquired,
    positionsTraded,
    prefersYouth,
    prefersPicks,
    prefersConsolidation,
    recentTradePartners,
    likelyToAccept,
    unlikelyToAccept,
  };
}

async function analyzeUserTradingProfile(sleeperUsername: string): Promise<UserTradingProfile> {
  const trades = await prisma.leagueTrade.findMany({
    where: {
      history: {
        sleeperUsername,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      tradingStyle: { youthVsProduction: 0, consolidationVsDepth: 0, picksVsPlayers: 0 },
      positionBias: {},
      favoritePartners: [],
      avgTradeValue: 0,
    };
  }
  
  let wins = 0;
  let youthScore = 0;
  let consolidationScore = 0;
  let picksScore = 0;
  const positionCounts: Record<string, number> = {};
  const partnerCounts: Record<string, number> = {};
  let totalValue = 0;
  
  for (const trade of trades) {
    if ((trade.valueDifferential || 0) > 0) wins++;
    
    const received = (trade.playersReceived as Array<{ name: string; position: string }>) || [];
    const given = (trade.playersGiven as Array<{ name: string; position: string }>) || [];
    const picksReceived = (trade.picksReceived as Array<{ round: number }>) || [];
    const picksGiven = (trade.picksGiven as Array<{ round: number }>) || [];
    
    for (const p of received) {
      const tiered = ALL_TIERED_PLAYERS.find(tp => tp.name.toLowerCase() === p.name.toLowerCase());
      if (tiered?.age && tiered.age < 26) youthScore++;
      positionCounts[p.position] = (positionCounts[p.position] || 0) + 1;
    }
    
    if (received.length < given.length) consolidationScore++;
    if (received.length > given.length) consolidationScore--;
    
    if (picksReceived.length > picksGiven.length) picksScore++;
    if (picksReceived.length < picksGiven.length) picksScore--;
    
    if (trade.partnerName) {
      partnerCounts[trade.partnerName] = (partnerCounts[trade.partnerName] || 0) + 1;
    }
    
    totalValue += trade.valueReceived || 0;
  }
  
  const favoritePartners = Object.entries(partnerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
  
  return {
    totalTrades: trades.length,
    winRate: trades.length > 0 ? wins / trades.length : 0,
    tradingStyle: {
      youthVsProduction: youthScore / Math.max(trades.length, 1),
      consolidationVsDepth: consolidationScore / Math.max(trades.length, 1),
      picksVsPlayers: picksScore / Math.max(trades.length, 1),
    },
    positionBias: positionCounts,
    favoritePartners,
    avgTradeValue: trades.length > 0 ? totalValue / trades.length : 0,
  };
}

async function analyzeManagerProfiles(
  leagueId: string,
  userMap: Map<string, { displayName: string; username: string }>,
  rosters: Array<{ roster_id: number; owner_id: string; settings?: { wins?: number; losses?: number; fpts?: number } }>,
  allPlayers: Record<string, { first_name: string; last_name: string; position: string; age?: number }>,
  pickInventory: Map<number, DraftPickAsset[]>
): Promise<ManagerProfile[]> {
  const profiles: ManagerProfile[] = [];
  
  // Build roster_id -> owner_id map for trade partner lookup
  const rosterOwnerMap = new Map<number, string>();
  for (const r of rosters) {
    if (r.owner_id) rosterOwnerMap.set(r.roster_id, r.owner_id);
  }
  
  const sortedRosters = [...rosters]
    .filter(r => r.owner_id)
    .sort((a, b) => (b.settings?.wins || 0) - (a.settings?.wins || 0) || (b.settings?.fpts || 0) - (a.settings?.fpts || 0));
  
  const topThreshold = Math.ceil(sortedRosters.length / 3);
  const bottomThreshold = Math.floor(sortedRosters.length * 2 / 3);
  
  for (let i = 0; i < sortedRosters.length; i++) {
    const roster = sortedRosters[i];
    const userInfo = userMap.get(roster.owner_id);
    
    let teamSituation: 'contender' | 'rebuilding' | 'middle' = 'middle';
    if (i < topThreshold) teamSituation = 'contender';
    else if (i >= bottomThreshold) teamSituation = 'rebuilding';
    
    const legacyUser = await prisma.legacyUser.findFirst({
      where: { sleeperUserId: roster.owner_id },
    });
    
    let tradingPreferences: ManagerProfile['tradingPreferences'];
    let tradingActivity = 0;
    
    if (legacyUser) {
      const tradeHistories = await prisma.leagueTradeHistory.findMany({
        where: { sleeperUsername: legacyUser.sleeperUsername },
        select: { id: true },
      });
      
      if (tradeHistories.length > 0) {
        const recentTrades = await prisma.leagueTrade.count({
          where: {
            historyId: { in: tradeHistories.map(h => h.id) },
            createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          },
        });
        tradingActivity = recentTrades;
      }
    }
    
    // Analyze this manager's trade history from league transactions
    const tradeHistory = await analyzeManagerTradeHistory(
      leagueId,
      roster.roster_id,
      allPlayers,
      userMap,
      rosterOwnerMap
    );
    
    profiles.push({
      managerId: roster.owner_id,
      managerName: userInfo?.displayName || `Manager ${roster.roster_id}`,
      teamSituation,
      wins: roster.settings?.wins || 0,
      losses: roster.settings?.losses || 0,
      pointsFor: roster.settings?.fpts || 0,
      tradingActivity: tradeHistory.totalTrades || tradingActivity,
      hasUsedLegacy: !!legacyUser,
      tradeHistory,
      draftPicks: pickInventory.get(roster.roster_id) || [],
      tradingPreferences,
    });
  }
  
  return profiles;
}

async function analyzeRosterNeeds(
  userRoster: { players: string[]; starters: string[] },
  allPlayers: Record<string, { position: string }>,
  rosterPositions: string[]
): Promise<RosterNeeds> {
  const positionCounts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const starterCounts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  
  for (const playerId of userRoster.players || []) {
    const player = allPlayers[playerId];
    if (player?.position && positionCounts[player.position] !== undefined) {
      positionCounts[player.position]++;
    }
  }
  
  for (const playerId of userRoster.starters || []) {
    const player = allPlayers[playerId];
    if (player?.position && starterCounts[player.position] !== undefined) {
      starterCounts[player.position]++;
    }
  }
  
  const rosterNeeds: Record<string, number> = {};
  for (const pos of rosterPositions) {
    if (['QB', 'RB', 'WR', 'TE'].includes(pos)) {
      rosterNeeds[pos] = (rosterNeeds[pos] || 0) + 1;
    }
    if (pos === 'FLEX') {
      rosterNeeds['RB'] = (rosterNeeds['RB'] || 0) + 0.33;
      rosterNeeds['WR'] = (rosterNeeds['WR'] || 0) + 0.33;
      rosterNeeds['TE'] = (rosterNeeds['TE'] || 0) + 0.33;
    }
    if (pos === 'SUPER_FLEX') {
      rosterNeeds['QB'] = (rosterNeeds['QB'] || 0) + 0.5;
    }
  }
  
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendations: string[] = [];
  
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const needed = rosterNeeds[pos] || 0;
    const have = positionCounts[pos] || 0;
    const depth = have - needed;
    
    if (depth >= 2) {
      strengths.push(pos);
      recommendations.push(`${pos} depth is strong - consider trading surplus for needs`);
    } else if (depth <= 0) {
      weaknesses.push(pos);
      recommendations.push(`Need more ${pos} depth - target in trades`);
    }
  }
  
  return { strengths, weaknesses, recommendations };
}

async function fetchMarketInsights(fcValues: FantasyCalcPlayer[]): Promise<{
  overvaluedPlayers: string[];
  undervaluedPlayers: string[];
  risingPlayers: string[];
  fallingPlayers: string[];
}> {
  const insights = await prisma.tradeLearningInsight.findMany({
    where: {
      insightType: 'player_value',
      sampleSize: { gte: 3 },
    },
    orderBy: { lastUpdated: 'desc' },
    take: 100,
  });
  
  const overvalued: string[] = [];
  const undervalued: string[] = [];
  
  for (const insight of insights) {
    if (!insight.playerName) continue;
    
    const fcPlayer = findPlayerByName(fcValues, insight.playerName);
    if (!fcPlayer) continue;
    
    const marketTrend = insight.marketTrend;
    if (marketTrend === 'overvalued') overvalued.push(insight.playerName);
    if (marketTrend === 'undervalued') undervalued.push(insight.playerName);
  }
  
  return {
    overvaluedPlayers: overvalued.slice(0, 10),
    undervaluedPlayers: undervalued.slice(0, 10),
    risingPlayers: [],
    fallingPlayers: [],
  };
}

export async function runPreAnalysis(
  sleeperUsername: string,
  sleeperLeagueId: string
): Promise<PreAnalysisResult> {
  const existingCache = await prisma.tradePreAnalysisCache.findUnique({
    where: {
      sleeperUsername_sleeperLeagueId: {
        sleeperUsername,
        sleeperLeagueId,
      },
    },
  });
  
  if (existingCache?.status === 'ready' && existingCache.analysisCompletedAt) {
    const hoursSinceAnalysis = (Date.now() - existingCache.analysisCompletedAt.getTime()) / (1000 * 60 * 60);
    
    if (hoursSinceAnalysis < CACHE_FRESHNESS_HOURS) {
      await prisma.tradePreAnalysisCache.update({
        where: { id: existingCache.id },
        data: { lastUsedAt: new Date() },
      });
      
      const cachedManagerData = extractManagerDataFromCache(existingCache.managerProfiles)
      const cachedTendencies = ((existingCache as any).managerTendencyProfiles as Record<string, ManagerTendencyProfile> | null)
        ?? cachedManagerData.tendencies
      return {
        status: 'ready',
        message: 'Your AI GM is ready with comprehensive analysis!',
        cache: {
          leagueSettings: existingCache.leagueSettings as unknown as LeagueSettings,
          userTradingProfile: existingCache.userTradingProfile as unknown as UserTradingProfile,
          leagueTradePatterns: existingCache.leagueTradePatterns as unknown as LeagueTradePatterns,
          managerProfiles: cachedManagerData.profiles,
          managerTendencies: cachedTendencies,
          rosterNeeds: existingCache.rosterNeeds as unknown as RosterNeeds,
          marketInsights: existingCache.marketInsights as unknown as {
            overvaluedPlayers: string[];
            undervaluedPlayers: string[];
            risingPlayers: string[];
            fallingPlayers: string[];
          },
          lastUpdated: existingCache.analysisCompletedAt,
        },
      };
    }
  }
  
  if (existingCache?.status === 'analyzing') {
    const minutesSinceStart = existingCache.analysisStartedAt 
      ? (Date.now() - existingCache.analysisStartedAt.getTime()) / (1000 * 60)
      : 0;
    
    if (minutesSinceStart < 2) {
      return {
        status: 'analyzing',
        estimatedTime: Math.max(15 - Math.floor(minutesSinceStart * 60), 5),
        message: 'Your AI GM is gathering intelligence. This includes analyzing league trades, roster needs, and market values...',
      };
    }
  }
  
  await prisma.tradePreAnalysisCache.upsert({
    where: {
      sleeperUsername_sleeperLeagueId: {
        sleeperUsername,
        sleeperLeagueId,
      },
    },
    update: {
      status: 'analyzing',
      analysisStartedAt: new Date(),
    },
    create: {
      sleeperUsername,
      sleeperLeagueId,
      status: 'analyzing',
      analysisStartedAt: new Date(),
    },
  });
  
  try {
    // Phase 3 batch 3 — canonical read path WITH the freshness guard.
    //
    // Trade pre-analysis feeds a live trade decision, so this is one of the sites where
    // staleness could mislead: canonical was measured showing a team for 92 NFL players Sleeper
    // had already cut. `DECISION_FRESHNESS_MS` makes the accessor fall through to live for rows
    // whose source observation is older than 6h (or past their source TTL) and overlay only
    // those — one live fetch total, not one per player.
    const tradeFreshness: FreshnessStats = { checked: 0, stale: 0, refreshed: 0, liveFetched: false }
    const [leagueInfo, rosters, userMap, canonicalPlayers] = await Promise.all([
      fetchSleeperLeagueInfo(sleeperLeagueId),
      fetchSleeperRosters(sleeperLeagueId),
      fetchSleeperUsers(sleeperLeagueId),
      getCanonicalPlayerMapForSport('NFL', {
        maxAgeMs: DECISION_FRESHNESS_MS,
        stats: tradeFreshness,
      }),
    ]);

    // Reshaped to the `Record<sleeperId, {first_name,last_name,position,age?}>` the analyzers
    // below already index. `age` is not carried on canonical `Player`; it was already optional
    // here (`age?: number`) and every consumer guards it, so it degrades rather than breaks.
    const allPlayersRes: Record<
      string,
      { first_name: string; last_name: string; position: string; age?: number }
    > = Object.fromEntries(
      [...canonicalPlayers].map(([sleeperId, p]) => {
        const [first = '', ...rest] = (p.name ?? '').split(' ');
        return [sleeperId, { first_name: first, last_name: rest.join(' '), position: p.position }];
      }),
    );
    
    if (!leagueInfo) {
      throw new Error('Could not fetch league info');
    }
    
    const settings = leagueInfo.settings as { type?: number } | null;
    const rosterPositions = leagueInfo.roster_positions || [];
    
    const leagueSettings: LeagueSettings = {
      isDynasty: settings?.type === 2,
      isSuperFlex: rosterPositions.includes('SUPER_FLEX'),
      isTeePremium: rosterPositions.filter((p: string) => p === 'TE').length > 1,
      scoringType: 'PPR',
      rosterPositions,
      teamCount: rosters.length || 12,
    };
    
    const legacyUser = await prisma.legacyUser.findUnique({
      where: { sleeperUsername },
    });
    
    const userRoster = rosters.find((r: { owner_id: string }) => 
      legacyUser && r.owner_id === legacyUser.sleeperUserId
    );
    
    const fcValues = await fetchFantasyCalcValues({
      isDynasty: leagueSettings.isDynasty,
      numQbs: leagueSettings.isSuperFlex ? 2 : 1,
      numTeams: leagueSettings.teamCount,
      ppr: 1,
    });
    
    // Compute draft pick inventory for all managers
    const pickInventory = await computeDraftPickInventory(
      sleeperLeagueId, 
      rosters, 
      userMap, 
      leagueSettings.teamCount
    );
    
    const [
      userTradingProfile,
      leagueTradePatterns,
      managerProfiles,
      rosterNeeds,
      marketInsights,
    ] = await Promise.all([
      analyzeUserTradingProfile(sleeperUsername),
      analyzeLeagueTradePatterns(sleeperLeagueId, allPlayersRes),
      analyzeManagerProfiles(sleeperLeagueId, userMap, rosters, allPlayersRes, pickInventory),
      userRoster 
        ? analyzeRosterNeeds(userRoster, allPlayersRes, rosterPositions)
        : Promise.resolve({ strengths: [], weaknesses: [], recommendations: [] }),
      fetchMarketInsights(fcValues),
    ]);
    
    let tendencyProfiles: Record<string, ManagerTendencyProfile> = {}
    const cachedTendencyAt = (existingCache as any)?.tendencyComputedAt as Date | null | undefined
    const tendencyFresh = cachedTendencyAt
      && (Date.now() - cachedTendencyAt.getTime()) < TENDENCY_CACHE_DAYS * 24 * 60 * 60 * 1000
    
    if (tendencyFresh && (existingCache as any)?.managerTendencyProfiles) {
      tendencyProfiles = (existingCache as any).managerTendencyProfiles as Record<string, ManagerTendencyProfile>
    } else {
      try {
        const tendencyPromises = managerProfiles
          .filter(mp => mp.managerId && mp.managerName)
          .slice(0, 16)
          .map(async (mp) => {
            const userInfo = userMap.get(mp.managerId)
            const username = userInfo?.username || mp.managerName
            const tendency = await computeManagerTendencies(username, sleeperLeagueId, mp.managerName)
            if (tendency) {
              tendency.managerId = mp.managerId
              tendencyProfiles[mp.managerId] = tendency
            }
          })
        await Promise.allSettled(tendencyPromises)
      } catch { /* non-critical */ }
    }

    const combinedManagerData = {
      profiles: managerProfiles,
      tendencies: tendencyProfiles,
    }

    await prisma.tradePreAnalysisCache.update({
      where: {
        sleeperUsername_sleeperLeagueId: {
          sleeperUsername,
          sleeperLeagueId,
        },
      },
      data: {
        status: 'ready',
        leagueName: leagueInfo.name,
        leagueSettings: leagueSettings as unknown as Prisma.InputJsonValue,
        userTradingProfile: userTradingProfile as unknown as Prisma.InputJsonValue,
        leagueTradePatterns: leagueTradePatterns as unknown as Prisma.InputJsonValue,
        managerProfiles: combinedManagerData as unknown as Prisma.InputJsonValue,
        managerTendencyProfiles: tendencyProfiles as unknown as Prisma.InputJsonValue,
        rosterNeeds: rosterNeeds as unknown as Prisma.InputJsonValue,
        marketInsights: marketInsights as unknown as Prisma.InputJsonValue,
        analysisCompletedAt: new Date(),
        tendencyComputedAt: tendencyFresh ? cachedTendencyAt : new Date(),
        lastUsedAt: new Date(),
      },
    });
    
    return {
      status: 'ready',
      message: 'Your AI GM is ready with comprehensive analysis!',
      cache: {
        leagueSettings,
        userTradingProfile,
        leagueTradePatterns,
        managerProfiles,
        managerTendencies: tendencyProfiles,
        rosterNeeds,
        marketInsights,
        lastUpdated: new Date(),
      },
    };
  } catch (error) {
    console.error('Pre-analysis failed:', error);
    
    await prisma.tradePreAnalysisCache.update({
      where: {
        sleeperUsername_sleeperLeagueId: {
          sleeperUsername,
          sleeperLeagueId,
        },
      },
      data: {
        status: 'pending',
      },
    });
    
    return {
      status: 'pending',
      estimatedTime: 20,
      message: 'For a comprehensive trade review, your AI GM needs about 20 seconds to gather league data, trading history, and market values.',
    };
  }
}

export async function getPreAnalysisStatus(
  sleeperUsername: string,
  sleeperLeagueId: string
): Promise<PreAnalysisResult> {
  const cache = await prisma.tradePreAnalysisCache.findUnique({
    where: {
      sleeperUsername_sleeperLeagueId: {
        sleeperUsername,
        sleeperLeagueId,
      },
    },
  });
  
  if (!cache) {
    return {
      status: 'pending',
      estimatedTime: 15,
      message: 'Your AI GM needs about 15 seconds to gather comprehensive intelligence about your league, roster, and the trade market.',
    };
  }
  
  if (cache.status === 'ready' && cache.analysisCompletedAt) {
    const hoursSinceAnalysis = (Date.now() - cache.analysisCompletedAt.getTime()) / (1000 * 60 * 60);
    
    if (hoursSinceAnalysis > STALE_THRESHOLD_HOURS) {
      return {
        status: 'pending',
        estimatedTime: 10,
        message: 'Refreshing your AI GM with the latest market data and player news...',
      };
    }
    
    const statusManagerData = extractManagerDataFromCache(cache.managerProfiles)
    const statusTendencies = ((cache as any).managerTendencyProfiles as Record<string, ManagerTendencyProfile> | null)
      ?? statusManagerData.tendencies
    return {
      status: 'ready',
      message: 'Your AI GM is ready! Trade history and market data loaded.',
      cache: {
        leagueSettings: cache.leagueSettings as unknown as LeagueSettings,
        userTradingProfile: cache.userTradingProfile as unknown as UserTradingProfile,
        leagueTradePatterns: cache.leagueTradePatterns as unknown as LeagueTradePatterns,
        managerProfiles: statusManagerData.profiles,
        managerTendencies: statusTendencies,
        rosterNeeds: cache.rosterNeeds as unknown as RosterNeeds,
        marketInsights: cache.marketInsights as unknown as {
          overvaluedPlayers: string[];
          undervaluedPlayers: string[];
          risingPlayers: string[];
          fallingPlayers: string[];
        },
        lastUpdated: cache.analysisCompletedAt,
      },
    };
  }
  
  if (cache.status === 'analyzing') {
    return {
      status: 'analyzing',
      estimatedTime: 10,
      message: 'Your AI GM is gathering intelligence. Analyzing league trades, roster needs, and market values...',
    };
  }
  
  return {
    status: 'pending',
    estimatedTime: 15,
    message: 'Your AI GM needs about 15 seconds to gather comprehensive intelligence.',
  };
}

export async function triggerBackgroundPreAnalysis(
  sleeperUsername: string,
  sleeperLeagueId: string
): Promise<void> {
  runPreAnalysis(sleeperUsername, sleeperLeagueId).catch(err => {
    console.error('Background pre-analysis failed:', err);
  });
}

export async function invalidateTendencyCache(
  sleeperUsername: string,
  sleeperLeagueId: string
): Promise<void> {
  try {
    const { clearTendencyMemoryCache } = await import('./trade-engine/manager-tendency-engine')
    clearTendencyMemoryCache(sleeperUsername, sleeperLeagueId)

    const existing = await prisma.tradePreAnalysisCache.findFirst({
      where: { sleeperUsername, sleeperLeagueId },
    })
    if (existing) {
      await prisma.tradePreAnalysisCache.update({
        where: { id: existing.id },
        data: {
          managerTendencyProfiles: Prisma.DbNull,
          tendencyComputedAt: null,
        } as any,
      })
    }
    console.log(`[TendencyCache] Invalidated for ${sleeperUsername}/${sleeperLeagueId}`)
  } catch (err) {
    console.error('[TendencyCache] Invalidation error:', err)
  }
}
