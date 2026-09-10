import { prisma } from './prisma';
import {
  getAllLeagueTrades,
  getLeagueRosters,
  getLeagueUsers,
  getAllPlayers,
  SleeperTransaction,
  SleeperRoster,
  SleeperUser,
  SleeperPlayer,
} from './sleeper-client';

export interface OpponentTendencies {
  rookieBias: number;
  riskAversion: number;
  pickPreference: number;
  starChasing: number;
  positionNeeds: Record<string, number>;
  tradeWillingness: number;
  buyLowHunter: number;
  loyaltyFactor: number;
  consolidationPreference: number;
  veteranLean: number;
}

export interface TradeLikelihoodScore {
  overall: number;
  assetMatch: number;
  willingness: number;
  needsAlignment: number;
  reasons: string[];
}

export interface PitchAngle {
  angle: string;
  effectiveness: number;
  description: string;
}

export interface OpponentProfile {
  rosterId: number;
  username: string | null;
  displayName: string | null;
  tendencies: OpponentTendencies;
  tradeLikelihood: TradeLikelihoodScore;
  pitchAngles: PitchAngle[];
  confidence: number;
  tradeCount: number;
  seasonsCovered: number;
}

interface ParsedTrade {
  rosterIds: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draftPicks: Array<{
    season: string;
    round: number;
    roster_id: number;
    previous_owner_id: number;
    owner_id: number;
  }>;
  created: number;
}

function clamp(val: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, val));
}

function computeTendencies(
  trades: ParsedTrade[],
  rosterId: number,
  allPlayers: Record<string, SleeperPlayer>,
  roster: SleeperRoster | null,
): OpponentTendencies {
  const tradeCount = trades.length;
  if (tradeCount === 0) {
    return {
      rookieBias: 0.5,
      riskAversion: 0.5,
      pickPreference: 0.5,
      starChasing: 0.5,
      positionNeeds: {},
      tradeWillingness: 0,
      buyLowHunter: 0.5,
      loyaltyFactor: 0.5,
      consolidationPreference: 0.5,
      veteranLean: 0.5,
    };
  }

  let rookieAcquired = 0;
  let totalPlayersAcquired = 0;
  let picksAcquired = 0;
  let picksGiven = 0;
  let highValueAcquired = 0;
  let lowValueAcquired = 0;
  let totalAcquired = 0;
  let consolidationCount = 0;
  const posAcquired: Record<string, number> = {};
  const acquiredAges: number[] = [];
  const seasons = new Set<string>();
  let totalAssetsIn = 0;
  let totalAssetsOut = 0;

  for (const trade of trades) {
    const myAdds: string[] = [];
    const myDrops: string[] = [];

    if (trade.adds) {
      for (const [playerId, rId] of Object.entries(trade.adds)) {
        if (rId === rosterId) {
          myAdds.push(playerId);
        }
      }
    }

    if (trade.drops) {
      for (const [playerId, rId] of Object.entries(trade.drops)) {
        if (rId === rosterId) {
          myDrops.push(playerId);
        }
      }
    }

    let myPicksIn = 0;
    let myPicksOut = 0;
    for (const pick of trade.draftPicks) {
      if (pick.owner_id === rosterId) {
        myPicksIn++;
        if (pick.round <= 2) highValueAcquired++;
      }
      if (pick.previous_owner_id === rosterId) {
        myPicksOut++;
      }
      seasons.add(pick.season);
    }

    picksAcquired += myPicksIn;
    picksGiven += myPicksOut;
    totalPlayersAcquired += myAdds.length;

    const tradeAssetsIn = myAdds.length + myPicksIn;
    const tradeAssetsOut = myDrops.length + myPicksOut;
    totalAssetsIn += tradeAssetsIn;
    totalAssetsOut += tradeAssetsOut;

    if (tradeAssetsOut > 0 && tradeAssetsIn > 0 && tradeAssetsIn < tradeAssetsOut) {
      consolidationCount++;
    }

    for (const pid of myAdds) {
      totalAcquired++;
      const player = allPlayers[pid];
      if (!player) continue;

      const age = player.age || 0;
      const yearsExp = player.years_exp ?? 99;

      if (yearsExp <= 1 || age <= 23) {
        rookieAcquired++;
      }
      if (age > 0) acquiredAges.push(age);

      const pos = player.position;
      if (pos) {
        posAcquired[pos] = (posAcquired[pos] || 0) + 1;
      }
    }

    const tradeDate = new Date(trade.created);
    seasons.add(tradeDate.getFullYear().toString());
  }

  const rookieBias = totalPlayersAcquired > 0
    ? clamp((rookieAcquired / totalPlayersAcquired) * 2)
    : 0.5;

  const totalPickMoves = picksAcquired + picksGiven;
  const pickPreference = totalPickMoves > 0
    ? clamp((picksAcquired / totalPickMoves))
    : 0.5;

  const avgAge = acquiredAges.length > 0
    ? acquiredAges.reduce((a, b) => a + b, 0) / acquiredAges.length
    : 26;
  const veteranLean = clamp((avgAge - 22) / 10);

  const riskAversion = clamp(1 - (rookieBias * 0.3 + (1 - pickPreference) * 0.3 + (1 - veteranLean) * 0.2 + (consolidationCount / Math.max(tradeCount, 1)) * 0.2));

  const totalAssetsAcquired = totalAcquired + picksAcquired;
  const starChasing = totalAssetsAcquired > 0
    ? clamp((highValueAcquired / totalAssetsAcquired) * 3)
    : 0.5;

  const seasonCount = Math.max(seasons.size, 1);
  const tradesPerSeason = tradeCount / seasonCount;
  const tradeWillingness = clamp(tradesPerSeason / 10);

  const buyLowHunter = clamp((1 - starChasing) * 0.5 + rookieBias * 0.3 + (1 - riskAversion) * 0.2);

  const loyaltyFactor = clamp(1 - tradeWillingness * 0.6 - (totalPlayersAcquired / Math.max(tradeCount * 3, 1)) * 0.4);

  const consolidationPreference = tradeCount > 0
    ? clamp((consolidationCount / tradeCount) * 1.5)
    : 0.5;

  const positionNeeds: Record<string, number> = {};
  if (roster && roster.players) {
    const rosterPositions: Record<string, number> = {};
    for (const pid of roster.players) {
      const player = allPlayers[pid];
      if (player?.position) {
        rosterPositions[player.position] = (rosterPositions[player.position] || 0) + 1;
      }
    }

    const idealDistribution: Record<string, number> = {
      QB: 3, RB: 6, WR: 6, TE: 3,
    };

    for (const [pos, ideal] of Object.entries(idealDistribution)) {
      const current = rosterPositions[pos] || 0;
      const needScore = (ideal - current) / ideal;
      positionNeeds[pos] = Math.round(clamp(needScore, -1, 1) * 100) / 100;
    }
  }

  return {
    rookieBias: Math.round(rookieBias * 100) / 100,
    riskAversion: Math.round(riskAversion * 100) / 100,
    pickPreference: Math.round(pickPreference * 100) / 100,
    starChasing: Math.round(starChasing * 100) / 100,
    positionNeeds,
    tradeWillingness: Math.round(tradeWillingness * 100) / 100,
    buyLowHunter: Math.round(buyLowHunter * 100) / 100,
    loyaltyFactor: Math.round(loyaltyFactor * 100) / 100,
    consolidationPreference: Math.round(consolidationPreference * 100) / 100,
    veteranLean: Math.round(veteranLean * 100) / 100,
  };
}

function scoreTradeLikelihood(
  userTendencies: OpponentTendencies | null,
  opponentTendencies: OpponentTendencies,
): TradeLikelihoodScore {
  const reasons: string[] = [];

  const willingness = opponentTendencies.tradeWillingness;
  if (willingness >= 0.6) {
    reasons.push('Active trader — frequently makes deals');
  } else if (willingness <= 0.2) {
    reasons.push('Rarely trades — hard to engage');
  }

  let needsAlignment = 0.5;
  if (userTendencies) {
    const userSurplus = Object.entries(userTendencies.positionNeeds)
      .filter(([, v]) => v <= 0);
    const oppNeeds = Object.entries(opponentTendencies.positionNeeds)
      .filter(([, v]) => v > 0.2);

    let matchCount = 0;
    for (const [pos] of oppNeeds) {
      if (userSurplus.some(([p]) => p === pos)) {
        matchCount++;
        reasons.push(`They need ${pos} — you have surplus`);
      }
    }

    if (oppNeeds.length > 0) {
      needsAlignment = clamp(0.3 + (matchCount / oppNeeds.length) * 0.7);
    }
  }

  let assetMatch = 0.5;
  if (userTendencies) {
    if (opponentTendencies.pickPreference > 0.6 && userTendencies.pickPreference < 0.5) {
      assetMatch += 0.15;
      reasons.push('They want picks — you can offer picks');
    }
    if (opponentTendencies.rookieBias > 0.6 && userTendencies.rookieBias < 0.4) {
      assetMatch += 0.1;
      reasons.push('They target rookies — you can package young players');
    }
    if (opponentTendencies.veteranLean > 0.6 && userTendencies.veteranLean < 0.5) {
      assetMatch += 0.1;
      reasons.push('They prefer veterans — you can offer proven talent');
    }
    assetMatch = clamp(assetMatch);
  }

  const overall = clamp(
    willingness * 0.35 +
    assetMatch * 0.30 +
    needsAlignment * 0.25 +
    (1 - opponentTendencies.loyaltyFactor) * 0.10
  );

  return {
    overall: Math.round(overall * 100),
    assetMatch: Math.round(assetMatch * 100),
    willingness: Math.round(willingness * 100),
    needsAlignment: Math.round(needsAlignment * 100),
    reasons: reasons.slice(0, 5),
  };
}

function generatePitchAngles(tendencies: OpponentTendencies): PitchAngle[] {
  const angles: PitchAngle[] = [];

  if (tendencies.rookieBias >= 0.55) {
    angles.push({
      angle: 'Youth Appeal',
      effectiveness: Math.round(tendencies.rookieBias * 100),
      description: 'Highlight the upside and dynasty ceiling of young players in your offer. Frame the trade as investing in the future.',
    });
  }

  if (tendencies.veteranLean >= 0.55) {
    angles.push({
      angle: 'Proven Production',
      effectiveness: Math.round(tendencies.veteranLean * 100),
      description: 'Emphasize the reliability and floor of veteran players. Focus on "win now" narrative and championship upside.',
    });
  }

  if (tendencies.pickPreference >= 0.55) {
    angles.push({
      angle: 'Draft Capital',
      effectiveness: Math.round(tendencies.pickPreference * 100),
      description: 'Include draft picks to sweeten the deal. They value future flexibility and lottery tickets in the draft.',
    });
  }

  if (tendencies.starChasing >= 0.55) {
    angles.push({
      angle: 'Star Power',
      effectiveness: Math.round(tendencies.starChasing * 100),
      description: 'Lead with a high-name-value player. They gravitate toward recognizable stars and elite talent.',
    });
  }

  if (tendencies.buyLowHunter >= 0.55) {
    angles.push({
      angle: 'Buy-Low Opportunity',
      effectiveness: Math.round(tendencies.buyLowHunter * 100),
      description: 'Position your offer as a buy-low window. Emphasize undervalued assets and bounce-back potential.',
    });
  }

  if (tendencies.consolidationPreference >= 0.55) {
    angles.push({
      angle: 'Consolidation Play',
      effectiveness: Math.round(tendencies.consolidationPreference * 100),
      description: 'Offer multiple pieces for their star. They prefer consolidating depth into top-tier talent.',
    });
  }

  if (tendencies.riskAversion >= 0.6) {
    angles.push({
      angle: 'Safe Floor Play',
      effectiveness: Math.round(tendencies.riskAversion * 100),
      description: 'Emphasize stability and low risk. Offer consistent producers rather than boom-or-bust assets.',
    });
  }

  if (tendencies.riskAversion <= 0.35) {
    angles.push({
      angle: 'High Upside Gamble',
      effectiveness: Math.round((1 - tendencies.riskAversion) * 100),
      description: 'Lean into upside narratives. They enjoy swinging for the fences and taking calculated risks.',
    });
  }

  if (Object.keys(tendencies.positionNeeds).length > 0) {
    const topNeed = Object.entries(tendencies.positionNeeds)
      .sort((a, b) => b[1] - a[1])[0];
    if (topNeed && topNeed[1] > 0.3) {
      angles.push({
        angle: `${topNeed[0]} Reinforcement`,
        effectiveness: Math.round(topNeed[1] * 100),
        description: `They are thin at ${topNeed[0]}. Offering ${topNeed[0]} depth will significantly increase acceptance odds.`,
      });
    }
  }

  angles.sort((a, b) => b.effectiveness - a.effectiveness);
  return angles.slice(0, 5);
}

const TENDENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function computeLeagueOpponentTendencies(
  leagueId: string,
  userRosterId: number,
): Promise<OpponentProfile[]> {
  const [rosters, users, allPlayers] = await Promise.all([
    getLeagueRosters(leagueId),
    getLeagueUsers(leagueId),
    getAllPlayers(),
  ]);

  const userMap = new Map<string, SleeperUser>();
  for (const u of users) {
    userMap.set(u.user_id, u);
  }

  let allTrades: SleeperTransaction[] = [];
  try {
    allTrades = await getAllLeagueTrades(leagueId, 18);
  } catch {
    allTrades = [];
  }

  const tradesByRoster = new Map<number, ParsedTrade[]>();
  for (const txn of allTrades) {
    if (txn.type !== 'trade' || txn.status !== 'complete') continue;

    const parsed: ParsedTrade = {
      rosterIds: txn.roster_ids,
      adds: txn.adds,
      drops: txn.drops,
      draftPicks: txn.draft_picks || [],
      created: txn.created,
    };

    for (const rId of txn.roster_ids) {
      const existing = tradesByRoster.get(rId) || [];
      existing.push(parsed);
      tradesByRoster.set(rId, existing);
    }
  }

  let userTendencies: OpponentTendencies | null = null;
  const userRoster = rosters.find(r => r.roster_id === userRosterId) || null;
  const userTrades = tradesByRoster.get(userRosterId) || [];
  if (userTrades.length > 0) {
    userTendencies = computeTendencies(userTrades, userRosterId, allPlayers, userRoster);
  }

  const profiles: OpponentProfile[] = [];

  for (const roster of rosters) {
    if (roster.roster_id === userRosterId) continue;

    const owner = userMap.get(roster.owner_id);
    const rosterTrades = tradesByRoster.get(roster.roster_id) || [];
    const tendencies = computeTendencies(rosterTrades, roster.roster_id, allPlayers, roster);
    const tradeLikelihood = scoreTradeLikelihood(userTendencies, tendencies);
    const pitchAngles = generatePitchAngles(tendencies);
    const seasons = new Set<string>();
    for (const t of rosterTrades) {
      seasons.add(new Date(t.created).getFullYear().toString());
    }

    const confidence = computeConfidence(rosterTrades.length, seasons.size);

    profiles.push({
      rosterId: roster.roster_id,
      username: owner?.username || null,
      displayName: owner?.display_name || null,
      tendencies,
      tradeLikelihood,
      pitchAngles,
      confidence,
      tradeCount: rosterTrades.length,
      seasonsCovered: seasons.size,
    });
  }

  profiles.sort((a, b) => b.tradeLikelihood.overall - a.tradeLikelihood.overall);

  return profiles;
}

function computeConfidence(tradeCount: number, seasonsCovered: number): number {
  const tradeSignal = Math.min(tradeCount / 15, 1) * 0.7;
  const seasonSignal = Math.min(seasonsCovered / 3, 1) * 0.3;
  return Math.round((tradeSignal + seasonSignal) * 100) / 100;
}

export async function getOrComputeOpponentTendencies(
  leagueId: string,
  userRosterId: number,
  forceRefresh = false,
): Promise<OpponentProfile[]> {
  if (!forceRefresh) {
    const cached = await prisma.opponentTendency.findMany({
      where: { leagueId },
    });

    if (cached.length > 0) {
      const freshEnough = cached.every(
        c => Date.now() - c.lastComputedAt.getTime() < TENDENCY_TTL_MS
      );

      if (freshEnough) {
        return cached.map(c => ({
          rosterId: c.rosterId,
          username: c.username,
          displayName: c.displayName,
          tendencies: c.tendencies as unknown as OpponentTendencies,
          tradeLikelihood: c.tradeLikelihood as unknown as TradeLikelihoodScore,
          pitchAngles: c.pitchAngles as unknown as PitchAngle[],
          confidence: c.confidence,
          tradeCount: c.tradeCount,
          seasonsCovered: c.seasonsCovered,
        }));
      }
    }
  }

  const profiles = await computeLeagueOpponentTendencies(leagueId, userRosterId);

  const upsertOps = profiles.map(p =>
    prisma.opponentTendency.upsert({
      where: {
        leagueId_rosterId: {
          leagueId,
          rosterId: p.rosterId,
        },
      },
      create: {
        leagueId,
        rosterId: p.rosterId,
        username: p.username,
        displayName: p.displayName,
        tendencies: p.tendencies as any,
        tradeLikelihood: p.tradeLikelihood as any,
        pitchAngles: p.pitchAngles as any,
        confidence: p.confidence,
        tradeCount: p.tradeCount,
        seasonsCovered: p.seasonsCovered,
        lastComputedAt: new Date(),
      },
      update: {
        username: p.username,
        displayName: p.displayName,
        tendencies: p.tendencies as any,
        tradeLikelihood: p.tradeLikelihood as any,
        pitchAngles: p.pitchAngles as any,
        confidence: p.confidence,
        tradeCount: p.tradeCount,
        seasonsCovered: p.seasonsCovered,
        lastComputedAt: new Date(),
      },
    })
  );

  await Promise.all(upsertOps);

  return profiles;
}

export async function getCachedOpponentProfile(
  leagueId: string,
  targetRosterId: number,
): Promise<OpponentProfile | null> {
  const cached = await prisma.opponentTendency.findUnique({
    where: {
      leagueId_rosterId: {
        leagueId,
        rosterId: targetRosterId,
      },
    },
  });

  if (!cached) return null;

  return {
    rosterId: cached.rosterId,
    username: cached.username,
    displayName: cached.displayName,
    tendencies: cached.tendencies as unknown as OpponentTendencies,
    tradeLikelihood: cached.tradeLikelihood as unknown as TradeLikelihoodScore,
    pitchAngles: cached.pitchAngles as unknown as PitchAngle[],
    confidence: cached.confidence,
    tradeCount: cached.tradeCount,
    seasonsCovered: cached.seasonsCovered,
  };
}

export function formatOpponentForPrompt(_profile: OpponentProfile): string {
  return ''
}
