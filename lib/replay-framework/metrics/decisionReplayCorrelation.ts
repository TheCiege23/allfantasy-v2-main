/**
 * Decision OS Replay Framework Phase 15-16 — Decision Replay Correlation.
 * Read-only: joins the ALREADY-INGESTED Trade Replay and Lineup Replay
 * corpora for leagues that appear in both, using each real, stable
 * `providerAssetId` (Phase 9's trade fix; Phase 13's lineup convention) to
 * track a specific real acquired player from the moment of a real trade
 * into their real, subsequent lineup history on the receiving roster.
 *
 * No new ingestion. No production engine call. No writes at all (every
 * function here is a pure `findMany` + in-memory join). Per
 * docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md §6 (isolation, unchanged
 * since Phase 3): never touches TradeOfferEvent/TradeOutcomeEvent/
 * TradeLearningStats.
 *
 * Known, disclosed approximation: `ReplayImport.providerWeek` is `null` for
 * every trade row (per `sleeperTradeNormalizer.ts`'s own documented design
 * — "the same trade can appear in multiple week buckets during backfill").
 * A trade's approximate week is instead derived from its real `resolvedAt`
 * timestamp, using the exact same season-start approximation
 * `lineupSleeperNormalizer.ts` already uses in the other direction
 * (`Date.UTC(season, 8, 1) + week * 7 days`), inverted. This is an honest
 * approximation, not an exact week number, and is documented as such
 * everywhere it's used.
 *
 * Phase 16 additions (per docs/DECISION_OS_DECISION_REPLAY_CORRELATION_REPORT.md
 * §9's recommendation): roster-churn classification (resolving Phase 15
 * §6's zero-appearance ambiguity) and a matched-window before/after
 * comparison (resolving Phase 15 §5's seasonal-confound caveat).
 */
import { prisma } from '@/lib/prisma'
import type { LineupBacktestOutput, LineupReplayPayload, TradeBacktestOutput, TradeReplayPayload } from '../types'
import { average } from './shared'

/** Inverts `lineupSleeperNormalizer.ts`'s `approximateWeekDate()` — same convention, same disclosed imprecision. */
function approximateWeekFromDate(season: number, date: Date): number {
  const seasonStart = Date.UTC(season, 8, 1)
  const weeks = (date.getTime() - seasonStart) / (7 * 24 * 60 * 60 * 1000)
  return Math.max(1, Math.min(18, Math.round(weeks)))
}

/** Matched before/after window width (real NFL weeks), per Phase 15 §5/§9's recommendation to remove the season-long seasonal confound. */
const MATCHED_WINDOW_WEEKS = 3

interface TradeRow {
  id: string
  providerLeagueId: string
  season: number
  resolvedAt: Date | null
  participantsInvolved: number[]
  payload: TradeReplayPayload
  backtestedOutput: TradeBacktestOutput
}

interface LineupRow {
  providerLeagueId: string
  season: number
  providerWeek: number | null
  rosterId: number
  payload: LineupReplayPayload
  backtestedOutput: LineupBacktestOutput
}

/**
 * Resolves the real cause behind an acquired player's post-trade lineup
 * history, per Phase 16's roster-churn refinement:
 * - `draft_pick`: never has lineup appearances by construction (not a real
 *   rosterable player in Sleeper's matchup data) — not a churn signal at all.
 * - `insufficient_week_coverage`: the receiving roster has NO real lineup
 *   rows at or after the trade week at all — a data-availability gap (the
 *   trade happened too late in the season to observe anything), not
 *   evidence the team never used the player.
 * - `churned_away`: the roster DOES have real post-trade lineup rows, but
 *   this specific player never appears in any of them — real evidence they
 *   were dropped or re-traded before ever being usable on this roster.
 * - `retained_but_unused`: the player appears in the roster's real lineup
 *   history at least once, but was never actually started — the genuine
 *   "wasted acquisition" case.
 * - `active`: appeared and was started at least once.
 */
export type AcquiredPlayerStatus = 'active' | 'retained_but_unused' | 'churned_away' | 'insufficient_week_coverage' | 'draft_pick'

export interface AcquiredPlayerImpact {
  providerAssetId: string
  name: string
  status: AcquiredPlayerStatus
  lineupAppearances: number
  starterAppearances: number
  optimalAppearances: number
  wastedOptimalAppearances: number
  totalPointsContributed: number
  totalPointsWhileStarted: number
}

export interface MatchedWindowResult {
  weeksPerSide: number
  weeksAvailableBefore: number
  weeksAvailableAfter: number
  avgEfficiencyBefore: number | null
  avgEfficiencyAfter: number | null
  avgPointsLeftOnBenchBefore: number | null
  avgPointsLeftOnBenchAfter: number | null
  /** after - before; positive means efficiency improved post-trade. */
  deltaEfficiency: number | null
  /** after - before; negative means fewer points were left on the bench post-trade (an improvement). */
  deltaPointsLeftOnBench: number | null
}

export interface TradeReplayLineupImpact {
  tradeReplayId: string
  providerLeagueId: string
  season: number
  approximateTradeWeek: number | null
  verdict: string
  acceptProb: number
  confidenceScore: number
  hasLineupData: boolean
  deltaThem: number | null
  receivingRosterId: number
  givenUpValue: number
  acquiredPlayers: AcquiredPlayerImpact[]
  lineupAppearances: number
  starterAppearances: number
  optimalAppearances: number
  wastedOptimalAppearances: number
  totalPointsContributed: number
  totalPointsWhileStarted: number
  starterConversionRate: number | null
  benchConversionRate: number | null
  tradeROI: number | null
  lineupROI: number | null
  /** Real acquired players only — draft picks excluded from all churn counts/rates below. */
  realAcquiredPlayerCount: number
  draftPickCount: number
  activeCount: number
  retainedButUnusedCount: number
  churnedAwayCount: number
  insufficientCoverageCount: number
  /** (churnedAway + insufficientCoverage) / realAcquiredPlayerCount */
  zeroAppearanceRate: number | null
  retainedButUnusedRate: number | null
  churnedAwayRate: number | null
  matchedWindow: MatchedWindowResult | null
}

interface GroupStats {
  count: number
  avgTradeROI: number | null
  avgStarterConversionRate: number | null
  avgTotalPointsContributed: number | null
  avgZeroAppearanceRate: number | null
  avgRetainedButUnusedRate: number | null
  avgDeltaEfficiency: number | null
  avgDeltaPointsLeftOnBench: number | null
}

export interface DecisionReplayCorrelationSummary {
  totalTradesConsidered: number
  totalTradesWithLineupData: number
  perTradeImpacts: TradeReplayLineupImpact[]
  avgStarterConversionRate: number | null
  avgBenchConversionRate: number | null
  avgTradeROI: number | null
  avgLineupROI: number | null
  avgTotalPointsContributed: number | null
  avgZeroAppearanceRate: number | null
  avgRetainedButUnusedRate: number | null
  avgChurnedAwayRate: number | null
  byVerdict: Array<{ verdict: string } & GroupStats>
  byConfidenceTier: Array<{ tier: 'high' | 'low'; threshold: number } & GroupStats>
  byFairnessCategory: Array<{ category: 'Win' | 'Fair' | 'Overpay' } & GroupStats>
  byLineupInvolvement: Array<{ involvement: 'starter_involved' | 'bench_depth' | 'no_lineup_data' } & GroupStats>
  matchedWindowAggregate: {
    weeksPerSide: number
    tradesWithMatchedData: number
    avgDeltaEfficiency: number | null
    avgDeltaPointsLeftOnBench: number | null
  }
  /**
   * Retained from Phase 15 for continuity — the naive, all-weeks-before vs.
   * all-weeks-after comparison, KNOWN to be confounded by the Phase 14
   * seasonal efficiency trend (see the report's honest caveat). The
   * matched-window comparison above is the Phase 16 refinement meant to
   * replace it as the trusted number; this is kept only so a reader
   * comparing both phases' reports can see the same field.
   */
  lineupImprovementScore: {
    avgEfficiencyBeforeTrade: number | null
    avgEfficiencyAfterTrade: number | null
    sampleSizeBefore: number
    sampleSizeAfter: number
  }
}

function isOptimal(providerAssetId: string, bt: LineupBacktestOutput, wasActualStarter: boolean): boolean {
  const isSuboptimalStarter = bt.subOptimalActualStarters.some((m) => m.providerAssetId === providerAssetId)
  if (wasActualStarter) return !isSuboptimalStarter
  return bt.missedOptimalStarters.some((m) => m.providerAssetId === providerAssetId)
}

function isWastedOptimal(providerAssetId: string, bt: LineupBacktestOutput): boolean {
  return bt.missedOptimalStarters.some((m) => m.providerAssetId === providerAssetId)
}

function classifyAcquiredPlayer(
  isPick: boolean,
  lineupAppearances: number,
  starterAppearances: number,
  rosterHasPostTradeData: boolean,
): AcquiredPlayerStatus {
  if (isPick) return 'draft_pick'
  if (lineupAppearances === 0) return rosterHasPostTradeData ? 'churned_away' : 'insufficient_week_coverage'
  if (starterAppearances === 0) return 'retained_but_unused'
  return 'active'
}

function computeMatchedWindow(rosterAllLineups: LineupRow[], approxWeek: number): MatchedWindowResult {
  const beforeRows = rosterAllLineups.filter(
    (l) => l.providerWeek != null && l.providerWeek >= approxWeek - MATCHED_WINDOW_WEEKS && l.providerWeek < approxWeek,
  )
  const afterRows = rosterAllLineups.filter(
    (l) => l.providerWeek != null && l.providerWeek >= approxWeek && l.providerWeek < approxWeek + MATCHED_WINDOW_WEEKS,
  )
  const avgEffBefore = average(beforeRows.map((r) => r.backtestedOutput.efficiencyPct))
  const avgEffAfter = average(afterRows.map((r) => r.backtestedOutput.efficiencyPct))
  const avgBenchBefore = average(beforeRows.map((r) => r.backtestedOutput.pointsLeftOnBench))
  const avgBenchAfter = average(afterRows.map((r) => r.backtestedOutput.pointsLeftOnBench))

  return {
    weeksPerSide: MATCHED_WINDOW_WEEKS,
    weeksAvailableBefore: beforeRows.length,
    weeksAvailableAfter: afterRows.length,
    avgEfficiencyBefore: avgEffBefore,
    avgEfficiencyAfter: avgEffAfter,
    avgPointsLeftOnBenchBefore: avgBenchBefore,
    avgPointsLeftOnBenchAfter: avgBenchAfter,
    deltaEfficiency: avgEffBefore !== null && avgEffAfter !== null ? Math.round((avgEffAfter - avgEffBefore) * 1000) / 1000 : null,
    deltaPointsLeftOnBench: avgBenchBefore !== null && avgBenchAfter !== null ? Math.round((avgBenchAfter - avgBenchBefore) * 100) / 100 : null,
  }
}

function toFairnessCategory(verdict: string): 'Win' | 'Fair' | 'Overpay' {
  if (verdict === 'Fair') return 'Fair'
  if (verdict === 'Overpay Risk' || verdict === 'Major Overpay') return 'Overpay'
  return 'Win' // Strong Win, Slight Win, Elite Asset Theft
}

function toLineupInvolvement(t: TradeReplayLineupImpact): 'starter_involved' | 'bench_depth' | 'no_lineup_data' {
  if (!t.hasLineupData) return 'no_lineup_data'
  return t.deltaThem !== null && t.deltaThem !== 0 ? 'starter_involved' : 'bench_depth'
}

function computeGroupStats(group: TradeReplayLineupImpact[]): GroupStats {
  const matched = group.map((t) => t.matchedWindow).filter((m): m is MatchedWindowResult => m !== null && m.deltaEfficiency !== null)
  return {
    count: group.length,
    avgTradeROI: average(group.map((t) => t.tradeROI).filter((v): v is number => v !== null)),
    avgStarterConversionRate: average(group.map((t) => t.starterConversionRate).filter((v): v is number => v !== null)),
    avgTotalPointsContributed: average(group.map((t) => t.totalPointsContributed)),
    avgZeroAppearanceRate: average(group.map((t) => t.zeroAppearanceRate).filter((v): v is number => v !== null)),
    avgRetainedButUnusedRate: average(group.map((t) => t.retainedButUnusedRate).filter((v): v is number => v !== null)),
    avgDeltaEfficiency: average(matched.map((m) => m.deltaEfficiency as number)),
    avgDeltaPointsLeftOnBench: average(matched.map((m) => m.deltaPointsLeftOnBench as number)),
  }
}

/**
 * Correlates the real Trade Replay and Lineup Replay corpora for the given
 * leagues (must appear in both decisionTypes to produce any impact rows).
 * Read-only: two pairs of `findMany` calls (trade + lineup, each
 * import+backtest), zero writes.
 */
export async function computeDecisionReplayCorrelation(providerLeagueIds: string[]): Promise<DecisionReplayCorrelationSummary> {
  const leagueFilter = { providerLeagueId: { in: providerLeagueIds } }

  const [tradeReplays, tradeBacktests, lineupReplaysWithId, lineupBacktests] = await Promise.all([
    prisma.replayImport.findMany({
      where: { decisionType: 'trade', ...leagueFilter },
      select: { id: true, providerLeagueId: true, season: true, resolvedAt: true, participantsInvolved: true, payload: true },
    }),
    prisma.replayBacktestResult.findMany({
      where: { decisionType: 'trade', replay: { ...leagueFilter } },
      select: { replayId: true, backtestedOutput: true },
    }),
    prisma.replayImport.findMany({
      where: { decisionType: 'lineup', ...leagueFilter },
      select: { id: true, providerLeagueId: true, season: true, providerWeek: true, participantsInvolved: true, payload: true },
    }),
    prisma.replayBacktestResult.findMany({
      where: { decisionType: 'lineup', replay: { ...leagueFilter } },
      select: { replayId: true, backtestedOutput: true },
    }),
  ])

  const tradeBacktestByReplayId = new Map(tradeBacktests.map((bt) => [bt.replayId, bt.backtestedOutput as unknown as TradeBacktestOutput]))
  const trades: TradeRow[] = tradeReplays
    .map((r) => {
      const bt = tradeBacktestByReplayId.get(r.id)
      if (!bt) return null
      return {
        id: r.id,
        providerLeagueId: r.providerLeagueId,
        season: r.season,
        resolvedAt: r.resolvedAt,
        participantsInvolved: r.participantsInvolved as unknown as number[],
        payload: r.payload as unknown as TradeReplayPayload,
        backtestedOutput: bt,
      }
    })
    .filter((t): t is TradeRow => t !== null)

  const lineupBacktestByReplayId = new Map(lineupBacktests.map((bt) => [bt.replayId, bt.backtestedOutput as unknown as LineupBacktestOutput]))
  const lineups: LineupRow[] = lineupReplaysWithId
    .map((r) => {
      const bt = lineupBacktestByReplayId.get(r.id)
      if (!bt) return null
      const participants = r.participantsInvolved as unknown as number[]
      return {
        providerLeagueId: r.providerLeagueId,
        season: r.season,
        providerWeek: r.providerWeek,
        rosterId: participants[0],
        payload: r.payload as unknown as LineupReplayPayload,
        backtestedOutput: bt,
      }
    })
    .filter((l): l is LineupRow => l !== null)

  // Index lineup rows by (league, season, rosterId) for fast lookup.
  const lineupsByRoster = new Map<string, LineupRow[]>()
  for (const l of lineups) {
    const key = `${l.providerLeagueId}::${l.season}::${l.rosterId}`
    const list = lineupsByRoster.get(key) ?? []
    list.push(l)
    lineupsByRoster.set(key, list)
  }

  const perTradeImpacts: TradeReplayLineupImpact[] = []

  for (const trade of trades) {
    if (!trade.resolvedAt || trade.participantsInvolved.length < 1) continue
    const receivingRosterId = trade.participantsInvolved[0] // proposerRosterId receives assetsReceived, per sleeperTradeNormalizer.ts
    const acquired = trade.payload.assetsReceived.filter((a) => a.providerAssetId)
    if (acquired.length === 0) continue

    const approxWeek = approximateWeekFromDate(trade.season, trade.resolvedAt)
    const key = `${trade.providerLeagueId}::${trade.season}::${receivingRosterId}`
    const allRosterLineups = lineupsByRoster.get(key) ?? []
    const rosterLineups = allRosterLineups.filter((l) => (l.providerWeek ?? 0) >= approxWeek)
    const rosterHasPostTradeData = rosterLineups.length > 0

    const acquiredPlayers: AcquiredPlayerImpact[] = acquired.map((asset) => {
      const providerAssetId = asset.providerAssetId!
      const isPick = asset.type === 'pick'
      let lineupAppearances = 0
      let starterAppearances = 0
      let optimalAppearances = 0
      let wastedOptimalAppearances = 0
      let totalPointsContributed = 0
      let totalPointsWhileStarted = 0

      for (const l of rosterLineups) {
        const rosterEntry = l.payload.fullRoster.find((p) => p.providerAssetId === providerAssetId)
        if (!rosterEntry) continue
        lineupAppearances++
        totalPointsContributed += rosterEntry.actualPoints
        const wasStarter = l.payload.actualStarterIds.includes(providerAssetId)
        if (wasStarter) {
          starterAppearances++
          totalPointsWhileStarted += rosterEntry.actualPoints
        }
        if (isOptimal(providerAssetId, l.backtestedOutput, wasStarter)) optimalAppearances++
        if (isWastedOptimal(providerAssetId, l.backtestedOutput)) wastedOptimalAppearances++
      }

      return {
        providerAssetId,
        name: asset.name,
        status: classifyAcquiredPlayer(isPick, lineupAppearances, starterAppearances, rosterHasPostTradeData),
        lineupAppearances,
        starterAppearances,
        optimalAppearances,
        wastedOptimalAppearances,
        totalPointsContributed: Math.round(totalPointsContributed * 100) / 100,
        totalPointsWhileStarted: Math.round(totalPointsWhileStarted * 100) / 100,
      }
    })

    const lineupAppearances = acquiredPlayers.reduce((s, p) => s + p.lineupAppearances, 0)
    const starterAppearances = acquiredPlayers.reduce((s, p) => s + p.starterAppearances, 0)
    const optimalAppearances = acquiredPlayers.reduce((s, p) => s + p.optimalAppearances, 0)
    const wastedOptimalAppearances = acquiredPlayers.reduce((s, p) => s + p.wastedOptimalAppearances, 0)
    const totalPointsContributed = Math.round(acquiredPlayers.reduce((s, p) => s + p.totalPointsContributed, 0) * 100) / 100
    const totalPointsWhileStarted = Math.round(acquiredPlayers.reduce((s, p) => s + p.totalPointsWhileStarted, 0) * 100) / 100
    const givenUpValue = trade.payload.assetsGiven.reduce((s, a) => s + a.value, 0)

    const draftPickCount = acquiredPlayers.filter((p) => p.status === 'draft_pick').length
    const activeCount = acquiredPlayers.filter((p) => p.status === 'active').length
    const retainedButUnusedCount = acquiredPlayers.filter((p) => p.status === 'retained_but_unused').length
    const churnedAwayCount = acquiredPlayers.filter((p) => p.status === 'churned_away').length
    const insufficientCoverageCount = acquiredPlayers.filter((p) => p.status === 'insufficient_week_coverage').length
    const realAcquiredPlayerCount = acquiredPlayers.length - draftPickCount

    perTradeImpacts.push({
      tradeReplayId: trade.id,
      providerLeagueId: trade.providerLeagueId,
      season: trade.season,
      approximateTradeWeek: approxWeek,
      verdict: trade.backtestedOutput.verdict,
      acceptProb: trade.backtestedOutput.acceptProb,
      confidenceScore: trade.backtestedOutput.confidenceScore,
      hasLineupData: trade.backtestedOutput.hasLineupData ?? false,
      deltaThem: trade.backtestedOutput.deltaThem ?? null,
      receivingRosterId,
      givenUpValue,
      acquiredPlayers,
      lineupAppearances,
      starterAppearances,
      optimalAppearances,
      wastedOptimalAppearances,
      totalPointsContributed,
      totalPointsWhileStarted,
      starterConversionRate: lineupAppearances > 0 ? starterAppearances / lineupAppearances : null,
      benchConversionRate: optimalAppearances > 0 ? wastedOptimalAppearances / optimalAppearances : null,
      tradeROI: givenUpValue > 0 ? Math.round((totalPointsWhileStarted / givenUpValue) * 10000) / 10000 : null,
      lineupROI: totalPointsContributed > 0 ? Math.round((totalPointsWhileStarted / totalPointsContributed) * 1000) / 1000 : null,
      realAcquiredPlayerCount,
      draftPickCount,
      activeCount,
      retainedButUnusedCount,
      churnedAwayCount,
      insufficientCoverageCount,
      zeroAppearanceRate: realAcquiredPlayerCount > 0 ? (churnedAwayCount + insufficientCoverageCount) / realAcquiredPlayerCount : null,
      retainedButUnusedRate: realAcquiredPlayerCount > 0 ? retainedButUnusedCount / realAcquiredPlayerCount : null,
      churnedAwayRate: realAcquiredPlayerCount > 0 ? churnedAwayCount / realAcquiredPlayerCount : null,
      matchedWindow: computeMatchedWindow(allRosterLineups, approxWeek),
    })
  }

  const withLineupData = perTradeImpacts.filter((t) => t.lineupAppearances > 0)

  const byVerdictMap = new Map<string, TradeReplayLineupImpact[]>()
  for (const t of withLineupData) {
    const list = byVerdictMap.get(t.verdict) ?? []
    list.push(t)
    byVerdictMap.set(t.verdict, list)
  }
  const byVerdict = Array.from(byVerdictMap.entries()).map(([verdict, group]) => ({ verdict, ...computeGroupStats(group) }))

  const confidenceValues = withLineupData.map((t) => t.confidenceScore).sort((a, b) => a - b)
  const medianConfidence = confidenceValues.length > 0 ? confidenceValues[Math.floor(confidenceValues.length / 2)] : 0
  const highTier = withLineupData.filter((t) => t.confidenceScore >= medianConfidence)
  const lowTier = withLineupData.filter((t) => t.confidenceScore < medianConfidence)
  const byConfidenceTier: DecisionReplayCorrelationSummary['byConfidenceTier'] = [
    { tier: 'high', threshold: medianConfidence, ...computeGroupStats(highTier) },
    { tier: 'low', threshold: medianConfidence, ...computeGroupStats(lowTier) },
  ]

  const byFairnessCategoryMap = new Map<'Win' | 'Fair' | 'Overpay', TradeReplayLineupImpact[]>()
  for (const t of withLineupData) {
    const category = toFairnessCategory(t.verdict)
    const list = byFairnessCategoryMap.get(category) ?? []
    list.push(t)
    byFairnessCategoryMap.set(category, list)
  }
  const byFairnessCategory = Array.from(byFairnessCategoryMap.entries()).map(([category, group]) => ({ category, ...computeGroupStats(group) }))

  const byLineupInvolvementMap = new Map<'starter_involved' | 'bench_depth' | 'no_lineup_data', TradeReplayLineupImpact[]>()
  for (const t of withLineupData) {
    const involvement = toLineupInvolvement(t)
    const list = byLineupInvolvementMap.get(involvement) ?? []
    list.push(t)
    byLineupInvolvementMap.set(involvement, list)
  }
  const byLineupInvolvement = Array.from(byLineupInvolvementMap.entries()).map(([involvement, group]) => ({ involvement, ...computeGroupStats(group) }))

  const matchedTrades = perTradeImpacts
    .map((t) => t.matchedWindow)
    .filter((m): m is MatchedWindowResult => m !== null && m.deltaEfficiency !== null && m.deltaPointsLeftOnBench !== null)

  // Retained from Phase 15 (naive, season-confounded comparison) — see
  // DecisionReplayCorrelationSummary.lineupImprovementScore's docstring.
  const beforeEfficiencies: number[] = []
  const afterEfficiencies: number[] = []
  const rostersWithTrades = new Map<string, number>()
  for (const t of perTradeImpacts) {
    const key = `${t.providerLeagueId}::${t.season}::${t.receivingRosterId}`
    const existing = rostersWithTrades.get(key)
    if (existing === undefined || (t.approximateTradeWeek ?? 99) < existing) {
      rostersWithTrades.set(key, t.approximateTradeWeek ?? 99)
    }
  }
  for (const [key, earliestWeek] of rostersWithTrades.entries()) {
    const rosterLineups = lineupsByRoster.get(key) ?? []
    for (const l of rosterLineups) {
      if (l.providerWeek == null) continue
      if (l.providerWeek < earliestWeek) beforeEfficiencies.push(l.backtestedOutput.efficiencyPct)
      else afterEfficiencies.push(l.backtestedOutput.efficiencyPct)
    }
  }

  return {
    totalTradesConsidered: perTradeImpacts.length,
    totalTradesWithLineupData: withLineupData.length,
    perTradeImpacts,
    avgStarterConversionRate: average(withLineupData.map((t) => t.starterConversionRate).filter((v): v is number => v !== null)),
    avgBenchConversionRate: average(withLineupData.map((t) => t.benchConversionRate).filter((v): v is number => v !== null)),
    avgTradeROI: average(withLineupData.map((t) => t.tradeROI).filter((v): v is number => v !== null)),
    avgLineupROI: average(withLineupData.map((t) => t.lineupROI).filter((v): v is number => v !== null)),
    avgTotalPointsContributed: average(withLineupData.map((t) => t.totalPointsContributed)),
    avgZeroAppearanceRate: average(perTradeImpacts.map((t) => t.zeroAppearanceRate).filter((v): v is number => v !== null)),
    avgRetainedButUnusedRate: average(perTradeImpacts.map((t) => t.retainedButUnusedRate).filter((v): v is number => v !== null)),
    avgChurnedAwayRate: average(perTradeImpacts.map((t) => t.churnedAwayRate).filter((v): v is number => v !== null)),
    byVerdict,
    byConfidenceTier,
    byFairnessCategory,
    byLineupInvolvement,
    matchedWindowAggregate: {
      weeksPerSide: MATCHED_WINDOW_WEEKS,
      tradesWithMatchedData: matchedTrades.length,
      avgDeltaEfficiency: average(matchedTrades.map((m) => m.deltaEfficiency as number)),
      avgDeltaPointsLeftOnBench: average(matchedTrades.map((m) => m.deltaPointsLeftOnBench as number)),
    },
    lineupImprovementScore: {
      avgEfficiencyBeforeTrade: average(beforeEfficiencies),
      avgEfficiencyAfterTrade: average(afterEfficiencies),
      sampleSizeBefore: beforeEfficiencies.length,
      sampleSizeAfter: afterEfficiencies.length,
    },
  }
}
