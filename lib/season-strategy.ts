import { prisma } from './prisma';
import {
  getLeagueRosters,
  getLeagueInfo,
  getTradedDraftPicks,
  getAllPlayers,
  getPlayerName,
  getLeagueType,
  getScoringType,
  SleeperRoster,
  SleeperLeague,
  SleeperPlayer,
  SleeperDraftPick,
} from './sleeper-client';
import { pricePlayer, pricePick, ValuationContext, PickInput } from './hybrid-valuation';
import { resolveLeagueValuePatch } from '@/lib/values/leagueValuePatch';
import { openaiChatText } from './openai-client';

const STRATEGY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ClassificationMetrics {
  rosterValue: number;
  rosterValueRank: number;
  rosterValuePercentile: number;
  starterValue: number;
  starterValueRank: number;
  winRate: number;
  winRateRank: number;
  pointsFor: number;
  pointsForRank: number;
  draftCapitalValue: number;
  draftCapitalRank: number;
  avgAge: number;
  positionBreakdown: Record<string, { count: number; value: number }>;
  contenderScore: number;
  totalTeams: number;
  record: string;
}

export interface StrategyPhase {
  name: string;
  weekRange: string;
  priority: string;
  actions: string[];
  targets: string[];
}

export interface TradeWindow {
  type: 'buy' | 'sell' | 'hold';
  window: string;
  reason: string;
  urgency: 'high' | 'medium' | 'low';
  targets?: string[];
}

export interface RiskPoint {
  category: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  mitigation: string;
}

export interface PlayerMove {
  name: string;
  position: string;
  team: string | null;
  value: number;
  age: number | null;
  reason: string;
}

export interface RosterMoves {
  sellHigh: PlayerMove[];
  tradeChips: PlayerMove[];
  holdCore: PlayerMove[];
  buyLowTargets: string[];
  dropCandidates: PlayerMove[];
  sleepers: PlayerMove[];
}

export interface DraftStrategy {
  approach: string;
  description: string;
  targetPositions: string[];
  roundPlan: Array<{ round: string; focus: string; rationale: string }>;
  picksOwned: number;
  totalPickValue: number;
}

export interface StrategyResult {
  classification: 'contender' | 'competitive' | 'rebuilder';
  confidence: number;
  metrics: ClassificationMetrics;
  roster: RosterSummary;
  standings: StandingsSummary;
  draftCapital: PickSummary[];
  phases: StrategyPhase[];
  tradeWindows: TradeWindow[];
  riskPoints: RiskPoint[];
  rosterMoves: RosterMoves;
  draftStrategy: DraftStrategy;
  aiRoadmap: string;
  weekNumber: number;
  isOffseason: boolean;
  isDynasty: boolean;
  isSuperFlex: boolean;
}

interface RosterSummary {
  players: Array<{ name: string; position: string; team: string | null; value: number; age: number | null }>;
  starters: string[];
  totalValue: number;
}

interface StandingsSummary {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  rank: number;
  totalTeams: number;
  playoffSpots: number;
}

interface PickSummary {
  season: string;
  round: number;
  originalOwner: number;
  value: number;
}

export async function computeSeasonStrategy(
  leagueId: string,
  rosterId: number,
  sleeperUsername?: string,
): Promise<StrategyResult> {
  let league, rosters, allPlayers, tradedPicks;
  try {
    [league, rosters, allPlayers, tradedPicks] = await Promise.all([
      getLeagueInfo(leagueId),
      getLeagueRosters(leagueId),
      getAllPlayers(),
      getTradedDraftPicks(leagueId),
    ]);
  } catch (err) {
    throw new Error(`Failed to fetch league data from Sleeper: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  if (!league) throw new Error('League not found — check that the league ID is correct');
  if (!rosters || rosters.length === 0) throw new Error('No rosters found in this league');

  const userRoster = rosters.find((r: SleeperRoster) => r.roster_id === rosterId);
  if (!userRoster) throw new Error(`Roster #${rosterId} not found in league — make sure you selected the right team`);

  const season = league.season || String(new Date().getFullYear());
  const isSuperFlex = (league.roster_positions || []).filter(p => p === 'SUPER_FLEX').length > 0;
  const leagueType = getLeagueType(league);
  const scoringType = getScoringType(league.scoring_settings || {});
  const isDynasty = leagueType === 'dynasty';

  const currentWeek = detectCurrentWeek(league);

  /*
   * This league's own defenders and kickers, priced by its own scoring and starting slots.
   *
   * 🛑 WITHOUT THIS, EVERY ROSTER VALUE ON THIS PATH COUNTED DEFENDERS AT A FLAT PER-POSITION
   * CONSTANT — see lib/values/leagueValuePatch.ts. In an IDP league that is most of a bench,
   * so the strategy engine's contend/rebuild call was made on a roster total that could not
   * tell an elite linebacker from a replaceable one.
   *
   * The Sleeper payloads fetched above are handed straight through, so this costs one indexed
   * read for the ~100 of 110 leagues that do not score IDP rather than another round trip.
   */
  const valuationCtx: ValuationContext = {
    asOfDate: new Date().toISOString().split('T')[0],
    isSuperFlex,
    ...(await resolveLeagueValuePatch({
      platformLeagueId: leagueId,
      sleeperLeague: league,
      prefetched: { rosters },
    })),
  };

  const allTeamValues = await Promise.all(
    rosters.map(async (roster: SleeperRoster) => {
      try {
        const { totalValue, starterValue, players: pricedPlayers, avgAge, posBreakdown } =
          await valueRoster(roster, allPlayers || {}, valuationCtx);
        const pickValues = await valuePicksForRoster(roster.roster_id, rosters, tradedPicks || [], season, valuationCtx);
        const totalPickValue = pickValues.reduce((s: number, p: any) => s + p.value, 0);

        return {
          rosterId: roster.roster_id,
          ownerId: roster.owner_id,
          totalValue,
          starterValue,
          pickValue: totalPickValue,
          wins: roster.settings?.wins || 0,
          losses: roster.settings?.losses || 0,
          ties: roster.settings?.ties || 0,
          pointsFor: (roster.settings?.fpts || 0) + (roster.settings?.fpts_decimal || 0) / 100,
          avgAge,
          posBreakdown,
          players: pricedPlayers,
          picks: pickValues,
        };
      } catch {
        return {
          rosterId: roster.roster_id,
          ownerId: roster.owner_id,
          totalValue: 0, starterValue: 0, pickValue: 0,
          wins: roster.settings?.wins || 0, losses: roster.settings?.losses || 0, ties: roster.settings?.ties || 0,
          pointsFor: 0, avgAge: 25, posBreakdown: {} as Record<string, { count: number; value: number }>,
          players: [], picks: [],
        };
      }
    })
  );

  allTeamValues.sort((a, b) => b.totalValue - a.totalValue);

  const userTeam = allTeamValues.find(t => t.rosterId === rosterId)!;
  const rosterValueRank = allTeamValues.findIndex(t => t.rosterId === rosterId) + 1;

  const byStarter = [...allTeamValues].sort((a, b) => b.starterValue - a.starterValue);
  const starterValueRank = byStarter.findIndex(t => t.rosterId === rosterId) + 1;

  const byWinRate = [...allTeamValues].sort((a, b) => {
    const aRate = a.wins / Math.max(a.wins + a.losses + a.ties, 1);
    const bRate = b.wins / Math.max(b.wins + b.losses + b.ties, 1);
    return bRate - aRate;
  });
  const winRateRank = byWinRate.findIndex(t => t.rosterId === rosterId) + 1;

  const byPoints = [...allTeamValues].sort((a, b) => b.pointsFor - a.pointsFor);
  const pointsForRank = byPoints.findIndex(t => t.rosterId === rosterId) + 1;

  const byPicks = [...allTeamValues].sort((a, b) => b.pickValue - a.pickValue);
  const draftCapitalRank = byPicks.findIndex(t => t.rosterId === rosterId) + 1;

  const totalTeams = rosters.length;
  const totalGames = userTeam.wins + userTeam.losses + userTeam.ties;
  const winRate = totalGames > 0 ? userTeam.wins / totalGames : 0;

  const metrics: ClassificationMetrics = {
    rosterValue: userTeam.totalValue,
    rosterValueRank,
    rosterValuePercentile: 1 - (rosterValueRank - 1) / Math.max(totalTeams - 1, 1),
    starterValue: userTeam.starterValue,
    starterValueRank,
    winRate,
    winRateRank,
    pointsFor: userTeam.pointsFor,
    pointsForRank,
    draftCapitalValue: userTeam.pickValue,
    draftCapitalRank,
    avgAge: userTeam.avgAge,
    positionBreakdown: userTeam.posBreakdown,
    contenderScore: 0,
    totalTeams,
    record: `${userTeam.wins}-${userTeam.losses}${userTeam.ties > 0 ? `-${userTeam.ties}` : ''}`,
  };

  const playoffSpots = estimatePlayoffSpots(league);
  const { classification, confidence, contenderScore } = classifyTeam(metrics, playoffSpots, isDynasty);
  metrics.contenderScore = contenderScore;

  const rosterSummary: RosterSummary = {
    players: userTeam.players,
    starters: (userRoster.starters || []).map(id => getPlayerName(allPlayers, id)),
    totalValue: userTeam.totalValue,
  };

  const standingsSummary: StandingsSummary = {
    wins: userTeam.wins,
    losses: userTeam.losses,
    ties: userTeam.ties,
    pointsFor: userTeam.pointsFor,
    rank: winRateRank,
    totalTeams,
    playoffSpots,
  };

  const { phases, tradeWindows, riskPoints } = buildDeterministicPlan(
    classification, metrics, currentWeek, isDynasty, rosterSummary, standingsSummary, userTeam.picks
  );

  const rosterMoves = buildRosterMoves(classification, rosterSummary, metrics, isDynasty);
  const draftStrategy = buildDraftStrategy(classification, metrics, userTeam.picks, isDynasty, isSuperFlex);

  const aiRoadmap = await generateAIRoadmap(
    classification, confidence, metrics, rosterSummary, standingsSummary,
    userTeam.picks, phases, tradeWindows, riskPoints, leagueType, scoringType,
    isSuperFlex, isDynasty, currentWeek, league.name
  );

  return {
    classification,
    confidence,
    metrics,
    roster: rosterSummary,
    standings: standingsSummary,
    draftCapital: userTeam.picks,
    phases,
    tradeWindows,
    riskPoints,
    rosterMoves,
    draftStrategy,
    aiRoadmap,
    weekNumber: currentWeek,
    isOffseason: isOffseason(currentWeek),
    isDynasty,
    isSuperFlex,
  };
}

function detectCurrentWeek(league: SleeperLeague): number {
  const settings = league.settings as Record<string, unknown>;
  const legacyWeek = settings['leg'] || settings['last_scored_leg'];
  if (typeof legacyWeek === 'number' && legacyWeek > 0) return legacyWeek;

  const now = new Date();
  const seasonYear = parseInt(league.season || String(now.getFullYear()));
  const seasonStart = new Date(seasonYear, 8, 5);
  const diffMs = now.getTime() - seasonStart.getTime();
  const weekNum = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
  if (weekNum > 18 || weekNum < 1) return 99;
  return weekNum;
}

function isOffseason(currentWeek: number): boolean {
  return currentWeek > 18;
}

function estimatePlayoffSpots(league: SleeperLeague): number {
  const settings = league.settings as Record<string, unknown>;
  const playoffTeams = settings['playoff_teams'];
  if (typeof playoffTeams === 'number') return playoffTeams;
  const totalRosters = league.total_rosters || 12;
  if (totalRosters <= 8) return 4;
  if (totalRosters <= 12) return 6;
  return 8;
}

async function valueRoster(
  roster: SleeperRoster,
  allPlayers: Record<string, SleeperPlayer>,
  ctx: ValuationContext,
): Promise<{
  totalValue: number;
  starterValue: number;
  players: Array<{ name: string; position: string; team: string | null; value: number; age: number | null }>;
  avgAge: number;
  posBreakdown: Record<string, { count: number; value: number }>;
}> {
  const playerIds = roster.players || [];
  const starterIds = new Set(roster.starters || []);
  let totalValue = 0;
  let starterValue = 0;
  const posBreakdown: Record<string, { count: number; value: number }> = {};
  const pricedPlayers: Array<{ name: string; position: string; team: string | null; value: number; age: number | null }> = [];
  let ageSum = 0;
  let ageCount = 0;

  for (const pid of playerIds) {
    const info = allPlayers[pid];
    if (!info) continue;
    const name = info.full_name || `${info.first_name} ${info.last_name}`;
    const pos = info.position || 'UNKNOWN';

    let value = 0;
    try {
      const priced = await pricePlayer(name, ctx);
      value = priced.value;
    } catch { /* unknown player */ }

    totalValue += value;
    if (starterIds.has(pid)) starterValue += value;

    if (!posBreakdown[pos]) posBreakdown[pos] = { count: 0, value: 0 };
    posBreakdown[pos].count++;
    posBreakdown[pos].value += value;

    const age = info.age || null;
    if (age) { ageSum += age; ageCount++; }

    pricedPlayers.push({ name, position: pos, team: info.team, value, age });
  }

  pricedPlayers.sort((a, b) => b.value - a.value);

  return {
    totalValue,
    starterValue,
    players: pricedPlayers,
    avgAge: ageCount > 0 ? Math.round((ageSum / ageCount) * 10) / 10 : 0,
    posBreakdown,
  };
}

async function valuePicksForRoster(
  rosterId: number,
  rosters: SleeperRoster[],
  tradedPicks: SleeperDraftPick[],
  season: string,
  ctx: ValuationContext,
): Promise<PickSummary[]> {
  const currentYear = parseInt(season) || new Date().getFullYear();
  const futureYears = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3];
  const maxRounds = 5;

  const ownership = new Map<string, number>();
  for (const pick of tradedPicks) {
    const s = Number(pick.season);
    const r = Number(pick.round);
    const orig = Number(pick.roster_id);
    const owner = Number(pick.owner_id);
    if (!Number.isFinite(s) || !Number.isFinite(r)) continue;
    ownership.set(`${s}_${r}_${orig}`, owner);
  }

  const picks: PickSummary[] = [];

  for (const year of futureYears) {
    for (let round = 1; round <= maxRounds; round++) {
      for (const roster of rosters) {
        const key = `${year}_${round}_${roster.roster_id}`;
        const currentOwner = ownership.get(key) ?? roster.roster_id;
        if (currentOwner !== rosterId) continue;

        let value = 0;
        try {
          const pickInput: PickInput = { year, round };
          const priced = await pricePick(pickInput, ctx);
          value = priced.value;
        } catch { /* unknown */ }

        picks.push({
          season: String(year),
          round,
          originalOwner: roster.roster_id,
          value,
        });
      }
    }
  }

  picks.sort((a, b) => {
    if (a.season !== b.season) return parseInt(a.season) - parseInt(b.season);
    return a.round - b.round;
  });

  return picks;
}

function classifyTeam(
  metrics: ClassificationMetrics,
  playoffSpots: number,
  isDynasty: boolean,
): { classification: 'contender' | 'competitive' | 'rebuilder'; confidence: number; contenderScore: number } {
  const rosterPct = metrics.rosterValuePercentile;
  const starterPct = 1 - (metrics.starterValueRank - 1) / Math.max(metrics.totalTeams - 1, 1);
  const winPct = 1 - (metrics.winRateRank - 1) / Math.max(metrics.totalTeams - 1, 1);
  const pointsPct = 1 - (metrics.pointsForRank - 1) / Math.max(metrics.totalTeams - 1, 1);
  const pickPct = 1 - (metrics.draftCapitalRank - 1) / Math.max(metrics.totalTeams - 1, 1);

  let score: number;
  if (isDynasty) {
    score = (rosterPct * 0.25) + (starterPct * 0.2) + (winPct * 0.2) + (pointsPct * 0.2) + (pickPct * 0.15);
  } else {
    score = (starterPct * 0.3) + (winPct * 0.3) + (pointsPct * 0.3) + (rosterPct * 0.1);
  }

  const agePenalty = metrics.avgAge > 28 ? (metrics.avgAge - 28) * 0.02 : 0;
  score = Math.max(0, Math.min(1, score - agePenalty));

  let classification: 'contender' | 'competitive' | 'rebuilder';
  if (score >= 0.65) {
    classification = 'contender';
  } else if (score >= 0.35) {
    classification = 'competitive';
  } else {
    classification = 'rebuilder';
  }

  const distFromBoundary = classification === 'contender'
    ? score - 0.65
    : classification === 'rebuilder'
      ? 0.35 - score
      : Math.min(score - 0.35, 0.65 - score);

  const confidence = Math.min(0.95, 0.6 + distFromBoundary * 2);

  return { classification, confidence, contenderScore: Math.round(score * 100) / 100 };
}

function buildRosterMoves(
  classification: 'contender' | 'competitive' | 'rebuilder',
  roster: RosterSummary,
  metrics: ClassificationMetrics,
  isDynasty: boolean,
): RosterMoves {
  const players = roster.players;
  const avgValue = roster.totalValue / Math.max(players.length, 1);

  const sellHigh: PlayerMove[] = [];
  const tradeChips: PlayerMove[] = [];
  const holdCore: PlayerMove[] = [];
  const dropCandidates: PlayerMove[] = [];
  const sleepers: PlayerMove[] = [];

  const positionPeaks: Record<string, number> = { QB: 30, RB: 25, WR: 27, TE: 28 };

  for (const p of players) {
    const pos = p.position;
    const age = p.age || 25;
    const peak = positionPeaks[pos] || 27;
    const isOld = age >= peak + 2;
    const isYoung = age <= peak - 2;
    const isHighValue = p.value >= avgValue * 1.5;
    const isMidValue = p.value >= avgValue * 0.5 && p.value < avgValue * 1.5;
    const isLowValue = p.value < avgValue * 0.3;
    const isMinimal = p.value < 5;

    if (isMinimal && !isYoung) {
      dropCandidates.push({
        ...p,
        reason: `Minimal trade value (${p.value}) — roster spot could be used better`,
      });
      continue;
    }

    if (classification === 'rebuilder') {
      if (isOld && p.value >= 20) {
        sellHigh.push({
          ...p,
          reason: `Age ${age} past ${pos} peak — sell while value (${p.value}) is still high`,
        });
      } else if (isYoung && isHighValue) {
        holdCore.push({
          ...p,
          reason: `Young core piece (age ${age}) — build around this player`,
        });
      } else if (isYoung && isLowValue) {
        sleepers.push({
          ...p,
          reason: `Young (${age}) with room to grow — low cost, high ceiling`,
        });
      } else if (!isYoung && isMidValue) {
        tradeChips.push({
          ...p,
          reason: `Mid-value asset — package in trades for picks or younger players`,
        });
      }
    } else if (classification === 'contender') {
      if (isHighValue) {
        holdCore.push({
          ...p,
          reason: `Championship-caliber starter — keep for your title push`,
        });
      } else if (isOld && isMidValue && isDynasty) {
        sellHigh.push({
          ...p,
          reason: `Aging (${age}) — could sell after the season if you don't win it all`,
        });
      } else if (isLowValue && !isYoung) {
        tradeChips.push({
          ...p,
          reason: `Low impact (${p.value}) — use as trade sweetener for upgrades`,
        });
      } else if (isYoung && isLowValue) {
        sleepers.push({
          ...p,
          reason: `Young (${age}), cheap — could break out into a starter`,
        });
      }
    } else {
      if (isHighValue) {
        holdCore.push({
          ...p,
          reason: `Key asset — hold until you decide to buy or sell`,
        });
      } else if (isOld && isMidValue) {
        sellHigh.push({
          ...p,
          reason: `Age ${age} declining — sell if you commit to rebuilding`,
        });
      } else if (isYoung && isLowValue) {
        sleepers.push({
          ...p,
          reason: `Young upside (${age}) — worth holding to see development`,
        });
      }
    }
  }

  const weakPositions = Object.entries(metrics.positionBreakdown)
    .filter(([pos]) => ['QB', 'RB', 'WR', 'TE'].includes(pos))
    .sort((a, b) => a[1].value - b[1].value)
    .slice(0, 2)
    .map(([pos]) => pos);

  const buyLowTargets: string[] = [];
  if (classification === 'contender') {
    for (const pos of weakPositions) {
      buyLowTargets.push(`Target a ${pos} upgrade — your ${pos} group is among your weakest`);
    }
    buyLowTargets.push('Look for underperforming stars on losing teams — buy the dip');
    buyLowTargets.push('Target players with tough early schedules who face easier matchups later');
  } else if (classification === 'rebuilder') {
    buyLowTargets.push('Target young players on contending teams who can\'t afford to keep them');
    buyLowTargets.push('Buy injured stars at a discount — they\'ll recover and gain value');
    for (const pos of weakPositions) {
      buyLowTargets.push(`Acquire young ${pos} talent to build your future foundation`);
    }
  } else {
    buyLowTargets.push('Monitor the waiver wire for breakout players before committing direction');
    for (const pos of weakPositions) {
      buyLowTargets.push(`${pos} depth is thin — target low-cost options via trade or waivers`);
    }
  }

  return {
    sellHigh: sellHigh.sort((a, b) => b.value - a.value).slice(0, 5),
    tradeChips: tradeChips.sort((a, b) => b.value - a.value).slice(0, 5),
    holdCore: holdCore.sort((a, b) => b.value - a.value).slice(0, 6),
    buyLowTargets: buyLowTargets.slice(0, 4),
    dropCandidates: dropCandidates.sort((a, b) => a.value - b.value).slice(0, 5),
    sleepers: sleepers.sort((a, b) => {
      const ageA = a.age || 25;
      const ageB = b.age || 25;
      return ageA - ageB || b.value - a.value;
    }).slice(0, 5),
  };
}

function buildDraftStrategy(
  classification: 'contender' | 'competitive' | 'rebuilder',
  metrics: ClassificationMetrics,
  picks: PickSummary[],
  isDynasty: boolean,
  isSuperFlex: boolean,
): DraftStrategy {
  const totalPickValue = picks.reduce((s, p) => s + p.value, 0);
  const weakPositions = Object.entries(metrics.positionBreakdown)
    .filter(([pos]) => ['QB', 'RB', 'WR', 'TE'].includes(pos))
    .sort((a, b) => a[1].value - b[1].value)
    .map(([pos]) => pos);

  const strongPositions = Object.entries(metrics.positionBreakdown)
    .filter(([pos]) => ['QB', 'RB', 'WR', 'TE'].includes(pos))
    .sort((a, b) => b[1].value - a[1].value)
    .map(([pos]) => pos);

  let approach: string;
  let description: string;
  const roundPlan: DraftStrategy['roundPlan'] = [];

  if (classification === 'contender') {
    approach = 'Best Player Available (BPA)';
    description = isDynasty
      ? 'As a contender, draft the best talent available. Don\'t reach for need — your roster is strong enough to absorb BPA picks. Target players who can contribute immediately or develop into future starters.'
      : 'Draft the highest-upside player on your board. Fill starting lineup gaps early, then stack depth in later rounds.';

    if (isDynasty) {
      const earlyPicks = picks.filter(p => p.round <= 2);
      if (earlyPicks.length > 0) {
        roundPlan.push({
          round: 'Rounds 1-2',
          focus: `BPA — lean ${weakPositions[0] || 'WR'} if close`,
          rationale: 'Elite talent rarely falls, take the best player and worry about fit later',
        });
      }
      roundPlan.push({
        round: 'Rounds 3-4',
        focus: `Target ${weakPositions.slice(0, 2).join('/') || 'RB/WR'} depth`,
        rationale: 'Fill your weakest position groups with high-upside picks',
      });
      roundPlan.push({
        round: 'Late Rounds',
        focus: 'Swing for upside — backup QBs, athletic TEs, gadget players',
        rationale: 'Low cost, high ceiling — these picks are lottery tickets',
      });
    } else {
      roundPlan.push({
        round: 'Early Rounds',
        focus: `${weakPositions[0] || 'RB'} if top talent available, otherwise BPA`,
        rationale: 'Address your biggest gap while the talent pool is deep',
      });
      roundPlan.push({
        round: 'Middle Rounds',
        focus: `Stack ${strongPositions[0] || 'WR'} depth and get your QB if needed`,
        rationale: 'Build roster depth for bye weeks and injury insurance',
      });
      roundPlan.push({
        round: 'Late Rounds',
        focus: 'Handcuffs, breakout candidates, and high-upside flyers',
        rationale: 'Target players with a clear path to increased usage',
      });
    }
  } else if (classification === 'rebuilder') {
    approach = 'Youth & Upside';
    description = isDynasty
      ? 'Accumulate as many picks as possible, especially in rounds 1-2. Draft young, high-ceiling players even if they won\'t produce immediately. Trade back when possible to gain extra picks.'
      : 'Draft with an eye on the future. Target high-ceiling players at positions of need. Don\'t chase safe floor — you need upside to close the gap.';

    if (isDynasty) {
      roundPlan.push({
        round: 'Round 1',
        focus: `BPA — prioritize ${isSuperFlex ? 'QB, then ' : ''}${weakPositions[0] || 'WR'}`,
        rationale: 'First-round picks are your most valuable rebuild tool — take elite prospects',
      });
      roundPlan.push({
        round: 'Rounds 2-3',
        focus: `Target ${weakPositions.slice(0, 2).join(' and ') || 'RB and WR'} prospects`,
        rationale: 'Address position scarcity while talent is still available',
      });
      roundPlan.push({
        round: 'Rounds 4+',
        focus: 'High-upside athletes, devy-eligible players, developmental picks',
        rationale: 'Swing for fences — one hit can accelerate your rebuild by a year',
      });
      if (picks.length < 4) {
        roundPlan.push({
          round: 'Pre-Draft',
          focus: 'ACQUIRE MORE PICKS — trade veterans for 2025-2026 draft capital',
          rationale: `You only have ${picks.length} pick(s) — rebuilders need 5+ picks per draft`,
        });
      }
    } else {
      roundPlan.push({
        round: 'Early Rounds',
        focus: `${weakPositions[0] || 'RB'} — anchor your rebuild with a foundational pick`,
        rationale: 'Get one cornerstone player you can build around',
      });
      roundPlan.push({
        round: 'Middle Rounds',
        focus: 'High-ceiling players at positions of need',
        rationale: 'Target players with breakout potential over safe, boring picks',
      });
      roundPlan.push({
        round: 'Late Rounds',
        focus: 'Upside-only picks — rookies, second-year breakout candidates',
        rationale: 'Nothing to lose — maximize your lottery ticket chances',
      });
    }
  } else {
    approach = 'Balanced — Need + BPA';
    description = isDynasty
      ? 'You\'re on the fence between contending and rebuilding. Draft BPA in the early rounds, but lean toward positions of need when talent is close. Avoid trading away picks unless the return is clearly in your favor.'
      : 'Balance filling starting lineup gaps with taking the best available talent. Don\'t overthink it — take the best player who fills a need.';

    roundPlan.push({
      round: isDynasty ? 'Rounds 1-2' : 'Early Rounds',
      focus: `BPA — break ties toward ${weakPositions[0] || 'RB'}`,
      rationale: 'Get the best talent available while addressing your biggest gap',
    });
    roundPlan.push({
      round: isDynasty ? 'Rounds 3-4' : 'Middle Rounds',
      focus: `Target ${weakPositions.slice(0, 2).join('/') || 'depth'} directly`,
      rationale: 'Now is the time to fill specific roster holes',
    });
    roundPlan.push({
      round: isDynasty ? 'Late Rounds' : 'Late Rounds',
      focus: 'Upside swings and depth',
      rationale: 'Take shots on high-ceiling players — hedge your direction',
    });
  }

  return {
    approach,
    description,
    targetPositions: weakPositions.slice(0, 3),
    roundPlan,
    picksOwned: picks.length,
    totalPickValue,
  };
}

function buildDeterministicPlan(
  classification: 'contender' | 'competitive' | 'rebuilder',
  metrics: ClassificationMetrics,
  currentWeek: number,
  isDynasty: boolean,
  roster: RosterSummary,
  standings: StandingsSummary,
  picks: PickSummary[],
): { phases: StrategyPhase[]; tradeWindows: TradeWindow[]; riskPoints: RiskPoint[] } {
  const phases: StrategyPhase[] = [];
  const tradeWindows: TradeWindow[] = [];
  const riskPoints: RiskPoint[] = [];

  const remainingWeeks = Math.max(0, 14 - currentWeek);
  const tradeDeadlineWeek = 12;
  const weeksToDeadline = Math.max(0, tradeDeadlineWeek - currentWeek);

  const weakPositions = Object.entries(metrics.positionBreakdown)
    .filter(([pos]) => ['QB', 'RB', 'WR', 'TE'].includes(pos))
    .sort((a, b) => a[1].value - b[1].value)
    .slice(0, 2)
    .map(([pos]) => pos);

  const strongPositions = Object.entries(metrics.positionBreakdown)
    .filter(([pos]) => ['QB', 'RB', 'WR', 'TE'].includes(pos))
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 2)
    .map(([pos]) => pos);

  if (isOffseason(currentWeek)) {
    phases.push({
      name: 'Offseason Roster Evaluation',
      weekRange: 'Offseason',
      priority: 'Assess your roster after the season and identify gaps',
      actions: [
        `Review season performance — your team finished ${metrics.record} (Rank #${standings.rank} of ${standings.totalTeams})`,
        `Evaluate position strengths (${strongPositions.join(', ') || 'N/A'}) and weaknesses (${weakPositions.join(', ') || 'N/A'})`,
        classification === 'rebuilder'
          ? 'Identify aging assets to move before their value declines further'
          : 'Identify which core players to build around going forward',
        `Assess roster age (avg ${metrics.avgAge}) and plan for long-term sustainability`,
      ],
      targets: weakPositions,
    });

    if (isDynasty) {
      phases.push({
        name: 'Rookie Draft Preparation',
        weekRange: 'Pre-Draft',
        priority: 'Scout incoming rookies and plan your draft board',
        actions: [
          picks.length > 0
            ? `You have ${picks.length} pick(s): ${picks.map(p => `${p.season} Rd${p.round}`).join(', ')} — build your big board`
            : 'You have no picks — consider acquiring draft capital via trades',
          `Target ${weakPositions[0] || 'BPA'} prospects to fill your biggest need`,
          'Research rookie ADP and identify potential draft-day steals',
          'Decide on a draft strategy: BPA vs. positional need',
        ],
        targets: weakPositions,
      });
    }

    phases.push({
      name: 'Offseason Trade Targets',
      weekRange: 'Offseason',
      priority: classification === 'contender'
        ? 'Make surgical upgrades to maintain your championship window'
        : classification === 'rebuilder'
          ? 'Acquire young talent and draft capital to accelerate your rebuild'
          : 'Explore trades that improve your roster without mortgaging the future',
      actions: [
        classification === 'contender'
          ? `Target ${weakPositions[0] || 'depth'} upgrades — trade from your ${strongPositions[0] || 'strength'} surplus`
          : classification === 'rebuilder'
            ? `Sell veterans from ${strongPositions[0] || 'your best positions'} for picks and young players`
            : `Explore buy-low opportunities at ${weakPositions[0] || 'positions of need'}`,
        'Identify managers who might be pivoting direction (contender→rebuild or vice versa)',
        'Offseason trades often yield better value — sellers aren\'t under deadline pressure',
        isDynasty ? 'Package picks with players for blockbuster upgrades' : 'Target positions you can\'t easily draft',
      ],
      targets: weakPositions,
    });

    phases.push({
      name: 'Season Preview & Prep',
      weekRange: 'Pre-Season',
      priority: 'Finalize your roster and set your strategy before Week 1',
      actions: [
        'Set your initial lineup based on updated projections',
        'Identify early-season waiver wire targets and breakout candidates',
        classification === 'contender'
          ? 'Plan your buy window strategy for the first few weeks'
          : classification === 'rebuilder'
            ? 'Identify which players to sell early if they start hot'
            : 'Set a deadline (Week 8-9) to commit to contending or rebuilding',
        'Review league scoring settings and optimize your roster construction',
      ],
      targets: [],
    });

    if (classification === 'contender') {
      tradeWindows.push({
        type: 'buy',
        window: 'Offseason',
        reason: 'Upgrade at your weakest positions while trade values are more stable',
        urgency: 'medium',
        targets: weakPositions,
      });
    } else if (classification === 'rebuilder') {
      tradeWindows.push({
        type: 'sell',
        window: 'Offseason',
        reason: 'Move veterans before another year of age depreciation reduces their value',
        urgency: 'high',
        targets: strongPositions,
      });
    } else {
      tradeWindows.push({
        type: 'hold',
        window: 'Offseason',
        reason: 'Evaluate your direction before committing to buying or selling',
        urgency: 'low',
      });
    }

    if (metrics.avgAge > 28) {
      riskPoints.push({
        category: 'Aging Core',
        description: `Average roster age is ${metrics.avgAge} — each offseason increases decline risk`,
        severity: classification === 'contender' ? 'warning' : 'critical',
        mitigation: 'Consider selling older players who aren\'t essential to compete next year',
      });
    }

    if (isDynasty && picks.length < 3) {
      riskPoints.push({
        category: 'Draft Capital Shortage',
        description: `Only ${picks.length} future pick(s) — limited ability to restock through the draft`,
        severity: 'warning',
        mitigation: 'Prioritize acquiring picks in any offseason trades',
      });
    }

    if (weakPositions.length > 0 && metrics.positionBreakdown[weakPositions[0]]?.value < metrics.rosterValue * 0.08) {
      riskPoints.push({
        category: 'Critical Position Gap',
        description: `${weakPositions[0]} group is well below league average — must address before season`,
        severity: 'critical',
        mitigation: `Target ${weakPositions[0]} heavily in trades and ${isDynasty ? 'the rookie draft' : 'your draft'}`,
      });
    }

    return { phases, tradeWindows, riskPoints };
  }

  if (classification === 'contender') {
    if (currentWeek <= 6) {
      phases.push({
        name: 'Assessment & Early Moves',
        weekRange: `Week ${currentWeek}-6`,
        priority: 'Identify weaknesses and monitor buy-low targets',
        actions: [
          'Monitor waiver wire for breakout players',
          `Target ${weakPositions[0] || 'depth'} upgrades via trade`,
          'Hold core assets — don\'t panic sell after slow starts',
        ],
        targets: weakPositions,
      });
    }

    if (currentWeek <= 10) {
      phases.push({
        name: 'Aggressive Acquisition',
        weekRange: `Week ${Math.max(currentWeek, 7)}-10`,
        priority: 'Make win-now trades to bolster starting lineup',
        actions: [
          'Trade future picks for proven starters if needed',
          'Acquire a reliable handcuff for key RBs',
          'Stack playoff-friendly matchups where possible',
        ],
        targets: weakPositions,
      });
    }

    if (currentWeek <= 14) {
      phases.push({
        name: 'Playoff Push',
        weekRange: `Week ${Math.max(currentWeek, 11)}-14`,
        priority: 'Lock in roster for playoff run',
        actions: [
          'Finalize lineup — no more speculative adds',
          'Secure backup options at every position',
          'Study playoff matchups and plan optimal lineups',
        ],
        targets: [],
      });
    }

    if (weeksToDeadline > 0 && weeksToDeadline <= 4) {
      tradeWindows.push({
        type: 'buy',
        window: `Weeks ${currentWeek}-${tradeDeadlineWeek}`,
        reason: 'Trade deadline approaching — acquire final pieces for playoff push',
        urgency: 'high',
        targets: weakPositions,
      });
    }

    if (metrics.avgAge > 28) {
      riskPoints.push({
        category: 'Age Curve',
        description: `Average roster age is ${metrics.avgAge} — aging core may decline mid-season`,
        severity: 'warning',
        mitigation: 'Monitor veteran performance weekly; have contingency targets identified',
      });
    }

    if (weakPositions.length > 0 && metrics.positionBreakdown[weakPositions[0]]?.value < metrics.rosterValue * 0.1) {
      riskPoints.push({
        category: 'Position Weakness',
        description: `${weakPositions[0]} group is significantly below league average`,
        severity: 'critical',
        mitigation: `Prioritize a ${weakPositions[0]} upgrade before the trade deadline`,
      });
    }

  } else if (classification === 'rebuilder') {
    if (currentWeek <= 8) {
      phases.push({
        name: 'Asset Evaluation',
        weekRange: `Week ${currentWeek}-8`,
        priority: 'Identify sell-high candidates and young core',
        actions: [
          'Identify veterans with trade value to contenders',
          'Target young players and draft picks in trades',
          'Do NOT sell young assets at a discount',
        ],
        targets: [],
      });
    }

    if (currentWeek <= 12) {
      phases.push({
        name: 'Strategic Selling',
        weekRange: `Week ${Math.max(currentWeek, 8)}-12`,
        priority: 'Sell aging assets for future capital',
        actions: [
          'Trade aging starters to playoff-bound teams',
          'Accumulate 2025/2026 draft picks',
          'Target young breakout players from losing teams',
        ],
        targets: strongPositions,
      });
    }

    phases.push({
      name: 'Foundation Building',
      weekRange: `Week ${Math.max(currentWeek, 13)}-18`,
      priority: 'Build foundation for next season',
      actions: [
        'Evaluate which young players to build around',
        isDynasty ? 'Begin rookie draft preparation' : 'Plan draft strategy for next season',
        'Identify free agent targets for the offseason',
      ],
      targets: [],
    });

    tradeWindows.push({
      type: 'sell',
      window: `Weeks ${Math.max(currentWeek, 8)}-${tradeDeadlineWeek}`,
      reason: 'Contenders are desperate — maximize return on veterans',
      urgency: weeksToDeadline <= 3 ? 'high' : 'medium',
    });

    if (picks.length < 4) {
      riskPoints.push({
        category: 'Draft Capital',
        description: 'Limited draft capital makes rebuilding slower',
        severity: 'warning',
        mitigation: 'Include pick acquisition in every trade negotiation',
      });
    }

  } else {
    if (currentWeek <= 8) {
      phases.push({
        name: 'Evaluate Direction',
        weekRange: `Week ${currentWeek}-8`,
        priority: 'Determine if you can compete this season',
        actions: [
          'Track wins closely — need strong start to justify buying',
          `Shore up ${weakPositions[0] || 'roster'} depth via waivers`,
          'Hold trade assets until direction becomes clearer',
        ],
        targets: weakPositions,
      });
    }

    if (currentWeek <= 12) {
      phases.push({
        name: 'Commit to Direction',
        weekRange: `Week ${Math.max(currentWeek, 9)}-12`,
        priority: standings.rank <= standings.playoffSpots
          ? 'You\'re in playoff position — consider buying'
          : 'Falling short — consider selling veterans',
        actions: standings.rank <= standings.playoffSpots
          ? ['Make targeted upgrade trades', 'Don\'t overpay — you have next year too']
          : ['Sell overperforming veterans at peak value', 'Target picks and young players'],
        targets: weakPositions,
      });
    }

    phases.push({
      name: 'Season Wrap',
      weekRange: `Week ${Math.max(currentWeek, 13)}-18`,
      priority: 'Execute chosen path and plan offseason',
      actions: [
        'Finalize roster construction for current or next season',
        'Review which roster moves worked and which didn\'t',
        isDynasty ? 'Begin scouting for rookie draft' : 'Plan next year\'s draft strategy',
      ],
      targets: [],
    });

    tradeWindows.push({
      type: 'hold',
      window: `Weeks ${currentWeek}-8`,
      reason: 'Gather more data before committing to buy or sell',
      urgency: 'low',
    });

    riskPoints.push({
      category: 'Indecision Risk',
      description: 'Waiting too long to commit to buying or selling reduces returns on both paths',
      severity: 'warning',
      mitigation: 'Set a hard deadline (Week 8-9) to commit to contending or rebuilding',
    });
  }

  if (standings.rank > standings.playoffSpots && classification === 'contender') {
    riskPoints.push({
      category: 'Record Gap',
      description: `Ranked #${standings.rank} despite strong roster — underperforming relative to talent`,
      severity: 'warning',
      mitigation: 'Check lineup optimization and consider start/sit improvements',
    });
  }

  return { phases, tradeWindows, riskPoints };
}

async function generateAIRoadmap(
  classification: string,
  confidence: number,
  metrics: ClassificationMetrics,
  roster: RosterSummary,
  standings: StandingsSummary,
  picks: PickSummary[],
  phases: StrategyPhase[],
  tradeWindows: TradeWindow[],
  riskPoints: RiskPoint[],
  leagueType: string,
  scoringType: string,
  isSuperFlex: boolean,
  isDynasty: boolean,
  currentWeek: number,
  leagueName: string,
): Promise<string> {
  const topPlayers = roster.players.slice(0, 15).map(p => `${p.name} (${p.position}, ${p.value}pts)`).join(', ');
  const posBreak = Object.entries(metrics.positionBreakdown)
    .filter(([pos]) => ['QB', 'RB', 'WR', 'TE'].includes(pos))
    .map(([pos, d]) => `${pos}: ${d.count} players, ${d.value} value`)
    .join(' | ');

  const picksSummary = picks.length > 0
    ? picks.map(p => `${p.season} Rd${p.round} (${p.value}pts)`).join(', ')
    : 'No future picks';

  const offseasonMode = isOffseason(currentWeek);

  const systemPrompt = offseasonMode
    ? `You are an expert fantasy football strategy advisor providing an offseason evaluation and plan. The NFL season has ended.

Be specific, actionable, and reference actual players on the roster. Consider the league format (${leagueType}, ${scoringType}${isSuperFlex ? ', SuperFlex' : ''}).

Format your response as a cohesive offseason strategy narrative (not bullet points). Include:
1. Season recap — how did this team perform and why?
2. Roster evaluation — who are the core keepers, who should be moved?
3. Position-by-position needs assessment
4. ${isDynasty ? 'Rookie draft strategy — which positions to target, what rounds to focus on' : 'Draft preparation — what positions to prioritize'}
5. Offseason trade targets — specific types of players to acquire and sell
6. Pre-season preparation checklist
7. One bold or non-obvious recommendation for the offseason

Keep it under 700 words. Be direct and honest — if the team needs a rebuild, say so constructively. Frame everything around what the manager should do NOW before the next season begins.`
    : `You are an expert fantasy football strategy advisor. Analyze this team and provide a personalized season strategy roadmap.

Be specific, actionable, and reference actual players on the roster. Consider the league format (${leagueType}, ${scoringType}${isSuperFlex ? ', SuperFlex' : ''}).

Format your response as a cohesive strategy narrative (not bullet points). Include:
1. A brief team assessment paragraph
2. Immediate priorities (next 2-3 weeks)
3. Medium-term strategy (next month)
4. End-of-season outlook
5. Key trade targets or sell candidates (be specific about positions and player types)
6. One creative or non-obvious recommendation

Keep it under 600 words. Be direct and honest — if the team is bad, say so constructively.`;

  const userPrompt = `## Team Strategy Request — ${offseasonMode ? 'Offseason' : `Week ${currentWeek}`}
League: ${leagueName} (${leagueType}, ${scoringType}${isSuperFlex ? ', SF' : ''})

### Classification: ${classification.toUpperCase()} (${Math.round(confidence * 100)}% confidence)
Contender Score: ${metrics.contenderScore}/1.00

### Standings
Record: ${metrics.record} (Rank #${standings.rank} of ${standings.totalTeams})
Points For: ${Math.round(standings.pointsFor)}
Playoff Spots: ${standings.playoffSpots}

### Roster (Top 15 by Value)
${topPlayers}

### Position Breakdown
${posBreak}

### Draft Capital
${picksSummary}

### Metrics
Roster Value Rank: #${metrics.rosterValueRank} (${Math.round(metrics.rosterValuePercentile * 100)}th percentile)
Starter Value Rank: #${metrics.starterValueRank}
Avg Age: ${metrics.avgAge}

### Deterministic Strategy Framework
Phases: ${phases.map(p => `${p.name} (${p.weekRange})`).join(' → ')}
Trade Windows: ${tradeWindows.map(tw => `${tw.type.toUpperCase()}: ${tw.window} — ${tw.reason}`).join('; ')}
Risk Points: ${riskPoints.map(rp => `[${rp.severity}] ${rp.description}`).join('; ')}

Please provide your detailed strategy roadmap for this team.`;

  try {
    const result = await openaiChatText({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      maxTokens: 1200,
    });

    if (result.ok) {
      return result.text;
    }
    console.error('AI roadmap generation failed:', result.ok === false ? result.details : 'unknown');
    return 'AI roadmap generation failed. The deterministic strategy plan above is still valid.';
  } catch (e) {
    console.error('AI roadmap generation error:', e);
    return 'AI roadmap generation failed. The deterministic strategy plan above is still valid.';
  }
}

export async function getOrComputeStrategy(
  leagueId: string,
  rosterId: number,
  sleeperUsername?: string,
  forceRefresh: boolean = false,
): Promise<StrategyResult & { fromCache: boolean; snapshotId: string }> {
  const season = String(new Date().getFullYear());

  if (!forceRefresh) {
    const cached = await prisma.strategySnapshot.findUnique({
      where: { leagueId_rosterId_season: { leagueId, rosterId, season } },
    });

    if (cached && new Date(cached.expiresAt) > new Date()) {
      const cachedClassification = cached.classification as 'contender' | 'competitive' | 'rebuilder';
      const cachedMetrics = cached.metrics as unknown as ClassificationMetrics;
      const cachedRoster = cached.roster as unknown as RosterSummary;
      const cachedPicks = cached.draftCapital as unknown as PickSummary[];
      const cachedPhases = cached.phases as unknown as StrategyPhase[];
      const extraFlags = (cached.metrics as Record<string, unknown>) || {};
      const isDynasty = extraFlags._isDynasty === true;
      const isSuperFlex = extraFlags._isSuperFlex === true;
      const rosterMoves = buildRosterMoves(cachedClassification, cachedRoster, cachedMetrics, isDynasty);
      const draftStrategy = buildDraftStrategy(cachedClassification, cachedMetrics, cachedPicks, isDynasty, isSuperFlex);
      return {
        classification: cachedClassification,
        confidence: cached.confidence,
        metrics: cachedMetrics,
        roster: cachedRoster,
        standings: cached.standings as unknown as StandingsSummary,
        draftCapital: cachedPicks,
        phases: cachedPhases,
        tradeWindows: cached.tradeWindows as unknown as TradeWindow[],
        riskPoints: cached.riskPoints as unknown as RiskPoint[],
        rosterMoves,
        draftStrategy,
        aiRoadmap: cached.aiRoadmap || '',
        weekNumber: cached.weekNumber,
        isOffseason: isOffseason(cached.weekNumber),
        isDynasty,
        isSuperFlex,
        fromCache: true,
        snapshotId: cached.id,
      };
    }
  }

  const result = await computeSeasonStrategy(leagueId, rosterId, sleeperUsername);

  const snapshot = await prisma.strategySnapshot.upsert({
    where: { leagueId_rosterId_season: { leagueId, rosterId, season } },
    update: {
      sleeperUsername: sleeperUsername || null,
      classification: result.classification,
      confidence: result.confidence,
      metrics: { ...result.metrics, _isDynasty: result.isDynasty, _isSuperFlex: result.isSuperFlex } as any,
      roster: result.roster as any,
      standings: result.standings as any,
      draftCapital: result.draftCapital as any,
      phases: result.phases as any,
      tradeWindows: result.tradeWindows as any,
      riskPoints: result.riskPoints as any,
      aiRoadmap: result.aiRoadmap,
      weekNumber: result.weekNumber,
      lastComputedAt: new Date(),
      expiresAt: new Date(Date.now() + STRATEGY_TTL_MS),
    },
    create: {
      leagueId,
      rosterId,
      season,
      sleeperUsername: sleeperUsername || null,
      classification: result.classification,
      confidence: result.confidence,
      metrics: { ...result.metrics, _isDynasty: result.isDynasty, _isSuperFlex: result.isSuperFlex } as any,
      roster: result.roster as any,
      standings: result.standings as any,
      draftCapital: result.draftCapital as any,
      phases: result.phases as any,
      tradeWindows: result.tradeWindows as any,
      riskPoints: result.riskPoints as any,
      aiRoadmap: result.aiRoadmap,
      weekNumber: result.weekNumber,
      lastComputedAt: new Date(),
      expiresAt: new Date(Date.now() + STRATEGY_TTL_MS),
    },
  });

  return { ...result, fromCache: false, snapshotId: snapshot.id };
}

export async function getStrategyHistory(
  leagueId: string,
  rosterId: number,
): Promise<Array<{
  id: string;
  season: string;
  classification: string;
  weekNumber: number;
  contenderScore: number;
  computedAt: string;
}>> {
  const snapshots = await prisma.strategySnapshot.findMany({
    where: { leagueId, rosterId },
    orderBy: { lastComputedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      season: true,
      classification: true,
      weekNumber: true,
      metrics: true,
      lastComputedAt: true,
    },
  });

  return snapshots.map((s: { id: string; season: string; classification: string; weekNumber: number; metrics: unknown; lastComputedAt: Date }) => ({
    id: s.id,
    season: s.season,
    classification: s.classification,
    weekNumber: s.weekNumber,
    contenderScore: (s.metrics as Record<string, number>)?.contenderScore || 0,
    computedAt: s.lastComputedAt.toISOString(),
  }));
}
