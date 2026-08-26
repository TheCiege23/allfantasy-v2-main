import { getHistoricalPlayerValue, getHistoricalPickValueWeighted } from './historical-values';
import { findPlayerByName, FantasyCalcPlayer } from './fantasycalc';
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db';
import { pickValue } from './pick-valuation';
import { computePlayerVorp as computePlayerVorpEngine, computePickVorp as computePickVorpEngine, LeagueRosterConfig } from './vorp-engine';
import { isIdpPosition, isKickerPosition } from './idp-kicker-values';
import { isUserParty } from './user-matching';
import { getPlayerAnalytics, type PlayerAnalytics } from './player-analytics';

export interface ValuationContext {
  asOfDate: string;
  isSuperFlex: boolean;
  fantasyCalcPlayers?: FantasyCalcPlayer[];
  numTeams?: number;
  rosterConfig?: LeagueRosterConfig;
  playerPositionOverrides?: Record<string, string>;
  /** League scoring; defaults to full PPR when the caller has no league context. */
  ppr?: 0 | 0.5 | 1;
  /** League format; defaults to dynasty when the caller has no league context. */
  isDynasty?: boolean;
}

export interface AssetValue {
  marketValue: number;
  impactValue: number;
  vorpValue: number;
  volatility: number;
}

export interface PricedAsset {
  name: string;
  type: 'player' | 'pick';
  value: number;
  assetValue: AssetValue;
  source: 'excel' | 'fantasycalc' | 'curve' | 'unknown';
  position?: string;
  age?: number;
  details?: {
    year?: number;
    round?: number;
    tier?: string;
    wasAveraged?: boolean;
  };
}


const POSITION_VOLATILITY_DEFAULTS: Record<string, number> = {
  RB: 0.30,
  WR: 0.18,
  QB: 0.12,
  TE: 0.22,
  K: 0.10,
  DEF: 0.10,
}

const AGE_VOLATILITY_CURVE: Record<string, { peakAge: number; decayRate: number }> = {
  QB: { peakAge: 28, decayRate: 0.015 },
  RB: { peakAge: 24, decayRate: 0.04 },
  WR: { peakAge: 26, decayRate: 0.02 },
  TE: { peakAge: 27, decayRate: 0.02 },
}

let _fcPlayersCache: FantasyCalcPlayer[] | null = null;
let _fcPlayersCacheKey: string = '';

async function getFantasyCalcPlayers(ctx: ValuationContext): Promise<FantasyCalcPlayer[]> {
  if (ctx.fantasyCalcPlayers) return ctx.fantasyCalcPlayers;

  const cacheKey = `${ctx.isDynasty ?? true}-${ctx.isSuperFlex}-${ctx.numTeams ?? 12}-${ctx.ppr ?? 1}`;
  if (_fcPlayersCache && _fcPlayersCacheKey === cacheKey) {
    return _fcPlayersCache;
  }

  try {
    const players = await getFantasyCalcValuesDbFirst({
      isDynasty: ctx.isDynasty ?? true,
      numQbs: ctx.isSuperFlex ? 2 : 1,
      numTeams: ctx.numTeams ?? 12,
      ppr: ctx.ppr ?? 1,
    });
    _fcPlayersCache = players;
    _fcPlayersCacheKey = cacheKey;
    return players;
  } catch (e) {
    console.error('[hybrid-valuation] Failed to fetch FantasyCalc values:', e);
    return [];
  }
}

function clampVal(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function computePlayerVolatility(
  fcPlayer: FantasyCalcPlayer | null,
  position: string,
  age: number | null,
  analyticsData?: PlayerAnalytics | null
): number {
  const posKey = position.toUpperCase();
  let vol = POSITION_VOLATILITY_DEFAULTS[posKey] ?? 0.20;

  if (fcPlayer?.maybeMovingStandardDeviationPerc != null) {
    const stdPct = Math.abs(fcPlayer.maybeMovingStandardDeviationPerc);
    vol = clampVal(stdPct / 100, 0.05, 0.60);
  } else if (fcPlayer?.maybeMovingStandardDeviation != null && fcPlayer.value > 0) {
    const stdRatio = Math.abs(fcPlayer.maybeMovingStandardDeviation) / fcPlayer.value;
    vol = clampVal(stdRatio, 0.05, 0.60);
  } else if (analyticsData?.weeklyVolatility != null && analyticsData.weeklyVolatility > 0) {
    vol = clampVal(analyticsData.weeklyVolatility / 100, 0.05, 0.60);
  }

  if (age != null) {
    const curve = AGE_VOLATILITY_CURVE[posKey];
    if (curve) {
      const yearsFromPeak = Math.max(0, age - curve.peakAge);
      const agePenalty = Math.min(yearsFromPeak * curve.decayRate, 0.20);
      vol += agePenalty;
    }
  }

  return clampVal(vol, 0.05, 0.60);
}

function computePickVolatility(yearsOut: number): number {
  if (yearsOut <= 0) return 0.35;
  if (yearsOut === 1) return 0.42;
  if (yearsOut === 2) return 0.50;
  return 0.55;
}

function computeImpactFromMarket(
  marketValue: number,
  fcPlayer: FantasyCalcPlayer | null,
  position: string
): number {
  if (fcPlayer && fcPlayer.redraftValue > 0) {
    return fcPlayer.redraftValue;
  }

  const posScarcityMultiplier: Record<string, number> = {
    QB: 0.65,
    RB: 0.80,
    WR: 0.72,
    TE: 0.60,
    K: 0.30,
    DEF: 0.30,
  };
  const mult = posScarcityMultiplier[position.toUpperCase()] ?? 0.65;
  return Math.round(marketValue * mult);
}

function computePickImpact(marketValue: number, round: number): number {
  const roundScale: Record<number, number> = { 1: 0.70, 2: 0.55, 3: 0.40, 4: 0.30 };
  const scale = roundScale[round] ?? 0.25;
  return Math.round(marketValue * scale);
}

function buildRosterConfig(ctx: ValuationContext): LeagueRosterConfig {
  if (ctx.rosterConfig) return ctx.rosterConfig;
  const numTeams = ctx.numTeams ?? 12;
  return {
    numTeams,
    startingQB: 1,
    startingRB: 2,
    startingWR: 2,
    startingTE: 1,
    startingFlex: ctx.isSuperFlex ? 3 : 2,
    superflex: ctx.isSuperFlex,
  };
}

function computeVorp(
  fcPlayer: FantasyCalcPlayer | null,
  position: string,
  ctx: ValuationContext,
  fcPlayers: FantasyCalcPlayer[]
): number {
  const config = buildRosterConfig(ctx);
  const posRank = fcPlayer?.positionRank ?? 0;
  const redraftVal = fcPlayer?.redraftValue ?? 0;
  return computePlayerVorpEngine(position, posRank, redraftVal, config, fcPlayers);
}

export function compositeScore(av: AssetValue): number {
  const riskPenalty = av.volatility * 0.25 * (av.impactValue + av.vorpValue);
  return Math.max(0, Math.round(av.impactValue + av.vorpValue - riskPenalty));
}

export function compositeTotal(assets: PricedAsset[]): number {
  return assets.reduce((sum, a) => sum + compositeScore(a.assetValue), 0);
}

export function marketTotal(assets: PricedAsset[]): number {
  return assets.reduce((sum, a) => sum + a.assetValue.marketValue, 0);
}

export interface TradeParty {
  userId: string;
  teamName?: string;
  playersReceived: Array<{ name: string; position?: string }>;
  picksReceived: Array<{ round: number; season: string; slot?: string }>;
}

export interface UserTrade {
  transactionId: string;
  timestamp: number;
  week?: number;
  parties: TradeParty[];
  grade?: string;
  verdict?: string;
}

export interface TradeDelta {
  userReceivedValue: number;
  userGaveValue: number;
  deltaValue: number;
  percentDiff: number;
  verdict: string;
  grade: string;
  confidence: number;
  receivedAssets: PricedAsset[];
  gaveAssets: PricedAsset[];
  valuationStats: {
    playersFromExcel: number;
    playersFromFantasyCalc: number;
    playersUnknown: number;
    picksFromExcel: number;
    picksFromCurve: number;
  };
}

const IDP_KICKER_BASELINE_VALUES: Record<string, number> = {
  LB: 800,
  DL: 700,
  DB: 650,
  DE: 700,
  DT: 600,
  ILB: 800,
  OLB: 750,
  CB: 650,
  SS: 600,
  FS: 600,
  S: 600,
  K: 300,
}

function getIdpKickerFallbackValue(name: string, position: string): number {
  const pos = position.toUpperCase()
  if (isIdpPosition(pos) || isKickerPosition(pos)) {
    return IDP_KICKER_BASELINE_VALUES[pos] ?? 500
  }
  return 0
}

export async function pricePlayer(
  name: string,
  ctx: ValuationContext
): Promise<PricedAsset> {
  const fcPlayers = await getFantasyCalcPlayers(ctx);

  const fcPlayer = findPlayerByName(fcPlayers, name);
  const overridePos = ctx.playerPositionOverrides?.[name.toLowerCase().trim()];
  const position = overridePos || fcPlayer?.player.position || 'UNKNOWN';
  const age = fcPlayer?.player.maybeAge ?? null;

  let analyticsData: PlayerAnalytics | null = null;
  try {
    analyticsData = await getPlayerAnalytics(name);
  } catch (e) {
    console.warn(`[hybrid-valuation] Could not fetch analytics for "${name}":`, e);
  }

  const historicalResult = getHistoricalPlayerValue(name, ctx.asOfDate, ctx.isSuperFlex);
  if (historicalResult.value !== null) {
    const mv = historicalResult.value;
    const impact = computeImpactFromMarket(mv, fcPlayer, position);
    const vorp = computeVorp(fcPlayer, position, ctx, fcPlayers);
    const vol = computePlayerVolatility(fcPlayer, position, age, analyticsData);
    return {
      name,
      type: 'player',
      value: mv,
      assetValue: { marketValue: mv, impactValue: impact, vorpValue: vorp, volatility: vol },
      source: 'excel',
      position,
      ...(age != null && { age }),
    };
  }

  if (fcPlayer) {
    const mv = fcPlayer.value;
    const impact = computeImpactFromMarket(mv, fcPlayer, position);
    const vorp = computeVorp(fcPlayer, position, ctx, fcPlayers);
    const vol = computePlayerVolatility(fcPlayer, position, age, analyticsData);
    return {
      name,
      type: 'player',
      value: mv,
      assetValue: { marketValue: mv, impactValue: impact, vorpValue: vorp, volatility: vol },
      source: 'fantasycalc',
      position,
      ...(age != null && { age }),
    };
  }

  const idpKickerFallback = getIdpKickerFallbackValue(name, position);
  if (idpKickerFallback > 0) {
    const vol = computePlayerVolatility(null, position, age, analyticsData);
    return {
      name,
      type: 'player',
      value: idpKickerFallback,
      assetValue: {
        marketValue: idpKickerFallback,
        impactValue: Math.round(idpKickerFallback * 0.6),
        vorpValue: Math.round(idpKickerFallback * 0.3),
        volatility: vol,
      },
      source: 'unknown',
      position,
    };
  }

  if (analyticsData && analyticsData.draft.lifetimeValue != null && analyticsData.draft.lifetimeValue > 0) {
    const mv = Math.round(analyticsData.draft.lifetimeValue);
    const vol = computePlayerVolatility(null, analyticsData.position, age, analyticsData);
    return {
      name,
      type: 'player',
      value: mv,
      assetValue: { marketValue: mv, impactValue: Math.round(mv * 0.5), vorpValue: Math.round(mv * 0.25), volatility: vol },
      source: 'unknown',
      position: analyticsData.position || position,
    };
  }

  console.warn(`[hybrid-valuation] No value found for player: "${name}"`);
  return {
    name,
    type: 'player',
    value: 0,
    assetValue: { marketValue: 0, impactValue: 0, vorpValue: 0, volatility: 0.50 },
    source: 'unknown',
    position,
  };
}

export interface PickInput {
  year: number;
  round: number;
  tier?: 'early' | 'mid' | 'late' | null;
}

export async function pricePick(
  pick: PickInput,
  ctx: ValuationContext
): Promise<PricedAsset> {
  const historicalResult = getHistoricalPickValueWeighted(
    pick.year,
    pick.round,
    pick.tier || null,
    ctx.asOfDate,
    ctx.isSuperFlex
  );

  const asOfYear = new Date(ctx.asOfDate).getFullYear();
  const yearsOut = pick.year - asOfYear;

  if (historicalResult.value !== null) {
    const mv = historicalResult.value;
    const impact = computePickImpact(mv, pick.round);
    const vorp = computePickVorpEngine(impact, pick.round);
    const vol = computePickVolatility(yearsOut);
    return {
      name: historicalResult.pickKey,
      type: 'pick',
      value: mv,
      assetValue: { marketValue: mv, impactValue: impact, vorpValue: vorp, volatility: vol },
      source: 'excel',
      details: {
        year: pick.year,
        round: pick.round,
        tier: pick.tier || undefined,
        wasAveraged: historicalResult.wasAveraged
      }
    };
  }

  const curveValue = pickValue(pick.round, pick.year, asOfYear, null);
  const dynastyPoints = Math.round(curveValue * 80);

  const roundSuffix = pick.round === 1 ? '1st' : pick.round === 2 ? '2nd' : pick.round === 3 ? '3rd' : `${pick.round}th`;
  const mv = dynastyPoints;
  const impact = computePickImpact(mv, pick.round);
  const vorp = computePickVorpEngine(impact, pick.round);
  const vol = computePickVolatility(yearsOut);

  return {
    name: `${pick.year} ${roundSuffix}`,
    type: 'pick',
    value: mv,
    assetValue: { marketValue: mv, impactValue: impact, vorpValue: vorp, volatility: vol },
    source: 'curve',
    details: {
      year: pick.year,
      round: pick.round,
      tier: pick.tier || undefined
    }
  };
}

export interface AssetsInput {
  players: string[];
  picks: PickInput[];
}

export async function priceAssets(
  assets: AssetsInput,
  ctx: ValuationContext
): Promise<{
  total: number;
  compositeTotal: number;
  items: PricedAsset[];
  stats: {
    playersFromExcel: number;
    playersFromFantasyCalc: number;
    playersUnknown: number;
    picksFromExcel: number;
    picksFromCurve: number;
  };
}> {
  const fcPlayers = assets.players.length > 0
    ? await getFantasyCalcPlayers(ctx)
    : (ctx.fantasyCalcPlayers ?? []);

  const ctxWithFc: ValuationContext = { ...ctx, fantasyCalcPlayers: fcPlayers };

  const pricedPlayers = await Promise.all(
    assets.players.map(name => pricePlayer(name, ctxWithFc))
  );

  const pricedPicks = await Promise.all(
    assets.picks.map(pick => pricePick(pick, ctxWithFc))
  );

  const items = [...pricedPlayers, ...pricedPicks];
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const compTotal = compositeTotal(items);

  const stats = {
    playersFromExcel: pricedPlayers.filter(p => p.source === 'excel').length,
    playersFromFantasyCalc: pricedPlayers.filter(p => p.source === 'fantasycalc').length,
    playersUnknown: pricedPlayers.filter(p => p.source === 'unknown').length,
    picksFromExcel: pricedPicks.filter(p => p.source === 'excel').length,
    picksFromCurve: pricedPicks.filter(p => p.source === 'curve').length
  };

  return { total, compositeTotal: compTotal, items, stats };
}

function computeGrade(percentDiff: number): { verdict: string; grade: string } {
  if (percentDiff >= 40) return { verdict: 'Massive value win', grade: 'A+' };
  if (percentDiff >= 25) return { verdict: 'Strong win', grade: 'A' };
  if (percentDiff >= 10) return { verdict: 'Clear but modest win', grade: 'A-' };
  if (percentDiff >= -9) return { verdict: 'Fair / context-dependent', grade: 'B' };
  if (percentDiff >= -24) return { verdict: 'Slight overpay', grade: 'B-' };
  if (percentDiff >= -39) return { verdict: 'Clear loss', grade: 'C' };
  return { verdict: 'Major overpay', grade: 'D' };
}

function computeConfidence(stats: TradeDelta['valuationStats']): number {
  const totalPlayers = stats.playersFromExcel + stats.playersFromFantasyCalc + stats.playersUnknown;
  const totalPicks = stats.picksFromExcel + stats.picksFromCurve;
  const totalAssets = totalPlayers + totalPicks;

  if (totalAssets === 0) return 0.5;

  let confidence = 0.5;

  if (totalPlayers > 0) {
    const excelRatio = stats.playersFromExcel / totalPlayers;
    confidence += excelRatio * 0.25;
    
    if (stats.playersUnknown > 0) {
      confidence -= (stats.playersUnknown / totalPlayers) * 0.15;
    }
  }

  if (totalPicks > 0) {
    const excelPickRatio = stats.picksFromExcel / totalPicks;
    confidence += excelPickRatio * 0.10;
  }

  if (totalAssets <= 2) confidence -= 0.05;
  if (totalAssets >= 6) confidence += 0.05;

  return Math.max(0.15, Math.min(0.95, confidence));
}

export async function computeTradeDeltaFromUserTrades(
  trade: UserTrade,
  viewerUserId: string,
  ctx: ValuationContext,
  sleeperUserId?: string
): Promise<TradeDelta | null> {
  const viewerParty = trade.parties?.find(p => isUserParty(p, viewerUserId, sleeperUserId));
  const otherParty = trade.parties?.find(p => !isUserParty(p, viewerUserId, sleeperUserId));

  if (!viewerParty || !otherParty) return null;

  const parsePick = (pick: { round: number; season: string; slot?: string }): PickInput => ({
    year: parseInt(pick.season) || new Date().getFullYear(),
    round: pick.round,
    tier: (pick.slot === 'early' || pick.slot === 'mid' || pick.slot === 'late')
      ? pick.slot as 'early' | 'mid' | 'late'
      : null
  });

  const receivedAssets: AssetsInput = {
    players: viewerParty.playersReceived?.map(p => p.name) || [],
    picks: viewerParty.picksReceived?.map(parsePick) || []
  };

  const gaveAssets: AssetsInput = {
    players: otherParty.playersReceived?.map(p => p.name) || [],
    picks: otherParty.picksReceived?.map(parsePick) || []
  };

  const [received, gave] = await Promise.all([
    priceAssets(receivedAssets, ctx),
    priceAssets(gaveAssets, ctx)
  ]);

  const deltaValue = received.compositeTotal - gave.compositeTotal;
  const totalValue = received.compositeTotal + gave.compositeTotal;
  const percentDiff = totalValue > 0 ? (deltaValue / totalValue) * 100 : 0;

  const { verdict, grade } = computeGrade(percentDiff);

  const combinedStats = {
    playersFromExcel: received.stats.playersFromExcel + gave.stats.playersFromExcel,
    playersFromFantasyCalc: received.stats.playersFromFantasyCalc + gave.stats.playersFromFantasyCalc,
    playersUnknown: received.stats.playersUnknown + gave.stats.playersUnknown,
    picksFromExcel: received.stats.picksFromExcel + gave.stats.picksFromExcel,
    picksFromCurve: received.stats.picksFromCurve + gave.stats.picksFromCurve
  };

  return {
    userReceivedValue: received.compositeTotal,
    userGaveValue: gave.compositeTotal,
    deltaValue,
    percentDiff: Math.round(percentDiff * 10) / 10,
    verdict,
    grade,
    confidence: computeConfidence(combinedStats),
    receivedAssets: received.items,
    gaveAssets: gave.items,
    valuationStats: combinedStats
  };
}

export type ValuationMode = 'atTime' | 'hindsight';

export function createValuationContext(
  trade: { timestamp?: number },
  isSuperFlex: boolean,
  mode: ValuationMode = 'atTime'
): ValuationContext {
  const asOfDate = mode === 'hindsight'
    ? new Date().toISOString().slice(0, 10)
    : trade.timestamp
      ? new Date(trade.timestamp).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

  return { asOfDate, isSuperFlex };
}

export async function computeDualModeTradeDelta(
  trade: UserTrade,
  viewerUserId: string,
  isSuperFlex: boolean,
  sleeperUserId?: string,
  leagueContext?: Pick<ValuationContext, 'isDynasty' | 'numTeams' | 'ppr'>
): Promise<{
  atTheTime: TradeDelta | null;
  withHindsight: TradeDelta | null;
  comparison: string;
}> {
  const atTimeCtx = { ...createValuationContext(trade, isSuperFlex, 'atTime'), ...leagueContext };
  const hindsightCtx = { ...createValuationContext(trade, isSuperFlex, 'hindsight'), ...leagueContext };

  let fcPlayers: FantasyCalcPlayer[] = [];
  try {
    fcPlayers = await getFantasyCalcValuesDbFirst({
      isDynasty: leagueContext?.isDynasty ?? true,
      numQbs: isSuperFlex ? 2 : 1,
      numTeams: leagueContext?.numTeams ?? 12,
      ppr: leagueContext?.ppr ?? 1
    });
  } catch (e) {
    console.warn('FantasyCalc fetch failed:', e);
  }

  atTimeCtx.fantasyCalcPlayers = fcPlayers;
  hindsightCtx.fantasyCalcPlayers = fcPlayers;

  const [atTheTime, withHindsight] = await Promise.all([
    computeTradeDeltaFromUserTrades(trade, viewerUserId, atTimeCtx, sleeperUserId),
    computeTradeDeltaFromUserTrades(trade, viewerUserId, hindsightCtx, sleeperUserId)
  ]);

  let comparison = 'Unable to compare';
  if (atTheTime && withHindsight) {
    const diff = withHindsight.percentDiff - atTheTime.percentDiff;
    if (Math.abs(diff) < 5) {
      comparison = 'Trade grade remained consistent over time';
    } else if (diff > 0) {
      comparison = 'Trade has aged well - looks better now than it did then';
    } else {
      comparison = 'Trade looked better at the time than it does now';
    }
  }

  return { atTheTime, withHindsight, comparison };
}
