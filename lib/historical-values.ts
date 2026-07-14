import fs from 'fs';
import path from 'path';
import { fetchFantasyCalcValues, findPlayerByName } from '@/lib/player-valuations/canonicalPlayerValuations';
import { pickValue } from './pick-valuation';

const DATA_DIR = path.join(process.cwd(), 'data', 'historical-values');

interface HistoricalData {
  meta: {
    sheetName: string;
    generatedAt: string;
    dateRange: { start: string; end: string };
    totalDates: number;
    pickColumns: string[];
    playerCount: number;
  };
  pickValuesByDate: Record<string, Record<string, number>>;
  playerValuesByDate: Record<string, Record<string, number>>;
}

interface CurrentPlayer {
  name: string;
  posRank: string;
  position: string;
  team: string;
  value: number;
  age: number;
  isRookie: boolean;
  sfPosRank?: string;
  sfValue?: number;
}

interface CurrentData {
  generatedAt: string;
  players: CurrentPlayer[];
}

let oneQbHistorical: HistoricalData | null = null;
let sfHistorical: HistoricalData | null = null;
let oneQbCurrent: CurrentData | null = null;
let sfCurrent: CurrentData | null = null;

function loadData() {
  if (oneQbHistorical) return;
  
  try {
    const oneQbHistPath = path.join(DATA_DIR, '1qb-historical.json');
    const sfHistPath = path.join(DATA_DIR, 'sf-historical.json');
    const oneQbCurrPath = path.join(DATA_DIR, '1qb-current.json');
    const sfCurrPath = path.join(DATA_DIR, 'sf-current.json');
    
    if (fs.existsSync(oneQbHistPath)) {
      oneQbHistorical = JSON.parse(fs.readFileSync(oneQbHistPath, 'utf-8'));
    }
    if (fs.existsSync(sfHistPath)) {
      sfHistorical = JSON.parse(fs.readFileSync(sfHistPath, 'utf-8'));
    }
    if (fs.existsSync(oneQbCurrPath)) {
      oneQbCurrent = JSON.parse(fs.readFileSync(oneQbCurrPath, 'utf-8'));
    }
    if (fs.existsSync(sfCurrPath)) {
      sfCurrent = JSON.parse(fs.readFileSync(sfCurrPath, 'utf-8'));
    }
  } catch (error) {
    console.error('Error loading historical data:', error);
  }
}

const PLAYER_NAME_ALIASES: Record<string, string> = {
  'kenneth walker': 'kenneth walker iii',
  'ken walker': 'kenneth walker iii',
  'marvin harrison': 'marvin harrison jr',
  'michael pittman': 'michael pittman jr',
  'odell beckham': 'odell beckham jr',
  'patrick surtain': 'patrick surtain ii',
  'dj moore': 'd.j. moore',
  'aj brown': 'a.j. brown',
  'cj stroud': 'c.j. stroud',
  'jk dobbins': 'j.k. dobbins',
  'dk metcalf': 'd.k. metcalf',
  'tj hockenson': 't.j. hockenson',
  'gabriel davis': 'gabe davis',
  'chrisjones': 'chris jones',
};

function normalizePlayerName(name: string): string {
  let normalized = name
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bjr\.?\b/gi, '')
    .replace(/\bsr\.?\b/gi, '')
    .replace(/\biii\b/gi, '')
    .replace(/\bii\b/gi, '')
    .trim();
  
  return PLAYER_NAME_ALIASES[normalized] || normalized;
}

function findClosestDate(targetDate: string, data: HistoricalData): string | null {
  const availableDates = Object.keys(data.playerValuesByDate).sort().reverse();
  if (availableDates.length === 0) return null;
  
  for (const date of availableDates) {
    if (date <= targetDate) {
      return date;
    }
  }
  
  return availableDates[availableDates.length - 1];
}

function findPlayerInData(playerName: string, dateValues: Record<string, number>): number | null {
  const normalizedSearch = normalizePlayerName(playerName);
  
  for (const [name, value] of Object.entries(dateValues)) {
    if (normalizePlayerName(name) === normalizedSearch) {
      return value;
    }
  }
  
  for (const [name, value] of Object.entries(dateValues)) {
    const normalizedName = normalizePlayerName(name);
    if (normalizedName.includes(normalizedSearch) || normalizedSearch.includes(normalizedName)) {
      return value;
    }
  }
  
  return null;
}

export function getHistoricalPlayerValue(
  playerName: string,
  date: string,
  isSuperFlex: boolean = false
): { value: number | null; actualDate: string | null; source: string } {
  loadData();
  
  const data = isSuperFlex ? sfHistorical : oneQbHistorical;
  if (!data) {
    return { value: null, actualDate: null, source: 'no_data' };
  }
  
  const actualDate = findClosestDate(date, data);
  if (!actualDate) {
    return { value: null, actualDate: null, source: 'no_date' };
  }
  
  const dateValues = data.playerValuesByDate[actualDate];
  if (!dateValues) {
    return { value: null, actualDate, source: 'no_values' };
  }
  
  const value = findPlayerInData(playerName, dateValues);
  return { 
    value, 
    actualDate, 
    source: value !== null ? 'historical' : 'not_found' 
  };
}

// Weighted bucket distribution when bucket is unknown
// Most picks are mid-round value, with smaller portions being early/late
const DEFAULT_BUCKET_WEIGHTS = { early: 0.20, mid: 0.60, late: 0.20 };

export function getHistoricalPickValue(
  year: number,
  round: number,
  tier: 'early' | 'mid' | 'late',
  date: string,
  isSuperFlex: boolean = false
): { value: number | null; actualDate: string | null; pickKey: string } {
  loadData();
  
  const data = isSuperFlex ? sfHistorical : oneQbHistorical;
  if (!data) {
    return { value: null, actualDate: null, pickKey: '' };
  }
  
  const actualDate = findClosestDate(date, data);
  if (!actualDate) {
    return { value: null, actualDate: null, pickKey: '' };
  }
  
  const roundSuffix = round === 1 ? '1st' : round === 2 ? '2nd' : round === 3 ? '3rd' : `${round}th`;
  const tierCapitalized = tier.charAt(0).toUpperCase() + tier.slice(1);
  const pickKey = `${year} ${tierCapitalized} ${roundSuffix}`;
  
  const pickValues = data.pickValuesByDate[actualDate];
  if (!pickValues) {
    return { value: null, actualDate, pickKey };
  }
  
  return { 
    value: pickValues[pickKey] ?? null, 
    actualDate, 
    pickKey 
  };
}

/**
 * Get historical pick value with weighted bucket averaging when bucket is unknown
 * Uses 20% Early, 60% Mid, 20% Late weighting for unknown buckets
 */
export function getHistoricalPickValueWeighted(
  year: number,
  round: number,
  bucketOrNull: 'early' | 'mid' | 'late' | null,
  date: string,
  isSuperFlex: boolean = false
): { 
  value: number | null; 
  actualDate: string | null; 
  pickKey: string;
  wasAveraged: boolean;
  bucketBreakdown?: { early: number | null; mid: number | null; late: number | null };
} {
  loadData();
  
  const data = isSuperFlex ? sfHistorical : oneQbHistorical;
  if (!data) {
    return { value: null, actualDate: null, pickKey: '', wasAveraged: false };
  }
  
  const actualDate = findClosestDate(date, data);
  if (!actualDate) {
    return { value: null, actualDate: null, pickKey: '', wasAveraged: false };
  }
  
  const pickValues = data.pickValuesByDate[actualDate];
  if (!pickValues) {
    return { value: null, actualDate, pickKey: '', wasAveraged: false };
  }
  
  const roundSuffix = round === 1 ? '1st' : round === 2 ? '2nd' : round === 3 ? '3rd' : `${round}th`;
  
  // If bucket is known, use direct lookup
  if (bucketOrNull) {
    const tierCapitalized = bucketOrNull.charAt(0).toUpperCase() + bucketOrNull.slice(1);
    const pickKey = `${year} ${tierCapitalized} ${roundSuffix}`;
    return { 
      value: pickValues[pickKey] ?? null, 
      actualDate, 
      pickKey,
      wasAveraged: false
    };
  }
  
  // Bucket unknown - compute weighted average
  const bucketBreakdown: { early: number | null; mid: number | null; late: number | null } = {
    early: null, mid: null, late: null
  };
  
  let total = 0;
  let weightSum = 0;
  
  for (const [bucket, weight] of Object.entries(DEFAULT_BUCKET_WEIGHTS) as [keyof typeof DEFAULT_BUCKET_WEIGHTS, number][]) {
    const tierCapitalized = bucket.charAt(0).toUpperCase() + bucket.slice(1);
    const colName = `${year} ${tierCapitalized} ${roundSuffix}`;
    const val = pickValues[colName];
    
    if (typeof val === 'number' && !isNaN(val)) {
      bucketBreakdown[bucket] = val;
      total += val * weight;
      weightSum += weight;
    }
  }
  
  if (weightSum === 0) {
    return { value: null, actualDate, pickKey: `${year} Mid ${roundSuffix}`, wasAveraged: true, bucketBreakdown };
  }
  
  return { 
    value: Math.round(total / weightSum), 
    actualDate, 
    pickKey: `${year} Weighted ${roundSuffix}`,
    wasAveraged: true,
    bucketBreakdown
  };
}

export function getPlayerValueChange(
  playerName: string,
  startDate: string,
  endDate: string,
  isSuperFlex: boolean = false
): { 
  startValue: number | null; 
  endValue: number | null; 
  change: number | null;
  percentChange: number | null;
  trend: 'rising' | 'falling' | 'stable' | 'unknown';
} {
  const start = getHistoricalPlayerValue(playerName, startDate, isSuperFlex);
  const end = getHistoricalPlayerValue(playerName, endDate, isSuperFlex);
  
  if (start.value === null || end.value === null) {
    return { 
      startValue: start.value, 
      endValue: end.value, 
      change: null, 
      percentChange: null,
      trend: 'unknown' 
    };
  }
  
  const change = end.value - start.value;
  const percentChange = start.value > 0 ? (change / start.value) * 100 : null;
  
  let trend: 'rising' | 'falling' | 'stable' | 'unknown' = 'stable';
  if (percentChange !== null) {
    if (percentChange > 5) trend = 'rising';
    else if (percentChange < -5) trend = 'falling';
  }
  
  return { startValue: start.value, endValue: end.value, change, percentChange, trend };
}

export interface TradeConfidenceResult {
  confidence: number;
  confidenceLabel: 'High' | 'Learning' | 'Evolving';
  factors: {
    playersFoundInHistorical: number;
    playersMissing: number;
    picksAveraged: number;
    picksKnownBucket: number;
    dataRecency: 'exact' | 'near' | 'fallback';
  };
  explanation: string;
}

export function calculateTradeConfidence(
  playerResults: { name: string; found: boolean }[],
  pickResults: { wasAveraged: boolean }[],
  dataRecency: 'exact' | 'near' | 'fallback' = 'exact'
): TradeConfidenceResult {
  let confidence = 0.50;
  
  const playersFoundInHistorical = playerResults.filter(p => p.found).length;
  const playersMissing = playerResults.filter(p => !p.found).length;
  const picksAveraged = pickResults.filter(p => p.wasAveraged).length;
  const picksKnownBucket = pickResults.filter(p => !p.wasAveraged).length;
  
  if (playerResults.length > 0) {
    const playerFoundRatio = playersFoundInHistorical / playerResults.length;
    confidence += playerFoundRatio * 0.25;
  }
  
  if (pickResults.length > 0) {
    const bucketKnownRatio = picksKnownBucket / pickResults.length;
    confidence += bucketKnownRatio * 0.10;
    
    if (picksAveraged > 0) {
      confidence -= 0.05;
    }
  }
  
  if (dataRecency === 'exact') {
    confidence += 0.05;
  } else if (dataRecency === 'fallback') {
    confidence -= 0.10;
  }
  
  const totalAssets = playerResults.length + pickResults.length;
  if (totalAssets <= 2) {
    confidence -= 0.05;
  } else if (totalAssets >= 6) {
    confidence += 0.05;
  }
  
  confidence = Math.max(0.15, Math.min(0.95, confidence));
  
  let confidenceLabel: 'High' | 'Learning' | 'Evolving';
  if (confidence >= 0.70) {
    confidenceLabel = 'High';
  } else if (confidence >= 0.45) {
    confidenceLabel = 'Learning';
  } else {
    confidenceLabel = 'Evolving';
  }
  
  const explanations: string[] = [];
  if (playersFoundInHistorical === playerResults.length && playerResults.length > 0) {
    explanations.push('All players found in historical data');
  } else if (playersMissing > 0) {
    explanations.push(`${playersMissing} player(s) not in historical database`);
  }
  
  if (picksAveraged > 0) {
    explanations.push(`${picksAveraged} pick(s) used weighted bucket averaging`);
  }
  
  if (dataRecency === 'fallback') {
    explanations.push('Using model-based values (no historical data available for date)');
  }
  
  return {
    confidence: Math.round(confidence * 100) / 100,
    confidenceLabel,
    factors: {
      playersFoundInHistorical,
      playersMissing,
      picksAveraged,
      picksKnownBucket,
      dataRecency,
    },
    explanation: explanations.join('; ') || 'Standard confidence based on available data',
  };
}

export function getCurrentPlayerValue(
  playerName: string,
  isSuperFlex: boolean = false
): CurrentPlayer | null {
  loadData();
  
  const data = isSuperFlex ? sfCurrent : oneQbCurrent;
  if (!data) return null;
  
  const normalizedSearch = normalizePlayerName(playerName);
  
  for (const player of data.players) {
    if (normalizePlayerName(player.name) === normalizedSearch) {
      return player;
    }
  }
  
  for (const player of data.players) {
    const normalizedName = normalizePlayerName(player.name);
    if (normalizedName.includes(normalizedSearch) || normalizedSearch.includes(normalizedName)) {
      return player;
    }
  }
  
  return null;
}

export function getHistoricalContext(
  playerName: string,
  tradeDate: string,
  isSuperFlex: boolean = false
): {
  valueAtTrade: number | null;
  currentValue: number | null;
  valueChange: number | null;
  percentChange: number | null;
  trend: string;
  peakValue: number | null;
  peakDate: string | null;
  lowValue: number | null;
  lowDate: string | null;
} {
  loadData();
  
  const data = isSuperFlex ? sfHistorical : oneQbHistorical;
  const current = getCurrentPlayerValue(playerName, isSuperFlex);
  const atTrade = getHistoricalPlayerValue(playerName, tradeDate, isSuperFlex);
  
  let peakValue: number | null = null;
  let peakDate: string | null = null;
  let lowValue: number | null = null;
  let lowDate: string | null = null;
  
  if (data) {
    const normalizedSearch = normalizePlayerName(playerName);
    
    for (const [date, values] of Object.entries(data.playerValuesByDate)) {
      if (date < tradeDate) continue;
      
      for (const [name, value] of Object.entries(values)) {
        if (normalizePlayerName(name) === normalizedSearch) {
          if (peakValue === null || value > peakValue) {
            peakValue = value;
            peakDate = date;
          }
          if (lowValue === null || value < lowValue) {
            lowValue = value;
            lowDate = date;
          }
          break;
        }
      }
    }
  }
  
  const valueAtTradeNum = atTrade.value;
  const currentValueNum = current?.value ?? null;
  
  let valueChange: number | null = null;
  let percentChange: number | null = null;
  let trend = 'unknown';
  
  if (valueAtTradeNum !== null && currentValueNum !== null) {
    valueChange = currentValueNum - valueAtTradeNum;
    percentChange = valueAtTradeNum > 0 ? (valueChange / valueAtTradeNum) * 100 : null;
    
    if (percentChange !== null) {
      if (percentChange > 20) trend = 'significantly_up';
      else if (percentChange > 5) trend = 'up';
      else if (percentChange < -20) trend = 'significantly_down';
      else if (percentChange < -5) trend = 'down';
      else trend = 'stable';
    }
  }
  
  return {
    valueAtTrade: valueAtTradeNum,
    currentValue: currentValueNum,
    valueChange,
    percentChange: percentChange !== null ? Math.round(percentChange * 10) / 10 : null,
    trend,
    peakValue,
    peakDate,
    lowValue,
    lowDate
  };
}

export function getDataInfo(): {
  loaded: boolean;
  oneQbHistorical: { dateRange: { start: string; end: string }; playerCount: number; totalDates: number } | null;
  sfHistorical: { dateRange: { start: string; end: string }; playerCount: number; totalDates: number } | null;
  oneQbCurrent: { playerCount: number } | null;
  sfCurrent: { playerCount: number } | null;
} {
  loadData();
  
  return {
    loaded: oneQbHistorical !== null || sfHistorical !== null,
    oneQbHistorical: oneQbHistorical ? {
      dateRange: oneQbHistorical.meta.dateRange,
      playerCount: oneQbHistorical.meta.playerCount,
      totalDates: oneQbHistorical.meta.totalDates
    } : null,
    sfHistorical: sfHistorical ? {
      dateRange: sfHistorical.meta.dateRange,
      playerCount: sfHistorical.meta.playerCount,
      totalDates: sfHistorical.meta.totalDates
    } : null,
    oneQbCurrent: oneQbCurrent ? { playerCount: oneQbCurrent.players.length } : null,
    sfCurrent: sfCurrent ? { playerCount: sfCurrent.players.length } : null
  };
}

export function buildHistoricalTradeContext(
  trade: {
    date: string;
    sideAPlayers: string[];
    sideBPlayers: string[];
    sideAPicks?: { year: number; round: number; tier?: 'early' | 'mid' | 'late' }[];
    sideBPicks?: { year: number; round: number; tier?: 'early' | 'mid' | 'late' }[];
  },
  isSuperFlex: boolean = false
): {
  tradeDate: string;
  sideAContext: {
    players: { name: string; valueAtTrade: number | null; currentValue: number | null; percentChange: number | null; trend: string }[];
    picks: { desc: string; valueAtTrade: number | null; wasAveraged: boolean }[];
    totalValueAtTrade: number;
  };
  sideBContext: {
    players: { name: string; valueAtTrade: number | null; currentValue: number | null; percentChange: number | null; trend: string }[];
    picks: { desc: string; valueAtTrade: number | null; wasAveraged: boolean }[];
    totalValueAtTrade: number;
  };
  hindsightVerdict: string;
  hindsightScore: number;
} {
  const sideAPlayers = trade.sideAPlayers.map(name => {
    const ctx = getHistoricalContext(name, trade.date, isSuperFlex);
    return {
      name,
      valueAtTrade: ctx.valueAtTrade,
      currentValue: ctx.currentValue,
      percentChange: ctx.percentChange,
      trend: ctx.trend
    };
  });
  
  const sideBPlayers = trade.sideBPlayers.map(name => {
    const ctx = getHistoricalContext(name, trade.date, isSuperFlex);
    return {
      name,
      valueAtTrade: ctx.valueAtTrade,
      currentValue: ctx.currentValue,
      percentChange: ctx.percentChange,
      trend: ctx.trend
    };
  });
  
  const sideAPicks = (trade.sideAPicks || []).map(p => {
    const result = getHistoricalPickValueWeighted(p.year, p.round, p.tier || null, trade.date, isSuperFlex);
    return {
      desc: result.pickKey || `${p.year} Round ${p.round}`,
      valueAtTrade: result.value,
      wasAveraged: result.wasAveraged
    };
  });
  
  const sideBPicks = (trade.sideBPicks || []).map(p => {
    const result = getHistoricalPickValueWeighted(p.year, p.round, p.tier || null, trade.date, isSuperFlex);
    return {
      desc: result.pickKey || `${p.year} Round ${p.round}`,
      valueAtTrade: result.value,
      wasAveraged: result.wasAveraged
    };
  });
  
  const sideATotalAtTrade = 
    sideAPlayers.reduce((sum, p) => sum + (p.valueAtTrade || 0), 0) +
    sideAPicks.reduce((sum, p) => sum + (p.valueAtTrade || 0), 0);
  
  const sideBTotalAtTrade = 
    sideBPlayers.reduce((sum, p) => sum + (p.valueAtTrade || 0), 0) +
    sideBPicks.reduce((sum, p) => sum + (p.valueAtTrade || 0), 0);
  
  const sideACurrentValue = sideAPlayers.reduce((sum, p) => sum + (p.currentValue || 0), 0);
  const sideBCurrentValue = sideBPlayers.reduce((sum, p) => sum + (p.currentValue || 0), 0);
  
  let hindsightVerdict = 'Unknown';
  let hindsightScore = 50;
  
  if (sideACurrentValue > 0 && sideBCurrentValue > 0) {
    const diff = sideACurrentValue - sideBCurrentValue;
    const total = sideACurrentValue + sideBCurrentValue;
    const percentDiff = (diff / total) * 100;
    
    if (percentDiff > 15) {
      hindsightVerdict = 'Side A won big';
      hindsightScore = 85;
    } else if (percentDiff > 5) {
      hindsightVerdict = 'Side A edged it';
      hindsightScore = 65;
    } else if (percentDiff < -15) {
      hindsightVerdict = 'Side B won big';
      hindsightScore = 15;
    } else if (percentDiff < -5) {
      hindsightVerdict = 'Side B edged it';
      hindsightScore = 35;
    } else {
      hindsightVerdict = 'Fair trade in hindsight';
      hindsightScore = 50;
    }
  }
  
  return {
    tradeDate: trade.date,
    sideAContext: {
      players: sideAPlayers,
      picks: sideAPicks,
      totalValueAtTrade: sideATotalAtTrade
    },
    sideBContext: {
      players: sideBPlayers,
      picks: sideBPicks,
      totalValueAtTrade: sideBTotalAtTrade
    },
    hindsightVerdict,
    hindsightScore
  };
}

export interface DualModeResult {
  atTheTime: {
    sideATotal: number;
    sideBTotal: number;
    differential: number;
    percentDiff: number;
    verdict: string;
    grade: string;
  };
  withHindsight: {
    sideATotal: number;
    sideBTotal: number;
    differential: number;
    percentDiff: number;
    verdict: string;
    grade: string;
  };
  comparison: string;
  valuationDetails: {
    playersFromExcel: number;
    playersFromFantasyCalc: number;
    playersUnknown: number;
    picksFromExcel: number;
    picksFromCurve: number;
  };
}

/**
 * Compute dual-mode trade grades using Hybrid Valuation Rule:
 * 
 * PLAYERS:
 * 1. Excel historical value for asOfDate (historical precision)
 * 2. FantasyCalc current value (coverage fallback)
 * 3. 0 + mark unknown (if missing both)
 * 
 * PICKS:
 * 1. Excel historical pick value for asOfDate
 * 2. Pick curve (for years beyond historical data like 2027+)
 * 3. Weighted bucket avg if tier unknown (20% early, 60% mid, 20% late)
 */
export async function computeDualModeGrades(
  trade: {
    date: string;
    sideAPlayers: string[];
    sideBPlayers: string[];
    sideAPicks?: { year: number; round: number; tier?: 'early' | 'mid' | 'late' }[];
    sideBPicks?: { year: number; round: number; tier?: 'early' | 'mid' | 'late' }[];
  },
  isSuperFlex: boolean = false
): Promise<DualModeResult> {
  loadData();
  
  const currentData = isSuperFlex ? sfCurrent : oneQbCurrent;
  const historicalData = isSuperFlex ? sfHistorical : oneQbHistorical;
  
  // Tracking for valuation details
  let playersFromExcel = 0;
  let playersFromFantasyCalc = 0;
  let playersUnknown = 0;
  let picksFromExcel = 0;
  let picksFromCurve = 0;
  
  // Fetch FantasyCalc data once for coverage fallback
  let fantasyCalcPlayers: Awaited<ReturnType<typeof fetchFantasyCalcValues>> = [];
  try {
    fantasyCalcPlayers = await fetchFantasyCalcValues({
      isDynasty: true,
      numQbs: isSuperFlex ? 2 : 1,
      numTeams: 12,
      ppr: 1
    });
  } catch (e) {
    console.warn('FantasyCalc fetch failed, using Excel-only:', e);
  }
  
  // HYBRID PLAYER VALUE: Excel historical → FantasyCalc current → 0
  function getAtTimeValue(playerName: string): number {
    const result = getHistoricalPlayerValue(playerName, trade.date, isSuperFlex);
    if (result.value !== null) {
      playersFromExcel++;
      return result.value;
    }
    // Fallback to FantasyCalc current value (better than 0)
    const fcPlayer = findPlayerByName(fantasyCalcPlayers, playerName);
    if (fcPlayer) {
      playersFromFantasyCalc++;
      return fcPlayer.value;
    }
    playersUnknown++;
    return 0;
  }
  
  // HYBRID CURRENT VALUE: Excel current → FantasyCalc → 0
  function getCurrentValue(playerName: string): number {
    // First try Excel current data
    if (currentData) {
      const normalizedSearch = normalizePlayerName(playerName);
      for (const player of currentData.players) {
        if (normalizePlayerName(player.name) === normalizedSearch) {
          return isSuperFlex ? (player.sfValue ?? player.value) : player.value;
        }
      }
    }
    // Fallback to FantasyCalc
    const fcPlayer = findPlayerByName(fantasyCalcPlayers, playerName);
    if (fcPlayer) {
      return fcPlayer.value;
    }
    return 0;
  }
  
  // HYBRID PICK VALUE: Excel historical → pick curve (for future years)
  function getAtTimePickValue(pick: { year: number; round: number; tier?: 'early' | 'mid' | 'late' }): number {
    const result = getHistoricalPickValueWeighted(pick.year, pick.round, pick.tier || null, trade.date, isSuperFlex);
    if (result.value !== null) {
      picksFromExcel++;
      return result.value;
    }
    // Fallback to pick curve for years beyond historical data
    const tradeYear = new Date(trade.date).getFullYear();
    const curveValue = pickValue(pick.round, pick.year, tradeYear, null);
    picksFromCurve++;
    // Scale curve value (0-100) to dynasty points (roughly 100 = 8000 points for 1st)
    return Math.round(curveValue * 80);
  }
  
  function getCurrentPickValue(pick: { year: number; round: number; tier?: 'early' | 'mid' | 'late' }): number {
    const today = new Date().toISOString().slice(0, 10);
    const currentYear = new Date().getFullYear();
    const result = getHistoricalPickValueWeighted(pick.year, pick.round, pick.tier || null, today, isSuperFlex);
    if (result.value !== null) {
      return result.value;
    }
    // Fallback to pick curve
    const curveValue = pickValue(pick.round, pick.year, currentYear, null);
    return Math.round(curveValue * 80);
  }
  
  // Calculate all values
  const sideAPlayersAtTime = trade.sideAPlayers.reduce((sum, p) => sum + getAtTimeValue(p), 0);
  const sideBPlayersAtTime = trade.sideBPlayers.reduce((sum, p) => sum + getAtTimeValue(p), 0);
  const sideAPicksAtTime = (trade.sideAPicks || []).reduce((sum, p) => sum + getAtTimePickValue(p), 0);
  const sideBPicksAtTime = (trade.sideBPicks || []).reduce((sum, p) => sum + getAtTimePickValue(p), 0);
  
  const sideAPlayersCurrent = trade.sideAPlayers.reduce((sum, p) => sum + getCurrentValue(p), 0);
  const sideBPlayersCurrent = trade.sideBPlayers.reduce((sum, p) => sum + getCurrentValue(p), 0);
  const sideAPicksCurrent = (trade.sideAPicks || []).reduce((sum, p) => sum + getCurrentPickValue(p), 0);
  const sideBPicksCurrent = (trade.sideBPicks || []).reduce((sum, p) => sum + getCurrentPickValue(p), 0);
  
  const atTimeSideA = sideAPlayersAtTime + sideAPicksAtTime;
  const atTimeSideB = sideBPlayersAtTime + sideBPicksAtTime;
  const currentSideA = sideAPlayersCurrent + sideAPicksCurrent;
  const currentSideB = sideBPlayersCurrent + sideBPicksCurrent;
  
  function computeGrade(sideA: number, sideB: number): { differential: number; percentDiff: number; verdict: string; grade: string } {
    const differential = sideA - sideB;
    const total = sideA + sideB;
    const percentDiff = total > 0 ? (differential / total) * 100 : 0;
    
    let verdict: string;
    let grade: string;
    
    if (percentDiff > 20) {
      verdict = 'Side A won big';
      grade = 'A+';
    } else if (percentDiff > 10) {
      verdict = 'Side A won clearly';
      grade = 'A';
    } else if (percentDiff > 5) {
      verdict = 'Side A edged it';
      grade = 'B+';
    } else if (percentDiff > -5) {
      verdict = 'Fair trade';
      grade = 'B';
    } else if (percentDiff > -10) {
      verdict = 'Side B edged it';
      grade = 'C+';
    } else if (percentDiff > -20) {
      verdict = 'Side B won clearly';
      grade = 'C';
    } else {
      verdict = 'Side B won big';
      grade = 'D';
    }
    
    return { differential, percentDiff, verdict, grade };
  }
  
  const atTimeResult = computeGrade(atTimeSideA, atTimeSideB);
  const hindsightResult = computeGrade(currentSideA, currentSideB);
  
  let comparison: string;
  const gradeDiff = atTimeResult.percentDiff - hindsightResult.percentDiff;
  if (Math.abs(gradeDiff) < 5) {
    comparison = 'Trade grade remained consistent over time';
  } else if (gradeDiff > 0) {
    comparison = 'Trade looked better at the time than it does now';
  } else {
    comparison = 'Trade has aged well - looks better now than it did then';
  }
  
  return {
    atTheTime: {
      sideATotal: atTimeSideA,
      sideBTotal: atTimeSideB,
      ...atTimeResult
    },
    withHindsight: {
      sideATotal: currentSideA,
      sideBTotal: currentSideB,
      ...hindsightResult
    },
    comparison,
    valuationDetails: {
      playersFromExcel,
      playersFromFantasyCalc,
      playersUnknown,
      picksFromExcel,
      picksFromCurve
    }
  };
}
