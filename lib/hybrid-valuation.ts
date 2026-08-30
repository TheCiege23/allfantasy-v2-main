import { getHistoricalPlayerValue, getHistoricalPickValueWeighted } from './historical-values';
import { findPlayerByName, FantasyCalcPlayer } from './fantasycalc';
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db';
import { pickValue } from './pick-valuation';
import { computePlayerVorp as computePlayerVorpEngine, computePickVorp as computePickVorpEngine, LeagueRosterConfig } from './vorp-engine';
import { IDP_CEILING_UNCERTAINTY_BAND, isIdpPosition, isKickerPosition } from './idp-kicker-values';
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
  /**
   * This league's own non-market values, keyed by lowercased player name — from
   * `loadLeagueTradeValues`. Covers DEFENDERS (ranked by value over replacement) and
   * KICKERS (deliberately unranked; every kicker in a league carries the same number,
   * because kicker rank does not persist — see lib/kicker-values/leagueKickerValue.ts).
   *
   * 🛑 OPTIONAL, AND ITS ABSENCE MUST STAY HARMLESS. Without it every defender is
   * priced off IDP_KICKER_BASELINE_VALUES below, which is a flat per-position
   * constant: every linebacker in the league worth 800, the best and the worst
   * alike. Supplying it replaces that with a value derived from the league's own
   * scoring settings and starting slots. Callers that have no league — a trade
   * described in chat, a snapshot write path — must NOT supply one, because an IDP
   * value computed against the wrong league is worse than a flat one.
   */
  leagueValueByNameLower?: ReadonlyMap<
    string,
    { value: number; position: string; basis: 'idp-vorp' | 'kicker-flat' }
  >;
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
  /**
   * Where the number came from — and, just as importantly, how much of a claim it is.
   *
   * `idp-vorp` and `kicker-flat` both mean the league's own rulebook priced this player
   * — see ValuationContext.leagueValueByNameLower. They are kept apart because they are
   * different claims: an IDP value is specific to that DEFENDER, while a kicker value is
   * specific to the LEAGUE and identical for every kicker in it.
   *
   * 🛑 `idp-flat-baseline` AND `analytics-lifetime` USED TO BE `unknown`, AND THAT MADE
   * THIS FIELD UNABLE TO ANSWER THE ONE QUESTION IT IS ASKED. Three branches returned
   * 'unknown': the IDP/kicker positional constant, the analytics lifetime-value fallback,
   * and the terminal branch where nothing matched at all. The first two return a real,
   * usable number; the third returns 0. Collapsing them meant nothing downstream could
   * distinguish "we priced this defender off a flat per-position constant where every
   * linebacker is worth 800" from "we could not price this name" — so no surface could
   * warn about the first, and no test could assert it had stopped happening.
   *
   * With the split, `unknown` means exactly one thing: nothing priced this asset.
   *
   * ⚠ THE SPLIT DOES NOT MEAN THE TWO NEW SOURCES ARE GOOD PRICES. `idp-flat-baseline` is
   * a POSITIONAL constant carrying no information about the individual, and a surface that
   * treats it as equivalent to a market price is making the error this field now exists to
   * prevent. Ask `isEvidencedPrice` rather than testing against 'unknown' by hand.
   */
  source:
    | 'excel'
    | 'fantasycalc'
    | 'curve'
    | 'idp-vorp'
    | 'kicker-flat'
    | 'idp-flat-baseline'
    | 'analytics-lifetime'
    | 'unknown';
  /**
   * TRUE MEANS NO VALUE SOURCE MATCHED THIS ASSET AT ALL — it is not "worth zero",
   * it is unknown, and the two must never be collapsed.
   *
   * The terminal branch of pricePlayer returns `value: 0` for a name nothing could
   * price. Downstream that zero was arithmetic like any other, so a misspelling or
   * an unlisted player silently became a worthless asset and the trade was graded
   * anyway — a 0-for-something trade grades as a lopsided A+/D with total
   * confidence and no data behind it.
   *
   * ⚠ `source === 'unknown'` NOW IMPLIES THIS FLAG, but the flag is still the thing to
   * test. It is set on the terminal branch only and says what it means directly, where
   * the source string is one widening away from meaning something else again.
   */
  unpriced?: true;
  position?: string;
  age?: number;
  details?: {
    year?: number;
    round?: number;
    tier?: string;
    wasAveraged?: boolean;
  };
}

/**
 * Sources that price an asset by STANDING IN for evidence rather than carrying any.
 *
 * `idp-flat-baseline` is a hand-set per-position ladder — every linebacker 800, every
 * defensive back 650 — with nothing behind it and no measurement it can point to. It fires
 * only when the league's own board was unavailable.
 *
 * `analytics-lifetime` reuses a player's draft lifetime value because no board carried him.
 * It is about the right player, which is why it beats refusing, but it is not a trade price.
 *
 * `unknown` is the terminal branch: nothing matched, and the accompanying value is 0.
 */
const FALLBACK_SOURCES: ReadonlySet<PricedAsset['source']> = new Set([
  'idp-flat-baseline',
  'analytics-lifetime',
  'unknown',
]);

/**
 * Does this price rest on evidence about this specific asset?
 *
 * 🛑 ASK THIS INSTEAD OF TESTING `source !== 'unknown'` BY HAND. That test used to answer this
 * question correctly — by accident, because the two fallback branches also reported 'unknown'.
 * Splitting them apart broke the accident, and every call site that kept the old test would
 * have silently started counting a flat positional constant as a real price. In the trade
 * evaluator that fed `calculateTradeConfidence`, so an IDP trade priced entirely off the
 * baseline would have gained up to 0.25 confidence on the strength of the constant 800.
 *
 * ⚠ `kicker-flat` COUNTS AS EVIDENCED AND `idp-flat-baseline` DOES NOT, THOUGH BOTH ARE ONE
 * NUMBER SHARED BY MANY PLAYERS. The distinction is not how the number varies, it is whether
 * anything measured it. A kicker's value is constant because seven seasons of data say rank
 * does not persist and the startable position spans 1.55x — the flatness IS the finding (see
 * lib/kicker-values/leagueKickerValue.ts). The IDP baseline is constant because nobody had
 * got round to it.
 */
export function isEvidencedPrice(asset: Pick<PricedAsset, 'source'>): boolean {
  return !FALLBACK_SOURCES.has(asset.source);
}

/**
 * How many players in a trade were priced by nothing that measured them.
 *
 * 🛑 EXTRACTED SO IT CAN BE TESTED, AND IT WAS EXTRACTED BECAUSE A MUTATION GOT THROUGH.
 * `computeConfidence` inlined `stats.playersFromFallback + stats.playersUnknown`. Deleting
 * the first term — the exact regression the source split created the opportunity for, since
 * `playersUnknown` alone reads like the obvious quantity — passed the entire suite: the tests
 * checked that the STATS were counted apart, never that confidence still added them back.
 *
 * The sum is the invariant. Before the split it was the single `playersUnknown` count, and
 * confidence must keep penalising exactly that population, or making the pricing more legible
 * would silently make the product more confident about its worst-priced trades.
 */
export function unevidencedPlayerCount(
  stats: Pick<TradeDelta['valuationStats'], 'playersFromFallback' | 'playersUnknown'>,
): number {
  return stats.playersFromFallback + stats.playersUnknown;
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
    /** Priced off the league's own IDP board. See ValuationContext.leagueValueByNameLower. */
    playersFromIdpVorp: number;
    /** Priced at the league's flat kicker value — one number for every kicker, by design. */
    playersFromKickerFlat: number;
    /**
     * Priced by a FALLBACK that carries no evidence about this player — the flat IDP
     * positional constant, or his draft lifetime value. A real, usable number, but not a
     * price anything measured, and a surface that shows one without saying so overstates
     * what it knows. Counted apart from `playersUnknown` since the split; the two were one
     * number while all three fallback branches reported `source: 'unknown'`.
     */
    playersFromFallback: number;
    /** Nothing priced this player at all. The value is 0 and means unknown, not worthless. */
    playersUnknown: number;
    picksFromExcel: number;
    picksFromCurve: number;
  };
  /**
   * What this grade would read at the edges of the IDP ceiling's uncertainty — null when the
   * trade holds no IDP-priced asset, and so does not depend on it. See idpCeilingGradeBand.
   */
  idpCeilingBand?: { low: string; high: string; sensitive: boolean } | null;
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

/**
 * How old a historical snapshot may be and still stand in for a player the LIVE
 * board does not carry.
 *
 * ⚠ THIS BOUND IS DELIBERATELY GENEROUS, AND A TIGHT ONE IS A BUG. The fix above
 * stops the stale board OUTRANKING the live one; it does not follow that a stale
 * price is worthless. This branch is only reached when FantasyCalc has no entry at
 * all, and measured against the live board 101 players — 30% of the Excel board,
 * AJ Dillon, Brandin Cooks, Alexander Mattison and other fringe veterans — exist
 * only in the historical file. A short window there would refuse to grade any trade
 * containing one of them, which is strictly worse for the user than an old price
 * carried with lowered confidence (see computeConfidence, which now subtracts for it).
 *
 * The bound exists only so that a file left un-regenerated for YEARS eventually
 * stops pricing silently. A full season plus an offseason is the right scale.
 */
const HISTORICAL_FALLBACK_MAX_AGE_DAYS = 400;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Is the caller asking what something was worth in the PAST?
 *
 * Callers default `asOfDate` to today (app/api/trade-evaluator/route.ts does), so
 * "an asOfDate was supplied" cannot distinguish a backtest from a live grade. Only a
 * date strictly before today can. ISO dates compare correctly as strings.
 */
function isHindsightQuery(asOfDate: string | null | undefined): boolean {
  if (!asOfDate) return false;
  const d = String(asOfDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d < todayIso();
}

function historicalSnapshotIsRecent(
  result: { actualDate: string | null },
  maxAgeDays: number = HISTORICAL_FALLBACK_MAX_AGE_DAYS
): boolean {
  if (!result.actualDate) return false;
  const t = Date.parse(`${result.actualDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) / 86_400_000 <= maxAgeDays;
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

  /*
   * 🛑 ORDER MATTERS, AND IT USED TO BE BACKWARDS.
   *
   * The historical (Excel) board was consulted FIRST and returned before the live
   * FantasyCalc board was ever looked at. `getHistoricalPlayerValue` resolves to the
   * newest snapshot on or before `asOfDate`, and callers pass TODAY — so every
   * veteran was priced from the newest snapshot in data/historical-values, which is
   * 2026-02-05. Measured on the day this was fixed that was 205 days stale, and it
   * was beating a FantasyCalc board written hours earlier. An entire offseason of
   * free agency, trades, retirements and camp news was invisible to every trade grade.
   *
   * The historical board is for HINDSIGHT — replaying what an asset was worth on a
   * past date. So it is consulted first only when the caller actually asked about the
   * past, and otherwise serves as a bounded-age fallback for players the live board
   * does not carry.
   */
  const hindsight = isHindsightQuery(ctx.asOfDate);
  const historicalResult = getHistoricalPlayerValue(name, ctx.asOfDate, ctx.isSuperFlex);
  const priceFromHistorical = (): PricedAsset => {
    const mv = historicalResult.value as number;
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
  };

  if (hindsight && historicalResult.value !== null) {
    return priceFromHistorical();
  }

  /*
   * This league's own IDP board, when the caller supplied one.
   *
   * ⚠ AHEAD OF THE FANTASYCALC BRANCH ON PURPOSE, THOUGH TODAY THEY CANNOT COLLIDE.
   * FantasyCalc prices no defenders — `PlayerValueSnapshot` carries 7,043 rows and
   * zero of them — and the map only ever contains players the board resolved as IDP,
   * so neither branch can currently steal the other's players. The order states which
   * should win if that changes: inside a league that genuinely scores IDP, a value
   * derived from that league's own scoring and starting slots beats a generic
   * cross-league market number, which is the whole reason the board exists.
   *
   * ⚠ NOT APPLIED TO A HINDSIGHT QUERY. The board is built from the CURRENT
   * projection week; answering "what was he worth last March" with it would quietly
   * restate today's price as history.
   */
  const leagueValue = ctx.leagueValueByNameLower?.get(name.toLowerCase().trim());
  if (leagueValue && leagueValue.value > 0) {
    const mv = leagueValue.value;
    const vol = computePlayerVolatility(null, leagueValue.position, age, analyticsData);
    return {
      name,
      type: 'player',
      value: mv,
      assetValue: {
        marketValue: mv,
        impactValue: Math.round(mv * 0.6),
        vorpValue: Math.round(mv * 0.3),
        volatility: vol,
      },
      source: leagueValue.basis,
      position: leagueValue.position,
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

  /*
   * The live board does not carry this player — 30% of the historical board's names
   * are in exactly that position. Use the older price rather than refusing: it is the
   * only number available, the ordering bug it used to cause is fixed above, and
   * computeConfidence now subtracts for it instead of adding. Bounded only against a
   * file left un-regenerated for years.
   */
  if (historicalResult.value !== null && historicalSnapshotIsRecent(historicalResult)) {
    return priceFromHistorical();
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
      source: 'idp-flat-baseline',
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
      source: 'analytics-lifetime',
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
    // See PricedAsset.unpriced. The zero below is a placeholder so the shape stays
    // uniform; it is NOT a price, and any surface that grades must check this first.
    unpriced: true,
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
    /** Priced off the league's own IDP board. See ValuationContext.leagueValueByNameLower. */
    playersFromIdpVorp: number;
    /** Priced at the league's flat kicker value — one number for every kicker, by design. */
    playersFromKickerFlat: number;
    /**
     * Priced by a FALLBACK that carries no evidence about this player — the flat IDP
     * positional constant, or his draft lifetime value. A real, usable number, but not a
     * price anything measured, and a surface that shows one without saying so overstates
     * what it knows. Counted apart from `playersUnknown` since the split; the two were one
     * number while all three fallback branches reported `source: 'unknown'`.
     */
    playersFromFallback: number;
    /** Nothing priced this player at all. The value is 0 and means unknown, not worthless. */
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
    playersFromIdpVorp: pricedPlayers.filter(p => p.source === 'idp-vorp').length,
    playersFromKickerFlat: pricedPlayers.filter(p => p.source === 'kicker-flat').length,
    playersFromFallback: pricedPlayers.filter(p => p.source === 'idp-flat-baseline' || p.source === 'analytics-lifetime').length,
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

/**
 * Would this verdict survive the one number in the IDP stack nobody can measure?
 *
 * 🛑 THE GRADE ON A DEFENCE-FOR-OFFENCE TRADE IS PARTLY A RESTATEMENT OF A PRODUCT DECISION.
 * `IDP_CEILING_DYNASTY` sets what the best defender in a league is worth against the offensive
 * board, and it is explicitly unmeasured — see the comment on it. Replaying real production
 * trades across a range of ceilings moved one of them five grades, D to A-. That is not a
 * rounding difference; it is the difference between "major overpay" and "clear win" on the
 * same two rosters, decided by a constant with no market behind it.
 *
 * Returning null is the common and correct case: a trade with no IDP-priced asset does not
 * depend on the ceiling at all, and neither does one whose two sides are both defenders —
 * `percentDiff` is (r-g)/(r+g), so a factor common to both sides cancels exactly. Only the
 * asymmetric case is exposed, which is why this reports per-trade rather than as a banner.
 *
 * ⚠ SCALES THE ALREADY-PRICED ASSETS RATHER THAN RE-PRICING. `pricePlayer` derives an IDP
 * asset's impact and vorp as fixed multiples of its board value, and `compositeScore` is
 * linear in those, so scaling them is exactly equivalent to moving the ceiling — and it costs
 * no further provider or database work at grade time.
 */
export interface IdpCeilingBandTotals {
  /** Side totals with the ceiling at the bottom of its band. */
  low: { received: number; gave: number };
  /** Side totals with the ceiling at the top of its band. */
  high: { received: number; gave: number };
}

/**
 * ⚠ RETURNS TOTALS, NOT A VERDICT, BECAUSE THE TWO TRADE SURFACES SPEAK DIFFERENT LANGUAGES.
 * `computeTradeDeltaFromUserTrades` reports a letter grade; `/api/trade-evaluator` reports a
 * 0-100 fairness score off `computeValueFairness`. Returning a grade here would have quietly
 * given the evaluator a second, disagreeing currency on the same screen.
 *
 * `extra` is for value that is part of a side but not a priced asset — FAAB, which the
 * evaluator adds to each composite. It is constant in the ceiling, so leaving it out would
 * overstate how much of a side the ceiling actually moves.
 */
export function idpCeilingCompositeBand(
  received: PricedAsset[],
  gave: PricedAsset[],
  extra?: { received?: number; gave?: number }
): IdpCeilingBandTotals | null {
  const isIdp = (a: PricedAsset) => a.source === 'idp-vorp';
  if (!received.some(isIdp) && !gave.some(isIdp)) return null;

  const totalAt = (assets: PricedAsset[], k: number, offset: number) =>
    assets.reduce(
      (sum, a) =>
        sum +
        compositeScore(
          isIdp(a)
            ? {
                ...a.assetValue,
                impactValue: a.assetValue.impactValue * k,
                vorpValue: a.assetValue.vorpValue * k,
              }
            : a.assetValue
        ),
      0
    ) + offset;

  const at = (k: number) => ({
    received: totalAt(received, k, extra?.received ?? 0),
    gave: totalAt(gave, k, extra?.gave ?? 0),
  });

  return { low: at(IDP_CEILING_UNCERTAINTY_BAND.low), high: at(IDP_CEILING_UNCERTAINTY_BAND.high) };
}

/** The band expressed as letter grades, for the surfaces that report one. */
export function idpCeilingGradeBand(
  received: PricedAsset[],
  gave: PricedAsset[]
): { low: string; high: string; sensitive: boolean } | null {
  const band = idpCeilingCompositeBand(received, gave);
  if (!band) return null;

  const gradeOf = (side: { received: number; gave: number }) => {
    const total = side.received + side.gave;
    return computeGrade(total > 0 ? ((side.received - side.gave) / total) * 100 : 0).grade;
  };

  const low = gradeOf(band.low);
  const high = gradeOf(band.high);
  return { low, high, sensitive: low !== high };
}

function computeConfidence(stats: TradeDelta['valuationStats']): number {
  /*
   * ⚠ IDP-PRICED PLAYERS COUNT, AND THEY COUNT AS NEITHER LIVE NOR UNKNOWN.
   *
   * Leaving them out of `totalPlayers` would make an all-defence trade divide by
   * zero into a flat 0.5; counting them as `playersUnknown` would penalise the one
   * branch that actually knows something about the player. They get no boost either:
   * the board's ORDER is derived from the league's own scoring, but the ceiling that
   * sets defence against offence is an unmeasured product decision, so a defender's
   * price is not market-corroborated the way a FantasyCalc price is. Neutral is the
   * honest reading — present in the denominator, absent from both adjustments.
   */
  const totalPlayers =
    stats.playersFromExcel +
    stats.playersFromFantasyCalc +
    stats.playersFromIdpVorp +
    stats.playersFromKickerFlat +
    unevidencedPlayerCount(stats);
  const totalPicks = stats.picksFromExcel + stats.picksFromCurve;
  const totalAssets = totalPlayers + totalPicks;

  if (totalAssets === 0) return 0.5;

  let confidence = 0.5;

  /*
   * ⚠ THIS USED TO SCORE CONFIDENCE HIGHEST EXACTLY WHERE PRICING WAS STALEST.
   *
   * It read `confidence += excelRatio * 0.25` — the larger the share of a trade
   * priced off the historical spreadsheet, the more certain the product claimed to
   * be. That was defensible when the Excel board was the curated, hand-checked
   * source and FantasyCalc was the scraped fallback. It stopped being true when the
   * board stopped being updated: its newest snapshot is 2026-02-05, so the boost was
   * rewarding a six-month-old number over one written hours ago.
   *
   * Now the live market board is the confident source, and an Excel price — which
   * after the reordering in pricePlayer only appears as a bounded-age fallback for a
   * player the live board does not carry — slightly lowers confidence instead.
   */
  if (totalPlayers > 0) {
    const liveRatio = stats.playersFromFantasyCalc / totalPlayers;
    confidence += liveRatio * 0.25;

    const excelRatio = stats.playersFromExcel / totalPlayers;
    confidence -= excelRatio * 0.10;

    /*
     * ⚠ FALLBACK-PRICED PLAYERS ARE PENALISED EXACTLY AS UNPRICED ONES ARE, AND THE SPLIT
     * DELIBERATELY DID NOT CHANGE THAT NUMBER. Before it, the flat IDP constant and the
     * analytics lifetime value both reported `source: 'unknown'` and so landed in this
     * penalty by accident. Reading only `playersUnknown` here afterwards would have QUIETLY
     * RAISED confidence on exactly the trades priced worst — an all-defence trade in a
     * league with no board would have gone from a 0.15 penalty to none, because the pricing
     * got more legible rather than more certain.
     */
    const unevidenced = unevidencedPlayerCount(stats);
    if (unevidenced > 0) {
      confidence -= (unevidenced / totalPlayers) * 0.15;
    }
  }

  /*
   * Picks keep a modest boost for the historical board: their alternative is a
   * static curve, not a live market, so a real observed pick price is still the
   * better of the two available inputs.
   */
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
    playersFromIdpVorp: received.stats.playersFromIdpVorp + gave.stats.playersFromIdpVorp,
    playersFromKickerFlat: received.stats.playersFromKickerFlat + gave.stats.playersFromKickerFlat,
    playersFromFallback: received.stats.playersFromFallback + gave.stats.playersFromFallback,
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
    valuationStats: combinedStats,
    idpCeilingBand: idpCeilingGradeBand(received.items, gave.items)
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
