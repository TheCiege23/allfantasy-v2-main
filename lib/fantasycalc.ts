import { getConsensusADP as getMultiPlatformConsensus } from './multi-platform-adp'

const FANTASYCALC_API_BASE = 'https://api.fantasycalc.com/values/current';
const FANTASYCALC_PLAYERS_BASE = 'https://api.fantasycalc.com/players';

export interface FantasyCalcPlayerIdentity {
  id: number;
  name: string;
  mflId: string;
  sleeperId: string;
  position: string;
  maybeBirthday: string | null;
  maybeHeight: string | null;
  maybeWeight: number | null;
  maybeCollege: string | null;
  maybeTeam: string | null;
  maybeAge: number | null;
  maybeYoe: number | null;
  espnId: string | null;
  fleaflickerId: string | null;
}

export interface FantasyCalcPlayer {
  player: FantasyCalcPlayerIdentity;
  value: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number;
  redraftDynastyValueDifference: number;
  redraftDynastyValuePercDifference: number;
  redraftValue: number;
  combinedValue: number;
  maybeMovingStandardDeviation: number | null;
  maybeMovingStandardDeviationPerc: number | null;
  maybeMovingStandardDeviationAdjusted: number | null;
  displayTrend: boolean;
  maybeOwner: string | null;
  starter: boolean;
  maybeTier: number | null;
  maybeAdp: number | null;
  maybeTradeFrequency: number | null;
}

export interface FantasyCalcSettings {
  isDynasty: boolean;
  numQbs: 1 | 2;
  numTeams: number;
  ppr: 0 | 0.5 | 1;
}

export interface FantasyCalcCache {
  data: FantasyCalcPlayer[];
  fetchedAt: number;
  settings: FantasyCalcSettings;
}

const cache: Map<string, FantasyCalcCache> = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

function getCacheKey(settings: FantasyCalcSettings): string {
  return `${settings.isDynasty}-${settings.numQbs}-${settings.numTeams}-${settings.ppr}`;
}

export async function fetchFantasyCalcValues(
  settings: FantasyCalcSettings = { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 }
): Promise<FantasyCalcPlayer[]> {
  const cacheKey = getCacheKey(settings);
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }
  
  const url = `${FANTASYCALC_API_BASE}?isDynasty=${settings.isDynasty}&numQbs=${settings.numQbs}&numTeams=${settings.numTeams}&ppr=${settings.ppr}`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`FantasyCalc API error: ${response.status}`);
  }
  
  const data: FantasyCalcPlayer[] = await response.json();
  
  cache.set(cacheKey, {
    data,
    fetchedAt: Date.now(),
    settings,
  });
  
  return data;
}

let playersDirectoryCache: { data: FantasyCalcPlayerIdentity[]; fetchedAt: number } | null = null;
const PLAYERS_CACHE_TTL = 1000 * 60 * 60 * 12; // 12 hours

export async function fetchFantasyCalcPlayerDirectory(): Promise<FantasyCalcPlayerIdentity[]> {
  if (playersDirectoryCache && Date.now() - playersDirectoryCache.fetchedAt < PLAYERS_CACHE_TTL) {
    return playersDirectoryCache.data;
  }

  const response = await fetch(FANTASYCALC_PLAYERS_BASE, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`FantasyCalc Players API error: ${response.status}`);
  }

  const data: FantasyCalcPlayerIdentity[] = await response.json();

  playersDirectoryCache = { data, fetchedAt: Date.now() };

  return data;
}

export function getValuationCacheAgeMs(settings: FantasyCalcSettings): number | null {
  const cacheKey = getCacheKey(settings);
  const cached = cache.get(cacheKey);
  if (!cached) return null;
  return Date.now() - cached.fetchedAt;
}

/**
 * Slice 15 (wrong-row joins): this used to take the FIRST substring hit as
 * definitive — no position, team or uniqueness check — while feeding trade
 * valuation, waiver scoring and player outlook. A substring match is how
 * "Josh Allen" binds to the wrong athlete, and how a short surname can match
 * an unrelated player entirely.
 *
 * Now: exact matches are disambiguated by position/team when the caller knows
 * them, and a SUBSTRING match is only accepted when it is UNIQUE. An ambiguous
 * partial returns null — a missing market value is a gap; the wrong player's
 * market value is a false number in a trade grade.
 *
 * Backward compatible: callers that pass no hints get identical behavior for
 * unique names, which is the overwhelming majority.
 */
export function findPlayerByName(
  players: FantasyCalcPlayer[],
  name: string,
  hints?: { position?: string | null; team?: string | null }
): FantasyCalcPlayer | null {
  const normalizeFcName = (n: string) => n.toLowerCase().trim()
    .replace(/\bjr\.?\b/i, '').replace(/\bsr\.?\b/i, '').replace(/\bii+\b/i, '')
    .replace(/\biii\b/i, '').replace(/\biv\b/i, '').replace(/\s+/g, ' ').trim();

  const normalized = normalizeFcName(name);
  if (!normalized) return null;

  const token = (v: string | null | undefined) => {
    const t = String(v ?? '').trim().toUpperCase();
    return t ? t : null;
  };
  const wantPos = token(hints?.position);
  const wantTeam = token(hints?.team);

  /** Narrow a candidate set by position, then team; null when still ambiguous. */
  const disambiguate = (candidates: FantasyCalcPlayer[]): FantasyCalcPlayer | null => {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0]!;
    let narrowed = candidates;
    if (wantPos) {
      const byPos = narrowed.filter(p => token(p.player.position) === wantPos);
      if (byPos.length > 0) narrowed = byPos;
    }
    if (narrowed.length > 1 && wantTeam) {
      const byTeam = narrowed.filter(p => token(p.player.maybeTeam) === wantTeam);
      if (byTeam.length > 0) narrowed = byTeam;
    }
    // Still more than one, or narrowed only by luck → refuse.
    return narrowed.length === 1 ? narrowed[0]! : null;
  };

  const exactMatches = players.filter(p => normalizeFcName(p.player.name) === normalized);
  if (exactMatches.length > 0) return disambiguate(exactMatches);

  const partialMatches = players.filter(p => {
    const fcNorm = normalizeFcName(p.player.name);
    return fcNorm.includes(normalized) || normalized.includes(fcNorm);
  });
  // A substring match is only trustworthy when nothing else could have matched.
  if (partialMatches.length === 1) return partialMatches[0]!;
  return disambiguate(partialMatches);
}

export function findPlayerBySleeperId(
  players: FantasyCalcPlayer[],
  sleeperId: string
): FantasyCalcPlayer | null {
  return players.find(p => p.player.sleeperId === sleeperId) || null;
}

export function getPlayerValue(
  players: FantasyCalcPlayer[],
  nameOrSleeperId: string,
  useSleeperId: boolean = false
): { value: number; rank: number; trend: number; player: FantasyCalcPlayer } | null {
  const player = useSleeperId 
    ? findPlayerBySleeperId(players, nameOrSleeperId)
    : findPlayerByName(players, nameOrSleeperId);
  
  if (!player) return null;
  
  return {
    value: player.value,
    rank: player.overallRank,
    trend: player.trend30Day,
    player,
  };
}

export function compareTradeValues(
  players: FantasyCalcPlayer[],
  sideA: string[],
  sideB: string[]
): {
  sideATotal: number;
  sideBTotal: number;
  difference: number;
  percentDiff: number;
  winner: 'A' | 'B' | 'EVEN';
  sideABreakdown: { name: string; value: number; rank: number }[];
  sideBBreakdown: { name: string; value: number; rank: number }[];
} {
  const getTotal = (names: string[]) => {
    return names.map(name => {
      const result = getPlayerValue(players, name);
      return {
        name,
        value: result?.value || 0,
        rank: result?.rank || 999,
      };
    });
  };
  
  const sideABreakdown = getTotal(sideA);
  const sideBBreakdown = getTotal(sideB);
  
  const sideATotal = sideABreakdown.reduce((sum, p) => sum + p.value, 0);
  const sideBTotal = sideBBreakdown.reduce((sum, p) => sum + p.value, 0);
  
  const difference = sideATotal - sideBTotal;
  const maxTotal = Math.max(sideATotal, sideBTotal);
  const percentDiff = maxTotal > 0 ? Math.round(Math.abs(difference) / maxTotal * 100) : 0;
  
  let winner: 'A' | 'B' | 'EVEN' = 'EVEN';
  if (percentDiff >= 5) {
    winner = difference > 0 ? 'A' : 'B';
  }
  
  return {
    sideATotal,
    sideBTotal,
    difference,
    percentDiff,
    winner,
    sideABreakdown,
    sideBBreakdown,
  };
}

export function getTopPlayers(
  players: FantasyCalcPlayer[],
  position?: string,
  limit: number = 20
): FantasyCalcPlayer[] {
  let filtered = players;
  
  if (position) {
    filtered = players.filter(p => p.player.position.toUpperCase() === position.toUpperCase());
  }
  
  return filtered.slice(0, limit);
}

export function getTrendingPlayers(
  players: FantasyCalcPlayer[],
  direction: 'up' | 'down' = 'up',
  limit: number = 10
): FantasyCalcPlayer[] {
  const sorted = [...players].sort((a, b) => {
    if (direction === 'up') {
      return b.trend30Day - a.trend30Day;
    }
    return a.trend30Day - b.trend30Day;
  });
  
  return sorted.slice(0, limit);
}

export function formatValueForDisplay(value: number): string {
  if (value >= 10000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toString();
}

export function getValueTier(value: number): 'elite' | 'high' | 'mid' | 'low' | 'depth' {
  if (value >= 7500) return 'elite';
  if (value >= 5000) return 'high';
  if (value >= 2500) return 'mid';
  if (value >= 1000) return 'low';
  return 'depth';
}

export function getDetailedTier(value: number, rank: number, position: string): {
  tier: 0 | 1 | 2 | 3 | 4;
  label: string;
  description: string;
} {
  if (value >= 8500 || rank <= 5) {
    return { tier: 0, label: 'Tier 0 - Untouchable', description: 'Generational talent, franchise cornerstone' };
  }
  if (value >= 6500 || rank <= 20) {
    return { tier: 1, label: 'Tier 1 - Cornerstone', description: 'Elite building block, 1-for-1 trades only' };
  }
  if (value >= 4500 || rank <= 50) {
    return { tier: 2, label: 'Tier 2 - High-End Starter', description: 'Strong weekly starter, tradeable for right price' };
  }
  if (value >= 2000 || rank <= 100) {
    return { tier: 3, label: 'Tier 3 - Starter/Flex', description: 'Reliable depth, can be bundled in trades' };
  }
  return { tier: 4, label: 'Tier 4 - Depth/Lottery', description: 'Roster filler, low trade value' };
}

export function getPickValue(year: number, round: number, isDynasty: boolean, pickNumber?: number, numTeams?: number): number {
  const currentYear = new Date().getFullYear();
  const yearsAway = year - currentYear;
  
  const TIME_MULTIPLIER: Record<number, number> = {
    0: 1.00,
    1: 0.92,
    2: 0.85,
    3: 0.80
  };
  const TIME_FLOOR = 0.75;
  
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  
  const getDaysToDraft = (): number | null => {
    if (year < currentYear) return null;
    if (year > currentYear + 3) return null;
    const draftDate = new Date(year, 4, 1);
    const diffTime = draftDate.getTime() - Date.now();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : null;
  };
  
  const rookieFeverMultiplier = (daysToDraft: number | null): number => {
    if (daysToDraft === null) return 1.00;
    if (daysToDraft <= 30) return 1.06;
    if (daysToDraft <= 90) return 1.03;
    return 1.00;
  };

  const baseValues: Record<number, number> = isDynasty
    ? { 1: 6000, 2: 3900, 3: 2400, 4: 1200, 5: 600 }
    : { 1: 3000, 2: 1200, 3: 500, 4: 200, 5: 100 };
  
  let base = baseValues[Math.min(round, 5)] || (isDynasty ? 600 : 100);

  if (pickNumber && numTeams && numTeams > 1) {
    const slotPosition = clamp((pickNumber - 1) / (numTeams - 1), 0, 1);
    const prevRoundBase = round > 1
      ? (baseValues[round - 1] || base * 1.5)
      : base * 1.6;
    const nextRoundBase = baseValues[Math.min(round + 1, 5)] || base * 0.5;

    if (slotPosition < 0.5) {
      const blend = (0.5 - slotPosition) / 0.5;
      base = base + blend * 0.30 * (prevRoundBase - base);
    } else if (slotPosition > 0.5) {
      const blend = (slotPosition - 0.5) / 0.5;
      base = base - blend * 0.30 * (base - nextRoundBase);
    }
  }
  
  let timeMult = TIME_MULTIPLIER[yearsAway] ?? TIME_FLOOR;
  timeMult = clamp(timeMult, TIME_FLOOR, 1.00);
  
  const daysToDraft = getDaysToDraft();
  const feverMult = rookieFeverMultiplier(daysToDraft);
  
  return Math.round(base * timeMult * feverMult);
}

export interface PickValueMeta {
  format: '1qb' | 'sf';
  asOfDate: string | null;
  bucket: 'early' | 'mid' | 'late' | null;
  isDynasty?: boolean;
}

export interface PickValueResult {
  value: number;
  source: 'historical' | 'model';
  wasAveraged: boolean;
  actualDate?: string;
  bucketBreakdown?: { early: number | null; mid: number | null; late: number | null };
}

export async function getPickValueWithHistorical(
  year: number,
  round: number,
  meta: PickValueMeta
): Promise<PickValueResult> {
  const isDynasty = meta.isDynasty ?? true;
  const isSuperFlex = meta.format === 'sf';
  
  if (meta.asOfDate) {
    const { getHistoricalPickValueWeighted } = await import('./historical-values');
    
    const historical = getHistoricalPickValueWeighted(
      year,
      round,
      meta.bucket,
      meta.asOfDate,
      isSuperFlex
    );
    
    if (historical.value !== null) {
      return {
        value: historical.value,
        source: 'historical',
        wasAveraged: historical.wasAveraged,
        actualDate: historical.actualDate ?? undefined,
        bucketBreakdown: historical.bucketBreakdown
      };
    }
  }
  
  return {
    value: getPickValue(year, round, isDynasty),
    source: 'model',
    wasAveraged: false
  };
}

export function getPickValueSync(
  year: number,
  round: number,
  meta: PickValueMeta,
  historicalLookup?: (year: number, round: number, bucket: 'early' | 'mid' | 'late' | null, date: string, isSF: boolean) => { value: number | null; wasAveraged: boolean; actualDate: string | null; bucketBreakdown?: any }
): PickValueResult {
  const isDynasty = meta.isDynasty ?? true;
  const isSuperFlex = meta.format === 'sf';
  
  if (meta.asOfDate && historicalLookup) {
    const historical = historicalLookup(year, round, meta.bucket, meta.asOfDate, isSuperFlex);
    
    if (historical.value !== null) {
      return {
        value: historical.value,
        source: 'historical',
        wasAveraged: historical.wasAveraged,
        actualDate: historical.actualDate ?? undefined,
        bucketBreakdown: historical.bucketBreakdown
      };
    }
  }
  
  return {
    value: getPickValue(year, round, isDynasty),
    source: 'model',
    wasAveraged: false
  };
}

export interface PlayerValueLookup {
  name: string;
  value: number;
  rank: number;
  positionRank: number;
  trend30Day: number;
  tier: 'elite' | 'high' | 'mid' | 'low' | 'depth';
  detailedTier: { tier: 0 | 1 | 2 | 3 | 4; label: string; description: string };
  position: string;
  team: string | null;
  sleeperId: string | null;
  age: number | null;
  redraftValue: number;
  espnId: string | null;
  fleaflickerId: string | null;
  maybeTier: number | null;
  maybeAdp: number | null;
  maybeTradeFrequency: number | null;
  volatility: number | null;
  combinedValue: number;
}

export async function getPlayerValuesForNames(
  names: string[],
  settings: FantasyCalcSettings = { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 }
): Promise<Map<string, PlayerValueLookup>> {
  const result = new Map<string, PlayerValueLookup>();
  
  try {
    const players = await fetchFantasyCalcValues(settings);
    
    for (const name of names) {
      const player = findPlayerByName(players, name);
      if (player) {
        result.set(name.toLowerCase(), {
          name: player.player.name,
          value: player.value,
          rank: player.overallRank,
          positionRank: player.positionRank,
          trend30Day: player.trend30Day,
          tier: getValueTier(player.value),
          detailedTier: getDetailedTier(player.value, player.overallRank, player.player.position),
          position: player.player.position,
          team: player.player.maybeTeam,
          sleeperId: player.player.sleeperId,
          age: player.player.maybeAge,
          redraftValue: player.redraftValue,
          espnId: player.player.espnId || null,
          fleaflickerId: player.player.fleaflickerId || null,
          maybeTier: player.maybeTier ?? null,
          maybeAdp: player.maybeAdp ?? null,
          maybeTradeFrequency: player.maybeTradeFrequency ?? null,
          volatility: player.maybeMovingStandardDeviationAdjusted ?? null,
          combinedValue: player.combinedValue,
        });
      }
    }
  } catch (error) {
    console.error('Failed to fetch FantasyCalc values:', error);
  }
  
  return result;
}

export function formatValuesForPrompt(
  values: Map<string, PlayerValueLookup>,
  playerNames: string[]
): string {
  const lines: string[] = ['FANTASYCALC MARKET VALUES (based on ~1M real trades):'];
  
  for (const name of playerNames) {
    const lookup = values.get(name.toLowerCase());
    if (lookup) {
      const trendStr = lookup.trend30Day > 0 ? `+${lookup.trend30Day}` : `${lookup.trend30Day}`;
      const ageStr = lookup.age ? `, Age ${lookup.age}` : '';
      const adpStr = lookup.maybeAdp ? ` | ADP: ${lookup.maybeAdp}` : '';
      const freqStr = lookup.maybeTradeFrequency ? ` | Trade Freq: ${(lookup.maybeTradeFrequency * 100).toFixed(1)}%` : '';
      const volStr = lookup.volatility !== null ? ` | Vol: ${lookup.volatility > 0 ? '+' : ''}${lookup.volatility}` : '';

      let multiPlatStr = '';
      try {
        const consensus = getMultiPlatformConsensus(lookup.name, lookup.position, lookup.team || undefined);
        if (consensus && consensus.consensusADP < 9999) {
          multiPlatStr = ` | ConsensusADP: ${consensus.consensusADP.toFixed(1)} (${consensus.platformCount}plat, spread:${consensus.spread.toFixed(0)}) [${consensus.tier}]`;
          if (consensus.dynastyADP) multiPlatStr += ` DynADP:${consensus.dynastyADP.toFixed(1)}`;
          if (consensus.aav) multiPlatStr += ` AAV:$${consensus.aav.toFixed(1)}`;
          if (consensus.injury) multiPlatStr += ` ⚠${consensus.injury}`;
        }
      } catch {}

      lines.push(`- ${lookup.name}: Dynasty ${lookup.value} / Redraft ${lookup.redraftValue} | ${lookup.detailedTier.label} | Rank #${lookup.rank} (${lookup.position}${lookup.positionRank})${ageStr} | 30d trend: ${trendStr}${adpStr}${freqStr}${volStr}${multiPlatStr}`);
    } else {
      let fallbackStr = '';
      try {
        const consensus = getMultiPlatformConsensus(name);
        if (consensus && consensus.consensusADP < 9999) {
          fallbackStr = ` — Multi-Platform ConsensusADP: ${consensus.consensusADP.toFixed(1)} [${consensus.tier}] (${consensus.position} - ${consensus.team})`;
          if (consensus.dynastyADP) fallbackStr += ` DynADP:${consensus.dynastyADP.toFixed(1)}`;
          if (consensus.aav) fallbackStr += ` AAV:$${consensus.aav.toFixed(1)}`;
          if (consensus.injury) fallbackStr += ` ⚠${consensus.injury}`;
        }
      } catch {}
      lines.push(`- ${name}: Not found in FantasyCalc (treat as low-value depth)${fallbackStr}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * Calculate trade balance based on FantasyCalc values
 * @param values - FantasyCalc player value lookup map
 * @param sideAReceivesPlayers - Player names that Team A RECEIVES
 * @param sideBReceivesPlayers - Player names that Team B RECEIVES
 * @param sideAReceivesPicks - Picks that Team A RECEIVES
 * @param sideBReceivesPicks - Picks that Team B RECEIVES
 * @param isDynasty - Whether to use dynasty or redraft valuations
 * @returns Trade balance analysis with values, verdict, and breakdown
 */
export function calculateTradeBalance(
  values: Map<string, PlayerValueLookup>,
  sideAReceivesPlayers: string[],
  sideBReceivesPlayers: string[],
  sideAReceivesPicks: { year: number; round: number; pickNumber?: number }[],
  sideBReceivesPicks: { year: number; round: number; pickNumber?: number }[],
  isDynasty: boolean,
  numTeams: number = 12
): {
  sideAValue: number;
  sideBValue: number;
  difference: number;
  percentDiff: number;
  verdict: 'Fair' | 'Slightly favors A' | 'Slightly favors B' | 'Strongly favors A' | 'Strongly favors B';
  breakdown: {
    sideA: { players: { name: string; value: number; found: boolean }[]; picks: { desc: string; value: number }[]; total: number };
    sideB: { players: { name: string; value: number; found: boolean }[]; picks: { desc: string; value: number }[]; total: number };
  };
  unknownPlayers: string[];
} {
  const UNKNOWN_PLAYER_VALUE = 200; // Low fallback for unknown players to avoid skewing totals
  const unknownPlayers: string[] = [];
  
  const getPlayerValues = (names: string[]) => names.map(name => {
    const lookup = values.get(name.toLowerCase());
    if (!lookup) {
      unknownPlayers.push(name);
    }
    return { 
      name, 
      value: lookup?.value || UNKNOWN_PLAYER_VALUE,
      found: !!lookup,
    };
  });
  
  const getPickValues = (picks: { year: number; round: number; pickNumber?: number }[]) => picks.map(p => ({
    desc: `${p.year} Round ${p.round}${p.pickNumber ? ` Pick ${p.pickNumber}` : ''}`,
    value: getPickValue(p.year, p.round, isDynasty, p.pickNumber, numTeams),
  }));
  
  const sideAPlayerValues = getPlayerValues(sideAReceivesPlayers);
  const sideBPlayerValues = getPlayerValues(sideBReceivesPlayers);
  const sideAPickValues = getPickValues(sideAReceivesPicks);
  const sideBPickValues = getPickValues(sideBReceivesPicks);
  
  const sideACountRaw = sideAReceivesPlayers.length + sideAReceivesPicks.length;
  const sideBCountRaw = sideBReceivesPlayers.length + sideBReceivesPicks.length;
  const sideARaw = sideAPlayerValues.reduce((s, p) => s + p.value, 0) + sideAPickValues.reduce((s, p) => s + p.value, 0);
  const sideBRaw = sideBPlayerValues.reduce((s, p) => s + p.value, 0) + sideBPickValues.reduce((s, p) => s + p.value, 0);

  const bestValueA = Math.max(...sideAPlayerValues.map(p => p.value), ...sideAPickValues.map(p => p.value), 0);
  const bestValueB = Math.max(...sideBPlayerValues.map(p => p.value), ...sideBPickValues.map(p => p.value), 0);

  const getStarBoost = (receivingBestValue: number) => {
    if (receivingBestValue >= 7000) return 0.15;
    if (receivingBestValue >= 5000) return 0.10;
    if (receivingBestValue >= 3000) return 0.05;
    return 0;
  };

  let sideAValue = sideARaw;
  let sideBValue = sideBRaw;

  if (sideACountRaw > sideBCountRaw && sideACountRaw - sideBCountRaw >= 1) {
    const diff = sideACountRaw - sideBCountRaw;
    const boost = getStarBoost(bestValueB);
    const consolMult = diff >= 2 ? (1.50 + boost) : (1.30 + boost);
    sideAValue = Math.round(sideARaw / consolMult);
  } else if (sideBCountRaw > sideACountRaw && sideBCountRaw - sideACountRaw >= 1) {
    const diff = sideBCountRaw - sideACountRaw;
    const boost = getStarBoost(bestValueA);
    const consolMult = diff >= 2 ? (1.50 + boost) : (1.30 + boost);
    sideBValue = Math.round(sideBRaw / consolMult);
  }
  
  const difference = sideAValue - sideBValue;
  const maxValue = Math.max(sideAValue, sideBValue, 1);
  const percentDiff = Math.round(Math.abs(difference) / maxValue * 100);
  
  // Verdict: A = Team A gets better value, B = Team B gets better value
  let verdict: 'Fair' | 'Slightly favors A' | 'Slightly favors B' | 'Strongly favors A' | 'Strongly favors B' = 'Fair';
  if (percentDiff >= 25) {
    verdict = difference > 0 ? 'Strongly favors A' : 'Strongly favors B';
  } else if (percentDiff >= 10) {
    verdict = difference > 0 ? 'Slightly favors A' : 'Slightly favors B';
  }
  
  return {
    sideAValue,
    sideBValue,
    difference,
    percentDiff,
    verdict,
    breakdown: {
      sideA: { players: sideAPlayerValues, picks: sideAPickValues, total: sideAValue },
      sideB: { players: sideBPlayerValues, picks: sideBPickValues, total: sideBValue },
    },
    unknownPlayers,
  };
}

const TIER_UPGRADE_BONUS: Record<number, number> = {
  1: 400,
  2: 700,
  3: 1000
};

const MAX_TIME_PENALTY_ON_UPGRADE = 0.08;

function pickTier(round: number): number {
  if (round === 1) return 1;
  if (round === 2) return 2;
  if (round === 3) return 3;
  if (round === 4) return 4;
  return 5;
}

export interface PickTradeAsset {
  type: 'pick';
  year: number;
  round: number;
}

export interface PlayerTradeAsset {
  type: 'player';
  name: string;
  value: number;
}

export type EnhancedTradeAsset = PickTradeAsset | PlayerTradeAsset;

export function applyTierJumpOverride(
  outgoingAssets: EnhancedTradeAsset[],
  incomingAssets: EnhancedTradeAsset[],
  isDynasty: boolean
): { bonus: number; timePenaltyCapApplied: boolean; tierDelta: number } {
  const outgoingPicks = outgoingAssets.filter((a): a is PickTradeAsset => a.type === 'pick');
  const incomingPicks = incomingAssets.filter((a): a is PickTradeAsset => a.type === 'pick');

  if (outgoingPicks.length === 0 || incomingPicks.length === 0) {
    return { bonus: 0, timePenaltyCapApplied: false, tierDelta: 0 };
  }

  const bestOutgoingTier = Math.min(...outgoingPicks.map(a => pickTier(a.round)));
  const bestIncomingTier = Math.min(...incomingPicks.map(a => pickTier(a.round)));

  const tierDelta = bestOutgoingTier - bestIncomingTier;
  if (tierDelta <= 0) {
    return { bonus: 0, timePenaltyCapApplied: false, tierDelta: 0 };
  }

  const baseBonus = TIER_UPGRADE_BONUS[tierDelta] ?? TIER_UPGRADE_BONUS[3];
  const bonus = isDynasty ? baseBonus : Math.round(baseBonus * 0.5);

  return { bonus, timePenaltyCapApplied: true, tierDelta };
}

export function recomputePicksWithTimeCap(
  picks: PickTradeAsset[],
  isDynasty: boolean,
  capPenalty: number = MAX_TIME_PENALTY_ON_UPGRADE
): number {
  const currentYear = new Date().getFullYear();
  const minMult = 1.00 - capPenalty;
  
  const TIME_MULTIPLIER: Record<number, number> = { 0: 1.00, 1: 0.92, 2: 0.85, 3: 0.80 };
  const TIME_FLOOR = 0.75;
  
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  
  let total = 0;
  for (const p of picks) {
    const yearsAway = p.year - currentYear;
    let timeMult = TIME_MULTIPLIER[yearsAway] ?? TIME_FLOOR;
    timeMult = clamp(timeMult, Math.max(minMult, TIME_FLOOR), 1.00);
    
    const baseValues: Record<number, number> = isDynasty
      ? { 1: 6000, 2: 3900, 3: 2400, 4: 1200, 5: 600 }
      : { 1: 3000, 2: 1200, 3: 500, 4: 200, 5: 100 };
    
    const base = baseValues[Math.min(p.round, 5)] || (isDynasty ? 600 : 100);
    total += base * timeMult;
  }
  
  return Math.round(total);
}

export function tradeScore(sideValueGet: number, sideValueGive: number): number {
  if (sideValueGive <= 0) return 50;
  const ratio = sideValueGet / sideValueGive;

  const SCALE = 0.20;
  const x = (ratio - 1.0) / SCALE;
  const score = 50 + 50 * Math.tanh(x);

  return Math.max(0, Math.min(100, score));
}

export function letterGradeFromScore(score: number): string {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 58) return "C";
  if (score >= 45) return "D";
  return "F";
}

export function confidenceScore(magnitude: number, missingDataCount: number, nearEven: boolean): number {
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  
  let magConf = clamp((magnitude - 1000) / 10000, 0.2, 0.9);
  const missingPenalty = 0.08 * missingDataCount;
  const nearEvenPenalty = nearEven ? 0.10 : 0.00;

  const conf = magConf - missingPenalty - nearEvenPenalty;
  return clamp(conf, 0.15, 0.95);
}

export function compressScore(score: number, confidence: number): number {
  return 50 + (score - 50) * confidence;
}

export function processLabel(score: number, tierUpgradeApplied: boolean, isLowStakes: boolean): string {
  if (isLowStakes) {
    if (score >= 60) return "Process Win";
    if (score <= 40) return "Process Loss";
    return "Neutral Process";
  }

  if (tierUpgradeApplied && score >= 52) return "Process Win";
  if (score >= 60) return "Process Win";
  if (score <= 40) return "Process Loss";
  return "Neutral Process";
}

export function timingLabel(
  outgoingAssets: EnhancedTradeAsset[],
  incomingAssets: EnhancedTradeAsset[]
): string {
  const currentYear = new Date().getFullYear();
  const incomingPicks = incomingAssets.filter((a): a is PickTradeAsset => a.type === 'pick');
  const outgoingPicks = outgoingAssets.filter((a): a is PickTradeAsset => a.type === 'pick');

  const avgIncoming = incomingPicks.length > 0
    ? incomingPicks.reduce((sum, a) => sum + (a.year - currentYear), 0) / incomingPicks.length
    : 0;
  const avgOutgoing = outgoingPicks.length > 0
    ? outgoingPicks.reduce((sum, a) => sum + (a.year - currentYear), 0) / outgoingPicks.length
    : 0;

  const delta = avgOutgoing - avgIncoming;

  if (delta >= 0.6) return "Immediate Gain";
  if (delta <= -0.6) return "Timing Loss";
  return "Delayed Gain";
}

export interface EnhancedTradeAnalysis {
  score: number;
  grade: string;
  verdict: string;
  confidence: number;
  confidenceLabel: string;
  rawValues: { outgoing: number; incoming: number };
  tierOverride: { applied: boolean; bonus: number; tierDelta: number };
  whyTooltip: {
    headline: string;
    bullets: string[];
    math: { outgoingValue: number; incomingValue: number; delta: number; ratio: number; score: number };
    flags: { tierOverrideApplied: boolean; lowStakesTrade: boolean; futurePickDiscountApplied: boolean };
  };
}

export function analyzeTradeEnhanced(
  outgoingAssets: EnhancedTradeAsset[],
  incomingAssets: EnhancedTradeAsset[],
  isDynasty: boolean,
  missingDataCount: number = 0
): EnhancedTradeAnalysis {
  const currentYear = new Date().getFullYear();
  
  const calcSideValue = (assets: EnhancedTradeAsset[]): number => {
    let total = 0;
    for (const a of assets) {
      if (a.type === 'pick') {
        total += getPickValue(a.year, a.round, isDynasty);
      } else if (a.type === 'player') {
        total += a.value;
      }
    }
    return total;
  };

  let outVal = calcSideValue(outgoingAssets);
  let inVal = calcSideValue(incomingAssets);

  const override = applyTierJumpOverride(outgoingAssets, incomingAssets, isDynasty);
  
  if (override.timePenaltyCapApplied) {
    const incomingPicks = incomingAssets.filter((a): a is PickTradeAsset => a.type === 'pick');
    const playerVal = incomingAssets
      .filter((a): a is PlayerTradeAsset => a.type === 'player')
      .reduce((sum, p) => sum + p.value, 0);
    inVal = recomputePicksWithTimeCap(incomingPicks, isDynasty) + playerVal;
  }
  inVal += override.bonus;

  const rawScore = tradeScore(inVal, outVal);

  const magnitude = outVal + inVal;
  const isLowStakes = magnitude < 2000;
  const nearEven = Math.abs(rawScore - 50) < 8;

  const conf = confidenceScore(magnitude, missingDataCount, nearEven);
  const finalScore = compressScore(rawScore, conf);

  const timing = timingLabel(outgoingAssets, incomingAssets);
  const process = processLabel(finalScore, override.bonus > 0, isLowStakes);

  let grade = letterGradeFromScore(finalScore);
  if (isLowStakes && conf < 0.55) {
    if (finalScore >= 62) grade = "B";
    else if (finalScore <= 38) grade = "D";
    else grade = "C";
  }

  let confLabel = "Medium confidence";
  if (isLowStakes && conf < 0.55) confLabel = "Low confidence / Low stakes";
  else if (conf >= 0.75) confLabel = "High confidence";
  else if (conf < 0.55) confLabel = "Low confidence";

  const delta = inVal - outVal;
  const bullets: string[] = [];
  
  if (override.tierDelta > 0) {
    bullets.push(`You moved up ${override.tierDelta} tier(s) (meaningful hit-rate jump).`);
  }
  
  const incomingPicks = incomingAssets.filter((a): a is PickTradeAsset => a.type === 'pick');
  if (incomingPicks.length > 0) {
    const avgYearsOut = incomingPicks.reduce((sum, p) => sum + (p.year - currentYear), 0) / incomingPicks.length;
    if (avgYearsOut > 0.5) {
      bullets.push(`Future pick discount applied (${Math.round(avgYearsOut * 10) / 10} years out avg).`);
    }
  }
  
  bullets.push(`Net value: ${delta >= 0 ? '+' : ''}${Math.round(delta)} points after aging curve.`);
  bullets.push(override.bonus > 0 ? "Tier Jump Override applied." : "No tier override needed.");

  return {
    score: Math.round(finalScore),
    grade,
    verdict: `${process} / ${timing}`,
    confidence: conf,
    confidenceLabel: confLabel,
    rawValues: { outgoing: outVal, incoming: inVal },
    tierOverride: { applied: override.bonus > 0, bonus: override.bonus, tierDelta: override.tierDelta },
    whyTooltip: {
      headline: override.bonus > 0 ? "Tier upgrade outweighs time delay." : "Value difference from aging curve + market values.",
      bullets,
      math: {
        outgoingValue: Math.round(outVal),
        incomingValue: Math.round(inVal),
        delta: Math.round(delta),
        ratio: Math.round((inVal / Math.max(outVal, 1)) * 1000) / 1000,
        score: Math.round(finalScore)
      },
      flags: {
        tierOverrideApplied: override.bonus > 0,
        lowStakesTrade: isLowStakes,
        futurePickDiscountApplied: incomingPicks.length > 0
      }
    }
  };
}
