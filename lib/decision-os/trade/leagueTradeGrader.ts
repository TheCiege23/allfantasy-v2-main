import 'server-only'

import type { PricedAsset } from '@/lib/hybrid-valuation'
import { prisma } from '@/lib/prisma'
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import type { NormalizedLeagueContext } from '@/lib/league-context-engine/types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { leagueTypeBasis, type LeagueTypeBasis } from '@/lib/league/leagueTypeGrading'
import { loadLeagueForTrade, type LoadedTradeLeague } from '@/lib/trade-value-console/league-loader'
import { gradeBaseOf, gradeOnLeagueValue, isNonPlayerLine, type LeagueGrade } from '@/lib/trade-value-console/leagueGrade'
import {
  applyChartTePremium,
  resolveAssets,
  resolveLeagueTradeChart,
  type LeagueTradeChart,
} from '@/lib/trade-value-console/leagueTradePricing'
import { snapshotFromLoaded } from '@/lib/trade-value-console/quick-badges'
import type { TradeAssetInput, TradeConsolePlayerLine } from '@/lib/trade-value-console/types'
import { gradeTrade, type TradeGradeLine, type TradeGradeMove, type TradeGradeView } from './tradeGrade'
import { tradeValueAsOf, tradeValueSourceOf } from './valueSource'
import { loadRosterNeedFactors, loadViewerNeedFactors, type NeedFactors } from '@/lib/trade-value/viewerNeedFactors'
import { unpriceableReason, type GradeInputs } from './tradeGradeInputs'
import { proposalEligibilityReason } from '@/lib/trade-value-console/tradeEligibility'
import { createNcaafLeagueGrader } from './ncaafLeagueGrader'
import { createLeagueAssetPolicy } from './leagueAssetPolicy'
import { DEVY_BASIS_NOTE } from './leagueAssetRules'
import { belowChartFloorNote } from '@/lib/trade-value/belowChartFloor'
import { isPirateLeague } from '@/lib/trade-intel/pirateSteal'

/**
 * The ONE trade grade, computed. Every surface that shows a letter for a deal that has not happened
 * yet — the Trade Center, pending-offer cards on /core and the league page, the /core Trades list,
 * Chimmy — reaches `gradePricedSides` below, and only through it. See `./tradeGrade.ts` for the
 * decision and the measurement behind it.
 *
 * Two entry points, one path:
 *   - `gradePricedSides` — for a caller that has already priced both sides with `resolveAssets`
 *     (the console, which needs the priced assets for its driver model too);
 *   - `createLeagueTradeGrader` — for everyone else: loads the league and its chart ONCE, then
 *     prices and grades as many deals as the caller has (a panel of pending offers) on that chart.
 *
 * Roster fit is separate from the shared trade-value letter. Completed trades cannot reconstruct
 * the pre-trade roster, so changing the letter with current need made calculator C/C become email
 * D/B. Every letter now uses chart + league scoring; personal utility remains explicit below it.
 * ROSTER NEED IS THE VIEWER'S, AND ONLY WHEN THE VIEWER IS THE `give` SIDE. The need model asks
 * what each asset is worth to the viewer's own roster (`loadViewerNeedFactors`), so it is priced
 * only when the caller says the deal is seen from the viewer's side. A commissioner looking at two
 * other managers' offer gets the league's chart and scoring, no need, and `needGap` says why.
 */

export type NeedScope = {
  leagueId: string
  userId: string
  sport: string
  starters: unknown
  /**
   * Price need for THIS roster instead of the user's claimed one — how the nightly trade agent asks
   * whether the partner's roster gains, when the partner has no AllFantasy account to look up.
   */
  playerData?: unknown
}

/** Price-independent: a line counts as a move only when this league's value differs from market. */
function movesOf(leagueGrade: LeagueGrade): TradeGradeMove[] {
  const out: TradeGradeMove[] = []
  const collect = (side: 'give' | 'get', lines: TradeConsolePlayerLine[]) => {
    for (const l of lines) {
      const adjustments = l.valueAdjustments ?? []
      if (l.leagueValue == null || adjustments.length === 0 || l.leagueValue === l.marketValue) continue
      out.push({ side, name: l.name, base: l.marketValue, leagueValue: l.leagueValue, reasons: adjustments.map((a) => a.reason) })
    }
  }
  collect('give', leagueGrade.giveLines)
  collect('get', leagueGrade.getLines)
  return out
}

/**
 * The grade's lines, each with the evidence that priced it and when that evidence was captured
 * (`./valueSource.ts`). `priced` is index-aligned with the lines — `gradeOnLeagueValue` maps its input
 * lines in order — so each line reads the `PricedAsset` it came from. Exported for tests.
 */
export function linesOf(
  leagueGrade: Pick<LeagueGrade, 'giveLines' | 'getLines'>,
  priced: { give: ReadonlyArray<PricedAsset>; get: ReadonlyArray<PricedAsset> } = { give: [], get: [] },
  chartSyncedAt: string | null = null,
): TradeGradeLine[] {
  const one = (side: 'give' | 'get') => (l: TradeConsolePlayerLine, i: number): TradeGradeLine => {
    const valueSource = tradeValueSourceOf(priced[side][i], l)
    const scope = l.projectionScope
    return {
      side,
      assetKind: l.pricedSource === 'pick' ? 'pick' : l.pricedSource === 'faab' ? 'faab' : 'player',
      name: l.name,
      marketValue: l.unpriced ? null : l.marketValue,
      leagueValue: l.leagueValue ?? null,
      source: l.dataSource ?? null,
      valueSource,
      valueAsOf: tradeValueAsOf(valueSource, chartSyncedAt),
      valueScope: valueSource === 'league_idp' && scope?.season && scope?.week ? `${scope.season} week ${scope.week}` : null,
    }
  }
  return [...leagueGrade.giveLines.map(one('give')), ...leagueGrade.getLines.map(one('get'))]
}

export async function gradePricedSides(args: {
  chart: LeagueTradeChart
  giveLines: TradeConsolePlayerLine[]
  getLines: TradeConsolePlayerLine[]
  /** Already through `applyChartTePremium`. Index-aligned with the lines. */
  givePriced: PricedAsset[]
  getPriced: PricedAsset[]
  /** Estimate separate roster utility for the viewer, who is the `give` side. */
  need: NeedScope | null
  /** Why this deal cannot be graded at all, when the caller already knows (e.g. no league). */
  withheld?: string | null
  /** Explicit global analyzer mode: price on the market chart without requiring league settings. */
  allowGenericMarketGrade?: boolean
  /** Sentences the basis must carry about how some lines were priced (e.g. devy prospects). */
  basisNotes?: readonly string[]
  mark?: (name: string) => void
}): Promise<{ leagueGrade: LeagueGrade; grade: TradeGradeView; needFactors: NeedFactors | null }> {
  const { chart } = args

  let needFactors: NeedFactors | null = null
  if (chart.marketCtx && args.need) {
    const toNeed = (lines: TradeConsolePlayerLine[], priced: PricedAsset[]) =>
      lines.map((l, i) => ({
        name: l.name,
        position: isNonPlayerLine(l) ? null : l.position,
        base: gradeBaseOf(l, priced[i]),
        injuryStatus: l.injuryStatus,
      }))
    const needArgs = {
      leagueId: args.need.leagueId,
      sport: args.need.sport,
      starters: args.need.starters,
      give: toNeed(args.giveLines, args.givePriced),
      get: toNeed(args.getLines, args.getPriced),
    }
    needFactors =
      args.need.playerData !== undefined
        ? await loadRosterNeedFactors({ ...needArgs, playerData: args.need.playerData })
        : await loadViewerNeedFactors({ ...needArgs, userId: args.need.userId })
    args.mark?.('need_factors')
  }

  const leagueGrade = gradeOnLeagueValue({
    giveLines: args.giveLines,
    getLines: args.getLines,
    givePriced: args.givePriced,
    getPriced: args.getPriced,
    league: chart.marketCtx ? { scoringSettings: chart.marketCtx.scoring.settings } : null,
    chart: { dynasty: chart.chartIsDynasty, superflex: chart.isSuperFlex, teams: chart.leagueSize, ppr: chart.pprNfl },
    needFactors: null,
  })

  const rosterFitGrade = needFactors && !needFactors.gap
    ? gradeOnLeagueValue({
        giveLines: args.giveLines,
        getLines: args.getLines,
        givePriced: args.givePriced,
        getPriced: args.getPriced,
        league: chart.marketCtx ? { scoringSettings: chart.marketCtx.scoring.settings } : null,
        chart: { dynasty: chart.chartIsDynasty, superflex: chart.isSuperFlex, teams: chart.leagueSize, ppr: chart.pprNfl },
        needFactors,
      })
    : null

  const placeholder = [...leagueGrade.giveLines, ...leagueGrade.getLines].find((l) => l.dataSource === 'placeholder')
  leagueGrade.valueBasis.needGap = args.need ? needFactors?.gap ?? null : null
  if (chart.valuationGaps?.length) {
    leagueGrade.valueBasis.label += ` — scope: chart and league scoring only. ${chart.valuationGaps.join(' ')}`
  }
  if (args.basisNotes?.length) leagueGrade.valueBasis.label += ` ${args.basisNotes.join(' ')}`
  const withheld =
    args.withheld ??
    proposalEligibilityReason(chart.proposalRules, [...args.giveLines, ...args.getLines]) ??
    (chart.marketCtx || args.allowGenericMarketGrade ? null : 'League settings are unavailable, so this league trade cannot be graded.') ??
    (placeholder ? `${placeholder.name} is priced from a placeholder, not a real value.` : null)

  const t = leagueGrade.totals
  const grade = gradeTrade({
    giveValue: t.giveLeague,
    getValue: t.getLeague,
    giveMarket: t.giveBase,
    getMarket: t.getBase,
    unpriced: t.unpriced,
    giveCount: args.giveLines.length,
    getCount: args.getLines.length,
    basis: leagueGrade.valueBasis.label,
    scoringApplied: leagueGrade.valueBasis.scoringAdjusted,
    needApplied: leagueGrade.valueBasis.needAdjusted,
    needGap: args.need ? needFactors?.gap ?? null : null,
    lines: linesOf(leagueGrade, { give: args.givePriced, get: args.getPriced }, chart.fcSyncedAt ?? null),
    moves: movesOf(leagueGrade),
    withheld,
  })
  return {
    leagueGrade,
    grade: grade.graded ? {
      ...grade,
      rosterFit: rosterFitGrade && rosterFitGrade.totals.unpriced === 0 ? {
        giveValue: rosterFitGrade.totals.giveLeague,
        getValue: rosterFitGrade.totals.getLeague,
        percentDiff: rosterFitGrade.totals.percentDiff,
        moves: movesOf(rosterFitGrade).filter((move) =>
          rosterFitGrade[move.side === 'give' ? 'giveLines' : 'getLines'].some((line) =>
            line.name === move.name && line.valueAdjustments?.some((adjustment) => adjustment.kind === 'need'))),
      } : null,
    } : grade,
    needFactors,
  }
}

export type LeagueTradeGrader = {
  leagueId: string
  chart: LeagueTradeChart
  /** The league type every grade here is priced under, and how we know it. Also on each grade. */
  leagueType: LeagueTypeBasis
  /**
   * The league plays Pirate rules (`isPirateLeague`), so a one-way transaction in it is a STEAL, not a
   * trade — see `lib/trade-intel/pirateSteal.ts`. Read by the completed-trade grade.
   */
  pirateLeague?: boolean
  /**
   * Price and grade one deal on this league's chart. `give` is what the graded side sends.
   * `viewerSide: true` adds personal roster utility separately; it does not change the letter.
   */
  grade(args: {
    give: TradeAssetInput[]
    get: TradeAssetInput[]
    viewerSide: boolean
    /** Price roster fit for this roster (the `give` side's) rather than the grader's user's. */
    needRoster?: { playerData: unknown }
  }): Promise<TradeGradeView>
}

/**
 * Load a league's chart once and grade deals on it.
 *
 * ⚠ THE CALLER HAS ALREADY PROVEN MEMBERSHIP. Every current caller reads the league through a
 * membership-checked path first (the trades panel's owner/claim query, the /core league context,
 * Chimmy's `leagueSnapshot`), so this does not check it a second time. A new caller must do the
 * same before handing a league id here — the grader reads the viewer's roster.
 *
 * Returns null when the league cannot be read. Never throws for a single deal: `grade` returns a
 * withheld view with the reason instead.
 */
export async function createLeagueTradeGrader(args: {
  leagueId: string
  /**
   * The viewer, when there is one. Optional: a completed trade, a receipt for someone else's
   * deal or the grade email has no viewer, and then roster need is simply not priced. The league's
   * chart does not depend on it — with a league row, `marketContextFor` decides every chart input.
   */
  userId?: string | null
  /** Supply these when the caller already has them, so the league is not read twice. */
  leagueRow?: LoadedTradeLeague | null
  leagueNormCtx?: NormalizedLeagueContext | null
}): Promise<LeagueTradeGrader | null> {
  const leagueRow =
    args.leagueRow ??
    (await loadLeagueForTrade({ leagueId: args.leagueId, userId: args.userId ?? '', membershipPreverified: true }).catch(
      () => null,
    ))
  if (!leagueRow) return null
  const leagueSnapshot = snapshotFromLoaded(leagueRow)
  const leagueNormCtx =
    args.leagueNormCtx !== undefined
      ? args.leagueNormCtx
      : args.userId
        ? await resolveNormalizedLeagueContext({ userId: args.userId, leagueId: args.leagueId })
            .then((lc) => (lc.ok ? lc.context : null))
            .catch(() => null)
        : null
  const chart = await resolveLeagueTradeChart({ leagueRow, leagueSnapshot, leagueNormCtx })
  const sport = normalizeToSupportedSport(leagueSnapshot.sport)
  /*
   * The league type every grade from this grader is priced under, and how we know it — carried ON
   * the grade so each surface can say it beside the letter (Guap, 2026-09-25: the manager must be
   * told how much their league type matters). Withheld grades carry it too: "not graded" in a
   * league we assumed was redraft is also worth a confirm.
   */
  const leagueType = leagueTypeBasis({
    settings: leagueRow.settings,
    leagueType: leagueRow.leagueType,
    platform: leagueRow.platform ?? null,
  })
  const withType = (view: TradeGradeView): TradeGradeView => ({ ...view, leagueType })
  /*
   * A college league is not graded on the NFL chart where it can be helped (Phase 8): a redraft league
   * on points over replacement, and a pick refused in every college league. See `./ncaafLeagueGrader.ts`.
   */
  const college =
    sport === 'NCAAF'
      ? createNcaafLeagueGrader({ id: args.leagueId, platform: leagueRow.platform ?? null, settings: leagueRow.settings, leagueType })
      : null
  /* Phase 9: picks refused where nothing prices them, and devy prospects this league holds priced. */
  const assets = createLeagueAssetPolicy({
    id: args.leagueId,
    sport,
    leagueType,
    season: leagueRow.season ?? null,
    status: leagueRow.status ?? null,
  })

  // An arrow, not a function declaration: a hoisted declaration loses the `leagueRow` null narrowing.
  const gradeOnce = async ({
    give,
    get,
    viewerSide,
    needRoster,
  }: {
    give: TradeAssetInput[]
    get: TradeAssetInput[]
    viewerSide: boolean
    needRoster?: { playerData: unknown }
  }): Promise<TradeGradeView> => {
    try {
      const collegeView = college ? await college.grade(give, get) : null
      if (collegeView) return collegeView
      const pickWhy = assets.pickRefusal([...give, ...get])
      if (pickWhy) return { graded: false, reason: pickWhy, basis: null }
      const dataGaps: string[] = []
      const opts = {
        effectiveSport: sport,
        nflCtx: chart.nflCtx,
        waiverBudget: chart.waiverBudget,
        dataGaps,
        fcPlayers: chart.fcPlayers,
        resolveEnrichmentIds: false,
      }
      let [g, t] = await Promise.all([resolveAssets(give, opts), resolveAssets(get, opts)])
      /*
       * A skill player missing from this league's chart but listed on another FantasyCalc chart is
       * BELOW this chart, not unknown — priced at 0 and said so (`lib/trade-value/belowChartFloor.ts`).
       * One extra read, and a second pricing pass, only for a deal that has such a player.
       */
      // `?? []`: a pricing double (or an older caller's shape) may not carry the floor fields.
      const candidates = [...(g.floorCandidates ?? []), ...(t.floorCandidates ?? [])]
      if (candidates.length > 0) {
        const onAnotherChart = await loadOnAnotherFantasyCalcChart(candidates)
        if (onAnotherChart.size > 0) {
          const floorOpts = { ...opts, onAnotherChart }
          ;[g, t] = await Promise.all([resolveAssets(give, floorOpts), resolveAssets(get, floorOpts)])
        }
      }
      const floorNote = belowChartFloorNote([...(g.belowFloor ?? []), ...(t.belowFloor ?? [])])
      const unresolved = [...g.unresolved, ...t.unresolved]
      if (unresolved.length > 0) {
        return {
          graded: false,
          reason: `${unresolved.slice(0, 4).join(', ')} could not be found in the ${sport} player database, so this deal is not graded.`,
          basis: null,
        }
      }
      const [gd, td] = await Promise.all([
        assets.priceDevy({ inputs: give, lines: g.lines, priced: g.priced }),
        assets.priceDevy({ inputs: get, lines: t.lines, priced: t.priced }),
      ])
      const { grade } = await gradePricedSides({
        chart,
        giveLines: gd.lines,
        getLines: td.lines,
        givePriced: applyChartTePremium(chart, gd.priced),
        getPriced: applyChartTePremium(chart, td.priced),
        basisNotes: [...(gd.devyPriced + td.devyPriced > 0 ? [DEVY_BASIS_NOTE] : []), ...(floorNote ? [floorNote] : [])],
        need: needRoster
          ? { leagueId: args.leagueId, userId: args.userId ?? '', sport, starters: leagueRow.starters, playerData: needRoster.playerData }
          : viewerSide && args.userId
            ? { leagueId: args.leagueId, userId: args.userId, sport, starters: leagueRow.starters }
            : null,
      })
      return grade
    } catch {
      return { graded: false, reason: 'This deal could not be priced just now.', basis: null }
    }
  }

  return {
    leagueId: args.leagueId,
    chart,
    leagueType,
    pirateLeague: isPirateLeague({ name: leagueRow.name, settings: leagueRow.settings }),
    async grade(deal) {
      return withType(await gradeOnce(deal))
    },
  }
}

/**
 * Which of these Sleeper ids FantasyCalc lists on ANY of its charts in the last week — the evidence
 * `lib/trade-value/belowChartFloor.ts` needs before it prices a player missing from THIS league's chart
 * at 0. Never throws: an unreadable table means no evidence, and the player stays unpriced (the grade
 * withholds, exactly as before).
 */
async function loadOnAnotherFantasyCalcChart(sleeperIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(sleeperIds)].filter(Boolean)
  if (ids.length === 0) return new Set()
  const rows = await prisma.playerValueSnapshot
    .findMany({
      where: { sleeperId: { in: ids }, source: 'FANTASYCALC', capturedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      select: { sleeperId: true },
      distinct: ['sleeperId'],
    })
    .catch(() => [] as Array<{ sleeperId: string }>)
  return new Set(rows.map((r) => r.sleeperId))
}

/**
 * Grade one deal from a surface's own asset shape (see `./tradeGradeInputs.ts`). A null grader —
 * the league could not be read — and an asset that cannot be priced both come back as a withheld
 * view with the reason, never as a letter drawn from part of the deal.
 */
export async function gradeDeal(
  grader: LeagueTradeGrader | null,
  args: { give: GradeInputs; get: GradeInputs; viewerSide: boolean },
): Promise<TradeGradeView> {
  if (!grader) return { graded: false, reason: 'This league’s values could not be loaded just now.', basis: null }
  const why = unpriceableReason(args.give, args.get)
  if (why) return { graded: false, reason: why, basis: null }
  return grader.grade({ give: args.give.assets, get: args.get.assets, viewerSide: args.viewerSide })
}

/**
 * Names for native trade items that carry only a Sleeper id (a Trade Center proposal stores no
 * metadata). One query for the whole batch, one row per id — `SportsPlayer` holds several for many
 * players. Never throws: an unreadable table means "no names", and the grade withholds on its own.
 */
export async function loadNativePlayerNames(
  items: ReadonlyArray<{ itemType: string | null | undefined; itemReference: string | null; metadata?: unknown }>,
): Promise<(id: string) => string | null> {
  const ids = [
    ...new Set(
      items
        .filter((i) => {
          const type = String(i.itemType ?? 'player').toLowerCase()
          if (type.includes('pick') || type.includes('faab')) return false
          return true
        })
        .map((i) => i.itemReference)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]
  const byId = new Map<string, string>()
  const store = (prisma as typeof prisma & { sportsPlayer?: typeof prisma.sportsPlayer }).sportsPlayer
  if (ids.length > 0 && store && typeof store.findMany === 'function') {
    const rows = await store
      .findMany({ where: { sleeperId: { in: ids } }, select: { sleeperId: true, name: true } })
      .catch(() => [] as Array<{ sleeperId: string | null; name: string }>)
    for (const r of rows) if (r.sleeperId && r.name && !byId.has(r.sleeperId)) byId.set(r.sleeperId, r.name)
  }
  return (id: string) => byId.get(id) ?? null
}
