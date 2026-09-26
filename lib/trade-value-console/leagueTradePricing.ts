import 'server-only'

import type { SportsPlayerRecord } from '@prisma/client'
import { getPlayer, searchPlayers } from '@/lib/data/players'
import { resolvePlayer } from '@/lib/shared-services/player-identity/PlayerIdentityResolver'
import { findPlayerByName, type FantasyCalcPlayer } from '@/lib/fantasycalc'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { pricePlayer, pricePick, compositeScore, type ValuationContext, type PricedAsset } from '@/lib/hybrid-valuation'
import type { SupportedSport } from '@/lib/sport-scope'
import { prisma } from '@/lib/prisma'
import { loadLeagueTradeValues } from '@/lib/league-values/leagueTradeValues'
import type { NormalizedLeagueContext } from '@/lib/league-context-engine/types'
import { normalizedFaabValue } from '@/lib/trade-value/faabValue'
import { analysisUnpricedReason } from '@/lib/trade-value/unpricedReason'
import { marketContextFor } from '@/lib/trade-intel/marketContext'
import type { LoadedTradeLeague } from './league-loader'
import { sportsRecordToPricedAsset } from './sports-db-valuation'
import type { TradeAssetInput, TradeConsoleLeagueSnapshot, TradeConsolePlayerLine } from './types'

/**
 * How a trade is PRICED for one league — the chart it is priced on and the pricer that reads it.
 *
 * 🛑 MOVED OUT OF `runTradeConsoleAnalysis.ts` (2026-09-24) SO THERE IS ONE OF IT. The Trade Center
 * priced deals here and nowhere else could; every other surface (pending-offer cards, the /core
 * Trades list, Chimmy) ran its own pricer on its own chart and printed its own letter. Now the
 * console and `lib/decision-os/trade/leagueTradeGrader.ts` both call these functions, so a deal priced on
 * any surface is priced by the same code on the same chart. The function bodies are unchanged; only
 * `resolveAssets` gained `resolveEnrichmentIds`, which the grader turns off (the Decision OS shadow
 * id is a console concern and costs a resolver call per player).
 *
 * ⚠ THE CHART AND THE PRICER STAY IN ONE FILE ON PURPOSE. `__tests__/values/leagueValueWiring.test.ts`
 * requires every surface that prices players for a league to also load that league's IDP/kicker
 * board, and checks it per file. Splitting them would satisfy neither half of that guard.
 */

function priceFaabAsset(amount: number, budget: number): PricedAsset {
  /*
   * 🛑 WAS `round(clamp(amount / budget, 0, 1) * 2800)` — this console's OWN conversion, and
   * the last of the three the app used to carry. Measured 2026-09-11, $10 of FAAB out of a
   * $100 budget priced as 10 in /api/trade-evaluator, 280 here, and 180 in the canonical
   * engine: a 28x spread on one asset, across three surfaces feeding the same 0–10000 scale.
   *
   * The other two now route through `normalizedFaabValue`; this closes it. The SHAPE is
   * unchanged — it was already budget-relative, which is the part this file had right — so
   * only the constant moves: a full budget prices at 1800 rather than 2800, matching what the
   * canonical engine has always paid for FAAB at the default $100 budget.
   *
   * ⚠ THAT IS A REAL GRADE CHANGE ON THIS SURFACE, and deliberately so. A console trade
   * carrying a full budget loses ~1000 points of one side's total; one carrying $25 of a $100
   * budget goes from 700 to 450. Nothing else in the trade moves. The alternative — keeping
   * 2800 here and raising the other two — would have re-priced every canonical snapshot ever
   * written, which is evidence, not a display value.
   */
  const mv = normalizedFaabValue(amount, budget)
  return {
    name: `FAAB $${amount}`,
    type: 'player',
    value: mv,
    assetValue: {
      marketValue: mv,
      impactValue: Math.round(mv * 0.55),
      vorpValue: Math.round(mv * 0.2),
      volatility: 0.12,
    },
    source: 'unknown',
    position: 'FAAB',
  }
}

/**
 * The SLEEPER provider id for a player, or null — the key the trade enrichment tables use.
 *
 * 🛑 WHY THIS EXISTS AT ALL. `analyze/route.ts` builds `enrichIds` from the console's player id and
 * hands them to `resolveTradeEnrichment`; with no usable key the canonical engine is fed the
 * console's own numbers and `independentInputs` is false. Measured on production 2026-09-08: all
 * nine trade parity rows ever recorded sit in the `console` bucket and ZERO in
 * `console_independent` — the two-engine comparison the shadow exists to run has never happened.
 *
 * The cause was NOT a missing lookup, which is what it looked like. `SportsPlayerRecord.id` (what
 * the console carries), `SportsPlayer.id` and `canonicalPlayerId` were each tested against
 * `resolveTradeEnrichment` and none of them resolve anything; `providerIds.sleeper` returns
 * `adp 2.8` for the same player, and `PlayerValueSnapshot.sleeperId` matches it. The console simply
 * carries a different id space from the one the enrichment port reads.
 *
 * ⚠ AMBIGUOUS IS REFUSED, NOT GUESSED. This repo carries 178 NFL duplicate-name groups it must not
 * merge, and `consoleShadowCompare` already declines `name_match_ambiguous` for exactly this reason
 * — a wrong id here would price one player's trade with another's market value and never surface as
 * an error. `searchPlayers(name)[0]`, which the non-NFL branch uses for its own purposes, is
 * first-hit-wins and is deliberately NOT reused here.
 *
 * ⚠ NEVER THROWS. A resolver failure returns null and the caller behaves exactly as it did before
 * this function existed.
 */
async function resolveEnrichmentPlayerId(
  nameHint: string,
  sport: string,
  positionHint?: string | null,
): Promise<string | null> {
  if (!nameHint.trim()) return null
  try {
    const res = await resolvePlayer({
      provider: 'sleeper',
      nameHint,
      positionHint: positionHint ?? null,
      sport,
    })
    if (res.confidence !== 'direct' && res.confidence !== 'name_match_confident') return null
    return res.player?.providerIds?.sleeper ?? null
  } catch {
    return null
  }
}

/**
 * One priced asset as a console line. Exported for its test only.
 *
 * `pa.unpriced` is the pricer's own "found nothing" flag, and its marketValue is then a placeholder
 * 0; the line carries the flag and the reason so no surface prints that 0 as a price.
 * `reasonPosition` is the player ROW's position when there is one — an unmatched player's
 * `pa.position` is the literal 'UNKNOWN', which would hide that he is, say, a team defense.
 */
export function lineFromPriced(
  pa: PricedAsset,
  meta: Partial<TradeConsolePlayerLine>,
  opts?: { reasonPosition?: string | null },
): TradeConsolePlayerLine {
  return {
    name: pa.name,
    playerId: meta.playerId ?? null,
    enrichmentPlayerId: meta.enrichmentPlayerId ?? null,
    sport: meta.sport ?? 'NFL',
    position: pa.position ?? meta.position ?? '—',
    team: meta.team ?? '—',
    headshotUrl: meta.headshotUrl ?? null,
    logoUrl: meta.logoUrl ?? null,
    injuryStatus: meta.injuryStatus ?? null,
    dataSource: meta.dataSource ?? 'deterministic',
    composite: compositeScore(pa.assetValue),
    marketValue: pa.assetValue.marketValue,
    pricedSource: meta.pricedSource ?? 'unknown',
    ...(pa.unpriced
      ? {
          unpriced: true,
          unpricedReason: analysisUnpricedReason({
            position: opts?.reasonPosition ?? pa.position ?? meta.position,
            sport: meta.sport ?? 'NFL',
          }),
        }
      : {}),
  }
}

/*
 * ── Draft picks on the LIVE chart ────────────────────────────────────────────────────────────────
 *
 * 🛑 `pricePick` READS THE HISTORICAL PICK FILE FIRST, AND ITS NEWEST SNAPSHOT IS 2026-02-05. There
 * is no recency guard, so every pick in every graded deal was priced off a board months older than
 * the players beside it — an offseason of rookie hype and draft-order changes invisible to the
 * grade (trade audit, 2026-09-24). The player half of `pricePlayer` was fixed for exactly this; the
 * pick half never was.
 *
 * FantasyCalc's DYNASTY chart carries picks as rows of their own ("2026 Pick 1.01", "2027 Round 2",
 * "2027 1st"), and the chart this module already fetched for the players is that chart. So a pick
 * is priced from it when it is there: the round average for that season, the slots of its third of
 * the round when the tier is known — the rule `marketValueService.pickValue` uses. A redraft chart
 * has no pick rows, and then the old pricer answers as before.
 */
function parseChartPickName(name: string): { season: number; round: number; slot: number | null } | null {
  const exact = name.match(/^(\d{4})\s+Pick\s+(\d+)\.(\d+)$/i)
  if (exact) return { season: Number(exact[1]), round: Number(exact[2]), slot: Number(exact[3]) }
  const roundWord = name.match(/^(\d{4})\s+(?:Round\s+(\d+)|(\d)(?:st|nd|rd|th))$/i)
  if (roundWord) {
    const round = Number(roundWord[2] ?? roundWord[3])
    return Number.isFinite(round) ? { season: Number(roundWord[1]), round, slot: null } : null
  }
  return null
}

/**
 * The live chart's price for a pick — the chart's own row, or, for a round PAST the last one the
 * chart prices, a decay from that last round. Null when the chart carries nothing for the season.
 *
 * 🛑 ROUNDS 5+ WERE INVENTED, AND OUT OF ORDER (field test, 2026-09-25). FantasyCalc's chart stops
 * at round 4, so a 5th-or-later fell through to the historical file or the generic curve — sources
 * that disagree with the chart and with each other — and a 2027 8th priced 560 against a 5th at 515.
 * A later round is worth less than an earlier one by construction, so it is priced FROM the chart's
 * last round, shrinking each round by the ratio the chart itself shows between its last two rounds
 * (clamped below 1, so the order can never invert). The ratio is read off the chart, not a constant
 * calibrated somewhere else.
 */
export function livePickValue(
  fcPlayers: ReadonlyArray<Pick<FantasyCalcPlayer, 'player' | 'value'>>,
  year: number,
  round: number,
  tier: 'early' | 'mid' | 'late' | null,
): number | null {
  const exact = chartRoundValue(fcPlayers, year, round, tier)
  if (exact != null) return exact
  return extrapolatedLateRound(fcPlayers, year, round, tier)
}

/** The rounds the chart prices for one season, highest first. */
function chartRounds(fcPlayers: ReadonlyArray<Pick<FantasyCalcPlayer, 'player' | 'value'>>, year: number): number[] {
  const rounds = new Set<number>()
  for (const r of fcPlayers) {
    if (r.player?.position?.toUpperCase() !== 'PICK' || typeof r.value !== 'number') continue
    const parsed = parseChartPickName(r.player.name ?? '')
    if (parsed && parsed.season === year) rounds.add(parsed.round)
  }
  return [...rounds].sort((a, b) => b - a)
}

/*
 * Bounds on the per-round shrink. The ceiling keeps every later round strictly below the one before
 * it; the floor is also the shrink used when the chart prices only ONE round of a season, so there
 * is no observed ratio to read.
 */
const LATE_ROUND_RATIO_FLOOR = 0.25
const LATE_ROUND_RATIO_CEILING = 0.85

function extrapolatedLateRound(
  fcPlayers: ReadonlyArray<Pick<FantasyCalcPlayer, 'player' | 'value'>>,
  year: number,
  round: number,
  tier: 'early' | 'mid' | 'late' | null,
): number | null {
  const rounds = chartRounds(fcPlayers, year)
  const last = rounds[0]
  // Only PAST the chart's last round: a gap below it is a chart hole, not a late round.
  if (last == null || round <= last) return null
  const lastValue = chartRoundValue(fcPlayers, year, last, tier)
  if (lastValue == null || lastValue <= 0) return null
  const prev = rounds[1]
  const lastAvg = chartRoundValue(fcPlayers, year, last, null)
  const prevAvg = prev != null ? chartRoundValue(fcPlayers, year, prev, null) : null
  const observed = lastAvg != null && prevAvg != null && prevAvg > 0 ? (lastAvg / prevAvg) ** (1 / (last - prev!)) : null
  const ratio = Math.min(LATE_ROUND_RATIO_CEILING, Math.max(LATE_ROUND_RATIO_FLOOR, observed ?? LATE_ROUND_RATIO_FLOOR))
  return Math.max(1, Math.round(lastValue * ratio ** (round - last)))
}

/** The chart's own price for exactly this season and round, or null when it carries no such row. */
function chartRoundValue(
  fcPlayers: ReadonlyArray<Pick<FantasyCalcPlayer, 'player' | 'value'>>,
  year: number,
  round: number,
  tier: 'early' | 'mid' | 'late' | null,
): number | null {
  const all: number[] = []
  const bySlot: Array<{ slot: number; value: number }> = []
  for (const r of fcPlayers) {
    if (r.player?.position?.toUpperCase() !== 'PICK' || typeof r.value !== 'number') continue
    const parsed = parseChartPickName(r.player.name ?? '')
    if (!parsed || parsed.season !== year || parsed.round !== round) continue
    all.push(r.value)
    if (parsed.slot != null) bySlot.push({ slot: parsed.slot, value: r.value })
  }
  if (tier && bySlot.length >= 3) {
    const slots = [...bySlot].sort((a, b) => a.slot - b.slot)
    const third = Math.ceil(slots.length / 3)
    const band = tier === 'early' ? slots.slice(0, third) : tier === 'mid' ? slots.slice(third, 2 * third) : slots.slice(2 * third)
    if (band.length > 0) return Math.round(band.reduce((s, b) => s + b.value, 0) / band.length)
  }
  if (all.length === 0) return null
  return Math.round(all.reduce((s, v) => s + v, 0) / all.length)
}

/**
 * The same priced asset at a different market value. Impact and VORP scale with it so the driver
 * model's secondary numbers stay proportionate; volatility is about the years out, not the price.
 */
function repricedAsset(p: PricedAsset, marketValue: number, source: PricedAsset['source']): PricedAsset {
  const ratio = p.assetValue.marketValue > 0 ? marketValue / p.assetValue.marketValue : 1
  return {
    ...p,
    value: marketValue,
    source,
    assetValue: {
      ...p.assetValue,
      marketValue,
      impactValue: Math.round(p.assetValue.impactValue * ratio),
      vorpValue: Math.round(p.assetValue.vorpValue * ratio),
    },
  }
}

export async function resolveAssets(
  items: TradeAssetInput[],
  args: {
    effectiveSport: SupportedSport
    nflCtx: ValuationContext
    waiverBudget: number
    dataGaps: string[]
    fcPlayers: FantasyCalcPlayer[]
    /** Resolve the Decision OS enrichment id per player. Default true; the grader turns it off. */
    resolveEnrichmentIds?: boolean
  },
): Promise<{ priced: PricedAsset[]; lines: TradeConsolePlayerLine[]; unresolved: string[] }> {
  const priced: PricedAsset[] = []
  const lines: TradeConsolePlayerLine[] = []
  const unresolved: string[] = []

  for (const raw of items) {
    if (raw.kind === 'pick') {
      const curve = await pricePick(
        { year: raw.year, round: raw.round, tier: raw.tier ?? null },
        args.nflCtx,
      )
      const live = livePickValue(args.fcPlayers, raw.year, raw.round, raw.tier ?? null)
      const p = live != null ? repricedAsset(curve, live, 'fantasycalc') : curve
      priced.push(p)
      lines.push(
        lineFromPriced(p, {
          sport: args.effectiveSport,
          position: 'PICK',
          team: `${raw.year}`,
          pricedSource: 'pick',
          playerId: null,
          dataSource: live != null ? 'fantasycalc_pick' : 'historical_pick_curve',
        }),
      )
      continue
    }

    if (raw.kind === 'faab') {
      const p = priceFaabAsset(raw.amount, args.waiverBudget)
      priced.push(p)
      lines.push(
        lineFromPriced(p, {
          sport: args.effectiveSport,
          position: 'FAAB',
          team: '—',
          pricedSource: 'faab',
          playerId: null,
          dataSource: 'league_waiver_budget',
        }),
      )
      continue
    }

    let row: SportsPlayerRecord | null = null
    let displayName = raw.name?.trim() ?? ''

    if (raw.playerId?.trim()) {
      row = (await getPlayer(raw.playerId.trim(), { sport: args.effectiveSport })) as SportsPlayerRecord | null
      if (row) displayName = row.name
    }

    if (args.effectiveSport === 'NFL') {
      if (!displayName && row) displayName = row.name
      if (!displayName) {
        args.dataGaps.push('Unnamed NFL player — skipped')
        continue
      }
      const matched = findPlayerByName(args.fcPlayers, displayName)
      const pa = await pricePlayer(displayName, args.nflCtx)
      if (!matched && row && pa.source !== 'idp-vorp' && pa.source !== 'kicker-flat') {
        args.dataGaps.push(`No market-feed match for "${displayName}"; ${pa.unpriced ? 'no value available' : 'using fallback pricing'}.`)
      }
      priced.push(pa)
      const headshot = row?.headshotUrl ?? row?.headshotUrlLg ?? row?.headshotUrlSm ?? null
      const src: TradeConsolePlayerLine['pricedSource'] =
        pa.source === 'fantasycalc' || pa.source === 'excel'
          ? 'fantasycalc'
          : pa.source === 'idp-vorp' || pa.source === 'kicker-flat'
            ? 'idp_league'
            : 'unknown'
      lines.push(
        lineFromPriced(pa, {
          playerId: row?.id ?? raw.playerId ?? null,
          enrichmentPlayerId:
            args.resolveEnrichmentIds === false
              ? null
              : await resolveEnrichmentPlayerId(displayName, 'NFL', pa.position ?? row?.position ?? null),
          sport: 'NFL',
          team: row?.team ?? matched?.player.maybeTeam ?? '—',
          headshotUrl: headshot,
          logoUrl: row?.logoUrl ?? null,
          injuryStatus: row?.injuryStatus ?? null,
          pricedSource: src,
          dataSource: row?.dataSource ?? 'fantasycalc+rolling',
          position: pa.position ?? row?.position ?? '—',
        }, { reasonPosition: row?.position ?? null }),
      )
      continue
    }

    if (!row && displayName.length >= 2) {
      const found = await searchPlayers(displayName, args.effectiveSport)
      row = (found[0] ?? null) as SportsPlayerRecord | null
    }
    if (!row && raw.playerId) {
      row = (await getPlayer(raw.playerId.trim(), { sport: args.effectiveSport })) as SportsPlayerRecord | null
    }
    if (!row) {
      unresolved.push(displayName || raw.playerId || 'unknown')
      continue
    }

    const pa = sportsRecordToPricedAsset(row)
    if (!pa) {
      // Pricing can now REFUSE (slice 11: no market value and no projection ->
      // null rather than a fabricated number). An unpriceable asset belongs in
      // `unresolved` so the grader sees a short side and reports insufficient
      // data, instead of being handed a zero that reads as "worthless".
      unresolved.push(displayName || raw.playerId || row.id)
      continue
    }
    priced.push(pa)
    lines.push(
      lineFromPriced(pa, {
        playerId: row.id,
        // Same seam for every other sport: `row.id` is the slug id, which the enrichment port
        // cannot read either. Resolving from the resolved row's own name keeps the two branches
        // honest about the same distinction.
        enrichmentPlayerId:
          args.resolveEnrichmentIds === false ? null : await resolveEnrichmentPlayerId(row.name, row.sport, row.position),
        sport: row.sport,
        team: row.team,
        headshotUrl: row.headshotUrl ?? row.headshotUrlLg ?? row.headshotUrlSm,
        logoUrl: row.logoUrl,
        injuryStatus: row.injuryStatus,
        pricedSource: 'sports_db',
        dataSource: row.dataSource,
        position: row.position,
      }),
    )
  }

  return { priced, lines, unresolved }
}

export function pprForNflFromLeagueContext(
  norm: NormalizedLeagueContext | null,
  leagueRow: LoadedTradeLeague | null,
): 0 | 0.5 | 1 {
  const fmt = norm?.scoring?.labels?.receptionFormat
  if (fmt === 'ppr') return 1
  if (fmt === 'half_ppr') return 0.5
  if (fmt === 'standard') return 0
  const s = (leagueRow?.scoring ?? '').toLowerCase()
  if (s.includes('half') || s.includes('0.5')) return 0.5
  if (s.includes('standard') && !s.includes('half')) return 0
  if (s.includes('ppr') || s.includes('full')) return 1
  return 1
}

/** The chart a trade is priced on for one league, and the valuation context that reads it. */
export type LeagueTradeChart = {
  proposalRules?: import('./tradeEligibility').ProposalTradeRules
  leagueSize: number
  /** Null in global mode (no league): graded on the chart alone, and labelled so. */
  marketCtx: ReturnType<typeof marketContextFor> | null
  chartIsDynasty: boolean
  tePremium: boolean
  isSuperFlex: boolean
  waiverBudget: number
  /** The reception weight the chart was REQUESTED with — `scoringFit` measures against this. */
  pprNfl: 0 | 0.5 | 1
  fcPlayers: FantasyCalcPlayer[]
  nflCtx: ValuationContext
}

/**
 * Resolve the chart for a league and fetch it. Moved verbatim from the console; the console's
 * request overrides (`leagueSize`, `tePremium`, `isSuperFlex`, `waiverBudget`) ride in `overrides`.
 */
export async function resolveLeagueTradeChart(args: {
  leagueRow: LoadedTradeLeague | null
  leagueSnapshot: TradeConsoleLeagueSnapshot | null
  leagueNormCtx: NormalizedLeagueContext | null
  overrides?: { leagueSize?: number; tePremium?: boolean; isSuperFlex?: boolean; waiverBudget?: number }
  mark?: (name: string) => void
}): Promise<LeagueTradeChart> {
  const { leagueRow, leagueSnapshot, leagueNormCtx } = args
  const input = args.overrides ?? {}
  const leagueSize =
    input.leagueSize ??
    leagueSnapshot?.leagueSize ??
    12
  /*
   * 🛑 THE LEAGUE'S OWN CHART, BY THE SAME RULE EVERY OTHER SURFACE PRICES IT WITH.
   *
   * This requested `isDynasty: true` for EVERY league, so a redraft trade was priced on dynasty
   * values — a rookie's multi-year upside set against a veteran's one season, in a league where
   * only this season exists. `marketContextFor` is the rule the Player Finder, the value book and
   * the waiver pool already share (dynasty/keeper/superflex from `valueBook.leagueVariantFor`,
   * reception weight from the league's own `scoring_settings`); the verdict now asks for the chart
   * those surfaces show. Global mode (no league) keeps the old dynasty default, and says so.
   */
  const marketCtx = leagueRow ? marketContextFor(leagueRow.settings, leagueRow.leagueType, leagueSize) : null
  const chartIsDynasty = marketCtx ? marketCtx.variant.dynasty || marketCtx.variant.keeper : true
  const tePremium =
    input.tePremium ??
    leagueSnapshot?.tePremiumHint ??
    (typeof leagueNormCtx?.scoring?.labels?.tePremiumExtra === 'number' &&
      leagueNormCtx.scoring.labels.tePremiumExtra > 0)
  const isSuperFlex =
    input.isSuperFlex ??
    marketCtx?.variant.superflex ??
    leagueNormCtx?.scoring?.labels?.isSuperflex ??
    leagueSnapshot?.isSuperFlexHint ??
    false
  const waiverBudget =
    input.waiverBudget ??
    leagueSnapshot?.waiverBudget ??
    100

  /*
   * The chart's reception weight is the league's, when the league states one: `scoringFit` measures
   * each position's rule AGAINST the weight the chart was fetched with, so the two must be the same
   * number or the adjustment is measured against a chart nobody requested.
   */
  const pprNfl: 0 | 0.5 | 1 = marketCtx
    ? marketCtx.scoring.format === 'ppr'
      ? 1
      : marketCtx.scoring.format === 'half_ppr'
        ? 0.5
        : 0
    : pprForNflFromLeagueContext(leagueNormCtx, leagueRow)
  const asOf = new Date().toISOString().slice(0, 10)
  /*
   * ⚠ TOLERANCE TIGHTENED FROM THE 6 h DEFAULT TO 2 h, WHICH MAKES VALUES FRESHER, NOT FASTER.
   * `/api/cron/fantasycalc-warm` refreshes every demanded profile hourly, so a served value is
   * normally under an hour old; 2 h absorbs one missed run. Beyond that this falls through to a
   * live fetch — slower for that one caller, but still correct and still fresh, which is the
   * degrade Guap asked for when choosing freshness over the ~2 s this phase used to cost.
   *
   * 🛑 DO NOT WIDEN THIS TO BUY LATENCY. That was the alternative fix and it was rejected on
   * purpose: it removes the same seconds by serving staler valuations. If the warm cron is ever
   * retired, this number has to come back DOWN to 6 h or lower, not up.
   */
  const fcPlayers = await getFantasyCalcValuesDbFirst(
    {
      isDynasty: chartIsDynasty,
      numQbs: isSuperFlex ? 2 : 1,
      numTeams: leagueSize,
      ppr: pprNfl,
    },
    { maxStaleMs: 1000 * 60 * 60 * 2 },
  )
  args.mark?.('fantasycalc')

  /*
   * This league's defenders, priced by its own scoring rather than by the flat
   * per-position constant in lib/hybrid-valuation.ts. Keyed off `platformLeagueId`
   * because the console works in INTERNAL League.id space and Sleeper's roster and
   * settings endpoints do not answer to that id.
   */
  const leagueValues = leagueRow?.platformLeagueId
    ? await loadLeagueTradeValues({
        prisma,
        platformLeagueId: leagueRow.platformLeagueId,
        isDynasty: leagueRow.isDynasty ?? true,
      }).catch(() => null)
    : null

  const nflCtx: ValuationContext = {
    asOfDate: asOf,
    isSuperFlex,
    fantasyCalcPlayers: fcPlayers,
    numTeams: leagueSize,
    ...(leagueValues && leagueValues.byNameLower.size > 0 && { leagueValueByNameLower: leagueValues.byNameLower }),
  }

  return {
    leagueSize,
    proposalRules: {
      tradesEnabled: leagueNormCtx?.lineupBehavior.bestBallSettings?.tradesEnabled ?? null,
      draftPickTrading: leagueNormCtx?.trade.draftPickTrading ?? null,
    },
    marketCtx,
    chartIsDynasty,
    tePremium: Boolean(tePremium),
    isSuperFlex,
    waiverBudget,
    pprNfl,
    fcPlayers,
    nflCtx,
  }
}

/**
 * ⚠ ONLY WITHOUT A LEAGUE. A flat ×1.15 for "has any TE premium" priced a 0.25 bonus and a 1.0
 * bonus the same. In a league the premium is the league's actual reception rule, applied per
 * position by `scoringFit` as a visible adjustment; applying this too would count it twice.
 */
export function applyChartTePremium(chart: LeagueTradeChart, assets: PricedAsset[]): PricedAsset[] {
  if (!chart.tePremium || chart.marketCtx) return assets
  const mult = 1.15
  return assets.map((a) => {
    if (a.position?.toUpperCase() === 'TE') {
      const boosted = Math.round(a.value * mult)
      return {
        ...a,
        value: boosted,
        assetValue: {
          ...a.assetValue,
          marketValue: Math.round(a.assetValue.marketValue * mult),
          impactValue: Math.round(a.assetValue.impactValue * mult),
          vorpValue: Math.round(a.assetValue.vorpValue * mult),
          volatility: a.assetValue.volatility,
        },
      }
    }
    return a
  })
}
