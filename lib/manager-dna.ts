import { prisma } from './prisma';
import {
  getLeagueTransactions,
  getAllPlayers,
  SleeperTransaction,
  SleeperPlayer,
} from './sleeper-client';

export interface DNAMetrics {
  riskTolerance: number;
  patience: number;
  positionBias: Record<string, number>;
  consolidationTendency: number;
  pickHoarding: number;
  tradeFrequency: number;
  waiverAggressiveness: number;
  agePreference: number;
  buyLowTendency: number;
  sellHighTendency: number;
}

export interface ManagerDNAProfile {
  archetype: string;
  secondaryArchetype: string | null;
  metrics: DNAMetrics;
  strengths: string[];
  blindSpots: string[];
  recommendations: string[];
  confidence: number;
  tradeCount: number;
  waiverCount: number;
  seasonsCovered: number;
}

const ARCHETYPES = {
  THE_ARCHITECT: {
    id: 'The Architect',
    description: 'Patient dynasty builder who drafts well and develops talent',
    check: (m: DNAMetrics) =>
      m.patience >= 0.65 && m.riskTolerance <= 0.45 && m.pickHoarding >= 0.5,
  },
  THE_GAMBLER: {
    id: 'The Gambler',
    description: 'High risk/reward trader who swings for the fences',
    check: (m: DNAMetrics) =>
      m.riskTolerance >= 0.65 && m.buyLowTendency >= 0.5,
  },
  THE_HOARDER: {
    id: 'The Hoarder',
    description: 'Stockpiles draft picks and rarely spends them',
    check: (m: DNAMetrics) =>
      m.pickHoarding >= 0.7 && m.tradeFrequency <= 0.4,
  },
  THE_WIN_NOW_GENERAL: {
    id: 'The Win-Now General',
    description: 'Aggressive contender trading picks for proven talent',
    check: (m: DNAMetrics) =>
      m.riskTolerance >= 0.5 && m.pickHoarding <= 0.35 && m.agePreference >= 0.55,
  },
  THE_WHEELER_DEALER: {
    id: 'The Wheeler-Dealer',
    description: 'Trades frequently and is always working an angle',
    check: (m: DNAMetrics) =>
      m.tradeFrequency >= 0.7 && m.consolidationTendency >= 0.4,
  },
  THE_WAIVER_HAWK: {
    id: 'The Waiver Hawk',
    description: 'Dominates the waiver wire with aggressive FAAB spending',
    check: (m: DNAMetrics) =>
      m.waiverAggressiveness >= 0.65 && m.tradeFrequency <= 0.5,
  },
  THE_YOUTH_CHASER: {
    id: 'The Youth Chaser',
    description: 'Obsessively targets young players and sells aging assets',
    check: (m: DNAMetrics) =>
      m.agePreference <= 0.3 && m.sellHighTendency >= 0.5,
  },
  THE_BALANCED_GM: {
    id: 'The Balanced GM',
    description: 'Well-rounded manager with no extreme tendencies',
    check: (m: DNAMetrics) =>
      m.riskTolerance >= 0.35 && m.riskTolerance <= 0.65 &&
      m.patience >= 0.35 && m.patience <= 0.65 &&
      m.pickHoarding >= 0.3 && m.pickHoarding <= 0.7,
  },
} as const;

const ARCHETYPE_STRENGTHS: Record<string, string[]> = {
  'The Architect': [
    'Builds sustainable dynasty rosters through patience',
    'Maximizes draft capital value over time',
    'Rarely overpays in trades',
  ],
  'The Gambler': [
    'Identifies buy-low windows before the market catches up',
    'Willing to take calculated risks others avoid',
    'Can rapidly rebuild through bold moves',
  ],
  'The Hoarder': [
    'Accumulates draft capital effectively',
    'Maintains strong future flexibility',
    'Avoids overpaying at peak market prices',
  ],
  'The Win-Now General': [
    'Maximizes championship windows aggressively',
    'Knows when to push all chips in',
    'Trades picks at peak value for proven talent',
  ],
  'The Wheeler-Dealer': [
    'Finds value through volume and market inefficiencies',
    'Keeps the trade market active and liquid',
    'Adapts quickly to changing roster needs',
  ],
  'The Waiver Hawk': [
    'Identifies breakout players before others',
    'Maximizes roster depth through free agency',
    'Efficient FAAB management and timing',
  ],
  'The Youth Chaser': [
    'Builds long-term dynasty value through youth',
    'Sells aging assets before value decline',
    'Strong at projecting career trajectories',
  ],
  'The Balanced GM': [
    'Adapts strategy to current competitive window',
    'No exploitable blind spots',
    'Consistent performance across all management areas',
  ],
};

const ARCHETYPE_BLIND_SPOTS: Record<string, string[]> = {
  'The Architect': [
    'May miss championship windows by being too patient',
    'Can over-value future picks vs proven talent',
    'Risk of building forever without competing',
  ],
  'The Gambler': [
    'Volatility in roster value from boom-or-bust trades',
    'May sell reliable assets for lottery tickets',
    'Emotional decision-making under pressure',
  ],
  'The Hoarder': [
    'Draft picks lose value if never deployed',
    'May miss competitive windows while stockpiling',
    'Roster can stagnate without active management',
  ],
  'The Win-Now General': [
    'Future flexibility can be severely limited',
    'Aging roster may crash simultaneously',
    'Overpaying for "one more piece" syndrome',
  ],
  'The Wheeler-Dealer': [
    'Volume can lead to net value loss over time',
    'Transaction fatigue may reduce trade partner willingness',
    'Risk of churning roster without improvement',
  ],
  'The Waiver Hawk': [
    'May neglect trade market opportunities',
    'FAAB overspending on marginal upgrades',
    'Waiver additions rarely transform rosters alone',
  ],
  'The Youth Chaser': [
    'May sell proven producers too early',
    'Youth bias can delay competitive windows',
    'Rookie hype can lead to overpaying for unproven talent',
  ],
  'The Balanced GM': [
    'Lack of a dominant strategy can limit ceiling',
    'May not capitalize aggressively enough on opportunities',
    'Can be outmaneuvered by specialists in their domain',
  ],
};

function buildRecommendations(archetype: string, metrics: DNAMetrics): string[] {
  const recs: string[] = [];

  if (metrics.riskTolerance > 0.75) {
    recs.push('Consider adding more stable, floor-based assets to reduce roster volatility');
  }
  if (metrics.riskTolerance < 0.25) {
    recs.push('Look for calculated buy-low opportunities — some risk is necessary for growth');
  }
  if (metrics.patience < 0.3) {
    recs.push('Practice holding players through short-term slumps — many bounce back');
  }
  if (metrics.pickHoarding > 0.8) {
    recs.push('Start deploying some draft capital — picks lose value if never used');
  }
  if (metrics.pickHoarding < 0.2) {
    recs.push('Rebuild some draft capital — future flexibility matters even for contenders');
  }
  if (metrics.waiverAggressiveness < 0.2) {
    recs.push('Be more active on the waiver wire — breakout players are found there');
  }
  if (metrics.consolidationTendency > 0.7) {
    recs.push('Be wary of consolidation fatigue — sometimes roster depth is more valuable than star power');
  }
  if (metrics.agePreference > 0.75) {
    recs.push('Start acquiring younger assets to maintain long-term competitiveness');
  }
  if (metrics.agePreference < 0.25) {
    recs.push('Consider adding some proven veterans who can help you win now');
  }

  const posEntries = Object.entries(metrics.positionBias).sort((a, b) => b[1] - a[1]);
  if (posEntries.length > 0 && posEntries[0][1] > 0.45) {
    recs.push(`Diversify beyond ${posEntries[0][0]} — heavy position bias can limit roster construction`);
  }

  if (archetype === 'The Architect' && metrics.tradeFrequency < 0.3) {
    recs.push('Your patience is a strength, but being more active in trades could accelerate your timeline');
  }
  if (archetype === 'The Win-Now General' && metrics.sellHighTendency < 0.3) {
    recs.push('Learn to sell aging assets near peak value — the window closes faster than expected');
  }

  if (recs.length === 0) {
    recs.push('Keep doing what you\'re doing — your approach is well-balanced');
  }

  return recs.slice(0, 5);
}

function clamp(val: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, val));
}

interface TradeRecord {
  playersGiven: unknown;
  playersReceived: unknown;
  picksGiven: unknown;
  picksReceived: unknown;
  valueGiven: number | null;
  valueReceived: number | null;
  valueDifferential: number | null;
  playerAgeData: unknown;
  analysisResult: unknown;
  season: number;
}

function computeMetrics(
  trades: TradeRecord[],
  waiverTxns: SleeperTransaction[],
  allPlayers: Record<string, SleeperPlayer>,
  rosterPlayerIds: string[],
): DNAMetrics {
  const tradeCount = trades.length;

  let totalAbsDiff = 0;
  let highVolatilityCount = 0;
  let totalPicksGiven = 0;
  let totalPicksReceived = 0;
  let consolidationCount = 0;
  let buyLowCount = 0;
  let sellHighCount = 0;
  const positionCounts: Record<string, number> = {};
  let totalPositionTouches = 0;
  const tradedPlayerAges: number[] = [];
  let analyzedTradeCount = 0;

  for (const trade of trades) {
    const playersGiven = (trade.playersGiven as Array<{ id?: string; name?: string; position?: string }>) || [];
    const playersReceived = (trade.playersReceived as Array<{ id?: string; name?: string; position?: string }>) || [];
    const picksGiven = (trade.picksGiven as Array<unknown>) || [];
    const picksReceived = (trade.picksReceived as Array<unknown>) || [];

    totalPicksGiven += picksGiven.length;
    totalPicksReceived += picksReceived.length;

    if (playersGiven.length < playersReceived.length) {
      consolidationCount++;
    }

    for (const p of [...playersGiven, ...playersReceived]) {
      const pos = p.position || (p.id ? allPlayers[p.id]?.position : null);
      if (pos) {
        positionCounts[pos] = (positionCounts[pos] || 0) + 1;
        totalPositionTouches++;
      }
    }

    const ageData = trade.playerAgeData as Record<string, number> | null;
    if (ageData) {
      for (const age of Object.values(ageData)) {
        if (typeof age === 'number') tradedPlayerAges.push(age);
      }
    }

    if (trade.valueDifferential != null && trade.valueGiven != null) {
      analyzedTradeCount++;
      const absDiff = Math.abs(trade.valueDifferential);
      const avgVal = ((trade.valueGiven || 0) + (trade.valueReceived || 0)) / 2;
      totalAbsDiff += avgVal > 0 ? absDiff / avgVal : 0;

      if (avgVal > 0 && absDiff / avgVal > 0.2) {
        highVolatilityCount++;
      }

      if (trade.valueDifferential > 0 && trade.valueReceived && trade.valueReceived > trade.valueGiven!) {
        buyLowCount++;
      }
      if (trade.valueDifferential < 0 && trade.valueGiven && trade.valueGiven > (trade.valueReceived || 0)) {
        sellHighCount++;
      }
    }
  }

  const avgVolatility = analyzedTradeCount > 0 ? totalAbsDiff / analyzedTradeCount : 0;
  const highVolatilityRate = analyzedTradeCount > 0 ? highVolatilityCount / analyzedTradeCount : 0;
  const riskTolerance = clamp((avgVolatility * 2 + highVolatilityRate) / 2);

  const totalPicks = totalPicksGiven + totalPicksReceived;
  const pickNetRatio = totalPicks > 0
    ? (totalPicksReceived - totalPicksGiven) / totalPicks
    : 0;
  const pickHoarding = clamp((pickNetRatio + 1) / 2);

  const consolidationRate = tradeCount > 0 ? consolidationCount / tradeCount : 0;
  const consolidationTendency = clamp(consolidationRate * 1.5);

  const buyLowRate = analyzedTradeCount > 0 ? buyLowCount / analyzedTradeCount : 0;
  const buyLowTendency = clamp(buyLowRate * 1.5);

  const sellHighRate = analyzedTradeCount > 0 ? sellHighCount / analyzedTradeCount : 0;
  const sellHighTendency = clamp(sellHighRate * 1.5);

  const positionBias: Record<string, number> = {};
  if (totalPositionTouches > 0) {
    for (const [pos, count] of Object.entries(positionCounts)) {
      positionBias[pos] = Math.round((count / totalPositionTouches) * 100) / 100;
    }
  }

  const avgTradedAge = tradedPlayerAges.length > 0
    ? tradedPlayerAges.reduce((a, b) => a + b, 0) / tradedPlayerAges.length
    : 26;
  const agePreference = clamp((avgTradedAge - 22) / 10);

  const seasons = new Set(trades.map(t => t.season));
  const seasonCount = Math.max(seasons.size, 1);
  const tradesPerSeason = tradeCount / seasonCount;
  const tradeFrequency = clamp(tradesPerSeason / 12);

  let totalFaabSpent = 0;
  let faabTxnCount = 0;
  for (const txn of waiverTxns) {
    if (txn.waiver_budget && txn.waiver_budget.length > 0) {
      for (const wb of txn.waiver_budget) {
        if (wb.amount > 0) {
          totalFaabSpent += wb.amount;
          faabTxnCount++;
        }
      }
    }
  }
  const avgFaabPerClaim = faabTxnCount > 0 ? totalFaabSpent / faabTxnCount : 0;
  const waiverAggressiveness = clamp(avgFaabPerClaim / 25);

  const rosterAges: number[] = [];
  for (const pid of rosterPlayerIds) {
    const player = allPlayers[pid];
    if (player?.age) rosterAges.push(player.age);
  }

  const holdTime = tradeCount > 0 ? 1 - tradeFrequency : 0.7;
  const patience = clamp((holdTime * 0.6) + ((1 - riskTolerance) * 0.4));

  return {
    riskTolerance: Math.round(riskTolerance * 100) / 100,
    patience: Math.round(patience * 100) / 100,
    positionBias,
    consolidationTendency: Math.round(consolidationTendency * 100) / 100,
    pickHoarding: Math.round(pickHoarding * 100) / 100,
    tradeFrequency: Math.round(tradeFrequency * 100) / 100,
    waiverAggressiveness: Math.round(waiverAggressiveness * 100) / 100,
    agePreference: Math.round(agePreference * 100) / 100,
    buyLowTendency: Math.round(buyLowTendency * 100) / 100,
    sellHighTendency: Math.round(sellHighTendency * 100) / 100,
  };
}

function classifyArchetype(metrics: DNAMetrics): { primary: string; secondary: string | null } {
  const scored: Array<{ id: string; score: number }> = [];

  for (const [, arch] of Object.entries(ARCHETYPES)) {
    if (arch.check(metrics)) {
      let score = 0;

      if (arch.id === 'The Architect') {
        score = metrics.patience * 0.4 + (1 - metrics.riskTolerance) * 0.3 + metrics.pickHoarding * 0.3;
      } else if (arch.id === 'The Gambler') {
        score = metrics.riskTolerance * 0.5 + metrics.buyLowTendency * 0.3 + metrics.tradeFrequency * 0.2;
      } else if (arch.id === 'The Hoarder') {
        score = metrics.pickHoarding * 0.5 + (1 - metrics.tradeFrequency) * 0.3 + metrics.patience * 0.2;
      } else if (arch.id === 'The Win-Now General') {
        score = (1 - metrics.pickHoarding) * 0.4 + metrics.agePreference * 0.3 + metrics.riskTolerance * 0.3;
      } else if (arch.id === 'The Wheeler-Dealer') {
        score = metrics.tradeFrequency * 0.5 + metrics.consolidationTendency * 0.3 + metrics.riskTolerance * 0.2;
      } else if (arch.id === 'The Waiver Hawk') {
        score = metrics.waiverAggressiveness * 0.5 + (1 - metrics.tradeFrequency) * 0.3 + metrics.patience * 0.2;
      } else if (arch.id === 'The Youth Chaser') {
        score = (1 - metrics.agePreference) * 0.5 + metrics.sellHighTendency * 0.3 + metrics.patience * 0.2;
      } else if (arch.id === 'The Balanced GM') {
        const centeredness = 1 - (
          Math.abs(metrics.riskTolerance - 0.5) +
          Math.abs(metrics.patience - 0.5) +
          Math.abs(metrics.pickHoarding - 0.5)
        ) / 1.5;
        score = centeredness;
      }

      scored.push({ id: arch.id, score });
    }
  }

  if (scored.length === 0) {
    return { primary: 'The Balanced GM', secondary: null };
  }

  scored.sort((a, b) => b.score - a.score);

  const primary = scored[0].id;
  const secondary = scored.length > 1 && scored[1].score > 0.3 ? scored[1].id : null;

  return { primary, secondary };
}

function computeConfidence(tradeCount: number, waiverCount: number, seasonsCovered: number): number {
  const tradeSignal = Math.min(tradeCount / 20, 1) * 0.5;
  const waiverSignal = Math.min(waiverCount / 30, 1) * 0.2;
  const seasonSignal = Math.min(seasonsCovered / 3, 1) * 0.3;
  return Math.round((tradeSignal + waiverSignal + seasonSignal) * 100) / 100;
}

export async function computeManagerDNA(
  sleeperUsername: string,
  leagueIds: string[],
): Promise<ManagerDNAProfile> {
  const allTrades: TradeRecord[] = [];
  const allWaiverTxns: SleeperTransaction[] = [];
  const allRosterPlayerIds: string[] = [];
  const seasonsSet = new Set<number>();

  const histories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperUsername },
    include: {
      trades: {
        select: {
          playersGiven: true,
          playersReceived: true,
          picksGiven: true,
          picksReceived: true,
          valueGiven: true,
          valueReceived: true,
          valueDifferential: true,
          playerAgeData: true,
          analysisResult: true,
          season: true,
        },
      },
    },
  });

  for (const history of histories) {
    for (const trade of history.trades) {
      allTrades.push(trade);
      seasonsSet.add(trade.season);
    }
  }

  const allPlayers = await getAllPlayers();

  for (const leagueId of leagueIds.slice(0, 5)) {
    try {
      for (let week = 1; week <= 18; week++) {
        const txns = await getLeagueTransactions(leagueId, week);
        for (const txn of txns) {
          if (txn.type === 'waiver' || txn.type === 'free_agent') {
            allWaiverTxns.push(txn);
          }
        }
      }
    } catch {
    }
  }

  if (leagueIds.length > 0) {
    try {
      const { getLeagueRosters, getLeagueUsers } = await import('./sleeper-client');
      const resolvedUser = await (await import('./sleeper-client')).resolveSleeperUser(sleeperUsername);
      if (resolvedUser) {
        for (const leagueId of leagueIds.slice(0, 3)) {
          const [rosters, users] = await Promise.all([
            getLeagueRosters(leagueId),
            getLeagueUsers(leagueId),
          ]);
          const userMapping = new Map(users.map(u => [u.user_id, u]));
          const userRoster = rosters.find(r => {
            const owner = userMapping.get(r.owner_id);
            return owner?.username === resolvedUser.username || r.owner_id === resolvedUser.userId;
          });
          if (userRoster?.players) {
            allRosterPlayerIds.push(...userRoster.players);
          }
        }
      }
    } catch {
    }
  }

  const metrics = computeMetrics(allTrades, allWaiverTxns, allPlayers, allRosterPlayerIds);
  const { primary, secondary } = classifyArchetype(metrics);
  const confidence = computeConfidence(allTrades.length, allWaiverTxns.length, seasonsSet.size);
  const strengths = ARCHETYPE_STRENGTHS[primary] || ARCHETYPE_STRENGTHS['The Balanced GM'];
  const blindSpots = ARCHETYPE_BLIND_SPOTS[primary] || ARCHETYPE_BLIND_SPOTS['The Balanced GM'];
  const recommendations = buildRecommendations(primary, metrics);

  return {
    archetype: primary,
    secondaryArchetype: secondary,
    metrics,
    strengths,
    blindSpots,
    recommendations,
    confidence,
    tradeCount: allTrades.length,
    waiverCount: allWaiverTxns.length,
    seasonsCovered: seasonsSet.size,
  };
}

const DNA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function getOrComputeManagerDNA(
  sleeperUsername: string,
  leagueIds: string[],
  forceRefresh = false,
): Promise<ManagerDNAProfile> {
  if (!forceRefresh) {
    const existing = await prisma.managerDNA.findUnique({
      where: { sleeperUsername },
    });

    if (existing && Date.now() - existing.lastComputedAt.getTime() < DNA_TTL_MS) {
      return {
        archetype: existing.archetype,
        secondaryArchetype: existing.secondaryArchetype,
        metrics: existing.metrics as unknown as DNAMetrics,
        strengths: existing.strengths as unknown as string[],
        blindSpots: existing.blindSpots as unknown as string[],
        recommendations: existing.recommendations as unknown as string[],
        confidence: existing.confidence,
        tradeCount: existing.tradeCount,
        waiverCount: existing.waiverCount,
        seasonsCovered: existing.seasonsCovered,
      };
    }
  }

  const profile = await computeManagerDNA(sleeperUsername, leagueIds);

  const resolvedUser = await (await import('./sleeper-client')).resolveSleeperUser(sleeperUsername);

  await prisma.managerDNA.upsert({
    where: { sleeperUsername },
    create: {
      sleeperUsername,
      sleeperUserId: resolvedUser?.userId || null,
      archetype: profile.archetype,
      secondaryArchetype: profile.secondaryArchetype,
      metrics: profile.metrics as any,
      strengths: profile.strengths,
      blindSpots: profile.blindSpots,
      recommendations: profile.recommendations,
      confidence: profile.confidence,
      tradeCount: profile.tradeCount,
      waiverCount: profile.waiverCount,
      seasonsCovered: profile.seasonsCovered,
      lastComputedAt: new Date(),
    },
    update: {
      sleeperUserId: resolvedUser?.userId || undefined,
      archetype: profile.archetype,
      secondaryArchetype: profile.secondaryArchetype,
      metrics: profile.metrics as any,
      strengths: profile.strengths,
      blindSpots: profile.blindSpots,
      recommendations: profile.recommendations,
      confidence: profile.confidence,
      tradeCount: profile.tradeCount,
      waiverCount: profile.waiverCount,
      seasonsCovered: profile.seasonsCovered,
      lastComputedAt: new Date(),
    },
  });

  return profile;
}

export function formatDNAForPrompt(_dna: ManagerDNAProfile): string {
  // Raw inferred traits are internal. Supply selected-decision evidence through its own contract.
  return ''
}

export async function getCachedDNA(sleeperUsername: string): Promise<ManagerDNAProfile | null> {
  const existing = await prisma.managerDNA.findUnique({
    where: { sleeperUsername },
  });

  if (!existing) return null;

  return {
    archetype: existing.archetype,
    secondaryArchetype: existing.secondaryArchetype,
    metrics: existing.metrics as unknown as DNAMetrics,
    strengths: existing.strengths as unknown as string[],
    blindSpots: existing.blindSpots as unknown as string[],
    recommendations: existing.recommendations as unknown as string[],
    confidence: existing.confidence,
    tradeCount: existing.tradeCount,
    waiverCount: existing.waiverCount,
    seasonsCovered: existing.seasonsCovered,
  };
}
